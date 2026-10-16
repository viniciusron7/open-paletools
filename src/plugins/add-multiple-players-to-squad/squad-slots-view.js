/**
 * `AddMultiplePlayersSquadSlotsView` (EAView subclass), pinned above the results by
 * search-results-view.js: lists the squad's non-brick slots as `UTItemTableCellView` rows with
 * slot number and position name; tapping a row removes that player through the view model.
 *
 * Invariants:
 * - `JSUtils.inherits(..., EAView)` must run before the prototype assignments.
 * - Root is `<ul id="sbc-players">`; rows carry `position-info`, `position-index` and
 *   `position-name` (styled by add-multiple-players-to-squad.css, upserted here as
 *   `paletools-sbc-add-multiple-players` so the styles exist even if the plugin was off at
 *   startup).
 * - The constructor observes `onPlayerAdded`/`onPlayerRemoved` (before `EAView.call`) and never
 *   unobserves; each notification rebuilds the whole list (`innerHTML = ""`).
 */
import { appendElements, createElement } from "../../core/dom.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import addMultiplePlayersToSquadStyles from "./add-multiple-players-to-squad.css";

export function AddMultiplePlayersSquadSlotsView(viewModel) {
  this.viewModel = viewModel;
  this.viewModel.onPlayerAdded.observe(this, () => this._regenerateList());
  this.viewModel.onPlayerRemoved.observe(this, () => this._regenerateList());
  EAView.call(this);
}

JSUtils.inherits(AddMultiplePlayersSquadSlotsView, EAView);

AddMultiplePlayersSquadSlotsView.prototype._generate = function () {
  upsertStylesheet("paletools-sbc-add-multiple-players", addMultiplePlayersToSquadStyles);
  const root = createElement("ul", {
    id: "sbc-players",
  });
  this.__root = root;
  this._regenerateList();
};

AddMultiplePlayersSquadSlotsView.prototype._regenerateList = function () {
  this.getRootElement().innerHTML = "";
  for (let slot of this.viewModel.getPlayers()) {
    const itemCell = new UTItemTableCellView();
    itemCell.setData(slot.getItem());
    itemCell.render();
    itemCell.setTapCallback(() => {
      this.viewModel.removePlayer(slot.getItem());
    });
    const positionInfo = createElement("div", {
      className: "position-info",
    });
    const positionName = createElement("div", {
      className: "position-name",
    });
    const positionIndex = createElement("div", {
      className: "position-index",
    });
    positionName.textContent = slot.position && slot.position.name;
    positionIndex.textContent = slot.index + 1;
    appendElements(positionInfo, positionIndex, positionName);
    appendElements(itemCell.itemComponent, positionInfo);
    appendElements(this.getRootElement(), itemCell);
  }
};
