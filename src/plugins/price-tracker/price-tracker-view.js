/**
 * `PriceTrackerView` (EAView via `JSUtils.inherits`), created by `PriceTrackerViewController`
 * (src/plugins/price-tracker/index.js): player search, revision dropdown, add button, a status
 * line and the tracked players split over two tables.
 *
 * Invariants:
 * - Callbacks are injected by the controller: `onPlayerChanged(player)` on search change; the
 *   view model's `onChange` calls `renderPlayers()`.
 * - Texts are `plugins.priceTracker.<key>` (revision, add, holographic, column titles, remove,
 *   empty, the status keys and the player statuses pending/unavailable/error); rarity labels use
 *   `item.raretype<rareflag>`.
 * - The revision dropdown always starts with a placeholder of value -1; the add button is enabled
 *   only when the selected value matches a loaded revision's `definitionId`.
 * - The first table holds `ceil(n / 2)` players and the empty-state row; add/remove failures set
 *   the `storageError` status.
 * - `destroyGeneratedElements` removes its targets and destroys its controls before calling
 *   `EAView.prototype.destroyGeneratedElements`.
 */
import { appendElements, createElement } from "../../core/dom.js";
import { formatNumber, translate } from "../../i18n/translations.js";

const translatePriceTrackerText = (translationKey) =>
  translate("plugins.priceTracker." + translationKey);

export function PriceTrackerView(viewModel) {
  this.viewModel = viewModel;
  this.revisions = [];
  this.onPlayerChanged = () => {};
  EAView.call(this);
}

JSUtils.inherits(PriceTrackerView, EAView);

PriceTrackerView.prototype._generate = function () {
  if (this.generated) {
    return;
  }
  const root = createElement("div", {
    className: "ut-content price-tracker-view",
  });
  this.playerSearch = new UTPlayerSearchControl();
  this.playerSearch.init();
  this.playerChanged = () => this.onPlayerChanged(this.playerSearch.getSelected());
  this.playerSearch.addTarget(this, this.playerChanged, EventType.CHANGE);
  const toolbar = createElement("div", {
    className: "price-tracker-toolbar",
  });
  appendElements(toolbar, this.playerSearch);
  this.revisionSelect = new UTDropDownControl();
  this.revisionSelect.init();
  this.revisionSelect.getRootElement().ariaLabel = translatePriceTrackerText("revision");
  this.revisionChanged = () => {
    this.addButton.setInteractionState(
      this.revisions.some(
        (revision) => revision.definitionId === Number(this.revisionSelect.getValue()),
      ),
    );
  };
  this.revisionSelect.addTarget(this, this.revisionChanged, EventType.CHANGE);
  this.addButton = new UTStandardButtonControl();
  this.addButton.init();
  this.addButton.setText(translatePriceTrackerText("add"));
  this.addPlayer = () => {
    const selectedRevision = this.revisions.find(
      (revision) => revision.definitionId === Number(this.revisionSelect.getValue()),
    );
    if (selectedRevision) {
      this.viewModel.addPlayer(selectedRevision).catch(() => this.setStatus("storageError"));
    }
  };
  this.addButton.addTarget(this, this.addPlayer, EventType.TAP);
  this.status = createElement("p", {
    role: "status",
  });
  const tableContainer = createElement("div", {
    className: "price-tracker-table",
  });
  this.rowGroups = [];
  for (let tableIndex = 0; tableIndex < 2; tableIndex++) {
    const table = createElement("table");
    const headerRow = createElement("tr");
    for (const columnKey of ["player", "rating", "rarity", "price", "actions"]) {
      const headerCell = createElement("th", {
        scope: "col",
        className: "price-tracker-" + columnKey,
      });
      headerCell.textContent = translatePriceTrackerText(columnKey);
      appendElements(headerRow, headerCell);
    }
    const tableHead = createElement("thead");
    appendElements(tableHead, headerRow);
    const tableBody = createElement("tbody");
    this.rowGroups.push(tableBody);
    appendElements(table, tableHead, tableBody);
    appendElements(tableContainer, table);
  }
  this.rows = this.rowGroups[0];
  appendElements(toolbar, this.revisionSelect, this.addButton);
  appendElements(root, toolbar, this.status, tableContainer);
  this.__root = root;
  this.generated = true;
  this.setRevisions([]);
  this.renderPlayers();
};

PriceTrackerView.prototype.setRevisions = function (revisions) {
  this.revisions = revisions;
  this.revisionSelect.setOptions([
    {
      id: -1,
      value: -1,
      label: "-- " + translatePriceTrackerText("revision") + " -",
    },
    ...revisions.map((revision) => ({
      id: revision.definitionId,
      value: revision.definitionId,
      label:
        revision.rating +
        " — " +
        translate("item.raretype" + revision.rareflag) +
        (revision.hasHyperCosmetics() ? " — " + translatePriceTrackerText("holographic") : "") +
        " (" +
        revision.definitionId +
        ")",
    })),
  ]);
  this.revisionSelect.setIndex(0);
  this.revisionSelect.setInteractionState(revisions.length > 0);
  this.addButton.setInteractionState(false);
};

PriceTrackerView.prototype.setStatus = function (statusKey) {
  this.status.textContent = statusKey ? translatePriceTrackerText(statusKey) : "";
};

PriceTrackerView.prototype.renderPlayers = function () {
  this.rowGroups.forEach((rowGroup) => rowGroup.replaceChildren());
  const rowsPerTable = Math.ceil(this.viewModel.players.length / 2);
  for (const [playerIndex, player] of this.viewModel.players.entries()) {
    const row = createElement("tr");
    const priceText =
      player.status === "ready"
        ? formatNumber(player.price)
        : translatePriceTrackerText(player.status);
    const rarityText =
      "" +
      translate("item.raretype" + player.rarity) +
      (player.holographic ? " — " + translatePriceTrackerText("holographic") : "");
    for (const title of [player.name, player.rating, rarityText, priceText]) {
      const cell = createElement("td", {
        title: title,
      });
      cell.textContent = title;
      appendElements(row, cell);
    }
    const actionsCell = createElement("td");
    const removeButton = createElement("button", {
      className: "btn-standard price-tracker-remove",
      title: translatePriceTrackerText("remove"),
      "aria-label": translatePriceTrackerText("remove") + " " + player.name,
    });
    removeButton.textContent = "×";
    removeButton.onclick = () =>
      this.viewModel.removePlayer(player.definitionId).catch(() => this.setStatus("storageError"));
    appendElements(actionsCell, removeButton);
    appendElements(row, actionsCell);
    appendElements(this.rowGroups[playerIndex < rowsPerTable ? 0 : 1], row);
  }
  if (!this.viewModel.players.length) {
    const emptyRow = createElement("tr");
    const emptyCell = createElement("td", {
      colspan: 5,
    });
    emptyCell.textContent = translatePriceTrackerText("empty");
    appendElements(emptyRow, emptyCell);
    appendElements(this.rows, emptyRow);
  }
};

PriceTrackerView.prototype.destroyGeneratedElements = function () {
  this.playerSearch?.removeTarget(this, this.playerChanged, EventType.CHANGE);
  this.addButton?.removeTarget(this, this.addPlayer, EventType.TAP);
  this.playerSearch?.destroy();
  this.revisionSelect?.removeTarget(this, this.revisionChanged, EventType.CHANGE);
  this.revisionSelect?.destroy();
  this.addButton?.destroy();
  EAView.prototype.destroyGeneratedElements.call(this);
};
