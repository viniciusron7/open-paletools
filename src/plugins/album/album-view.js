/**
 * `AlbumView` (extends `UTClubSearchResultsView`): album screen with league / club / sort
 * dropdowns, a status line and per-card Market, Buy and Mark-first-owner buttons. Instantiated
 * by `AlbumViewController` and extended by `GalleryView`.
 *
 * Invariants:
 * - The constructor creates `onClubChanged`, `onSortChanged`, `onMarketClicked`, `onBuyClicked`
 *   and `onFirstOwnerClicked`, observed by `AlbumViewController.init` (GalleryView gets them
 *   through `AlbumView.call`).
 * - Market and Buy are only offered for cards that are not collected yet; Buy also needs
 *   Paletools and the plugin enabled plus its `buyEnabled` setting (`configuration.plugins.gallery`
 *   when the view has `selectedCards`, i.e. it is the gallery, `.album` otherwise).
 * - The selection `{leagueId, clubId, sortBy}` is persisted to
 *   `configuration.plugins.album.lastSelection` on every change and restored in `_generate`.
 * - `setItems` needs `setAlbumEntries` first (it destructures the entry of every row by
 *   definitionId); it calls `UTClubSearchResultsView.prototype.setItems` at call time, so plugin
 *   wrappers on that prototype also run for the album and gallery.
 * - Card listeners are added with `listenForEvent` and removed with `stopListeningForEvent`, which
 *   map the event name the same way (click -> pointerdown on phones).
 * - Sort keys `rating`, `name`, `gradingScore`, `tracked` must match the controller; CSS classes
 *   (`album-view`, `album-grid`, `album-header`, `album-player`, ...) are styled by album.css,
 *   shared with the gallery; the row class `album-<status>` is not targeted by any stylesheet.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { addClasses, appendElements, createElement, prependElements } from "../../core/dom.js";
import { listenForEvent, stopListeningForEvent } from "../../core/events.js";
import { translate } from "../../i18n/translations.js";
import { DataProviderDropdownControl, dataProviderType } from "../../ui/data-provider-dropdown.js";
import { hideElements } from "../../ui/visibility.js";

const translateAlbumViewText = (translationKey) => translate("plugins.album." + translationKey);

const AlbumViewImpl = function () {
  UTClubSearchResultsView.call(this);
  this.onClubChanged = new EAObservable();
  this.onSortChanged = new EAObservable();
  this.onMarketClicked = new EAObservable();
  this.onBuyClicked = new EAObservable();
  this.onFirstOwnerClicked = new EAObservable();
  this.cardListeners = [];
  this.albumEntries = new Map();
};

JSUtils.inherits(AlbumViewImpl, UTClubSearchResultsView);

AlbumViewImpl.prototype._generate = function () {
  UTClubSearchResultsView.prototype._generate.call(this);
  if (this.albumGenerated) {
    return;
  }
  const root = this.__root;
  addClasses(root, "album-view");
  hideElements(root);
  const filtersContainer = createElement("div", {
    className: "album-filters",
  });
  const addFilterDropdown = (labelKey, providerType) => {
    const label = createElement("label");
    label.textContent = translateAlbumViewText(labelKey);
    const dropdown = providerType
      ? new DataProviderDropdownControl(providerType)
      : new UTDropDownControl();
    if (!providerType) {
      dropdown.init();
    }
    appendElements(label, dropdown);
    appendElements(filtersContainer, label);
    return dropdown;
  };
  this.league = addFilterDropdown("league", dataProviderType.League);
  this.club = addFilterDropdown("club", dataProviderType.Team);
  this.sortBy = addFilterDropdown("sortBy");
  this.sortBy.setOptions(
    ["rating", "name", "gradingScore", "tracked"].map((sortKey) => ({
      id: sortKey,
      value: sortKey,
      label: translateAlbumViewText("sort." + sortKey),
    })),
  );
  const lastSelection = configuration.plugins.album.lastSelection || {};
  this.sortBy.setIndex(
    Math.max(0, ["rating", "name", "gradingScore", "tracked"].indexOf(lastSelection.sortBy)),
  );
  this.league.refresh();
  this.league.setIndex(
    Math.max(
      0,
      DataProviderDropdownControl.getOptions(dataProviderType.League).findIndex(
        (option) => Number(option.value) === lastSelection.leagueId,
      ),
    ),
  );
  const leagueId = Number(this.league.getValue());
  this.club.refresh({
    leagueId: leagueId,
  });
  this.club.setIndex(
    Math.max(
      0,
      DataProviderDropdownControl.getOptions(dataProviderType.Team, leagueId).findIndex(
        (option) => Number(option.value) === lastSelection.clubId,
      ),
    ),
  );
  this.sortBy.addTarget(this, this._sortChanged, EventType.CHANGE);
  this.league.addTarget(this, this._leagueChanged, EventType.CHANGE);
  this.club.addTarget(this, this._clubChanged, EventType.CHANGE);
  this.status = createElement("p", {
    role: "status",
  });
  this.status.textContent = translateAlbumViewText("selectClub");
  const hint = createElement("p", {
    className: "album-hint",
  });
  hint.textContent = translateAlbumViewText("hint");
  addClasses(this._list.__itemList, "album-grid");
  const header = createElement("div", {
    className: "album-header",
  });
  appendElements(header, filtersContainer, hint, this.status);
  prependElements(root, header);
  this.albumGenerated = true;
};

AlbumViewImpl.prototype._leagueChanged = function () {
  this.club.refresh({
    leagueId: Number(this.league.getValue()),
  });
  this.club.setIndex(0);
  this._clubChanged();
};

AlbumViewImpl.prototype._clubChanged = function () {
  this._saveSelection();
  this.onClubChanged.notify({
    club: Number(this.club.getValue()),
  });
};

AlbumViewImpl.prototype._sortChanged = function () {
  this._saveSelection();
  this.onSortChanged.notify({
    sortBy: this.sortBy.getValue(),
  });
};

AlbumViewImpl.prototype.getSelection = function () {
  return {
    leagueId: Number(this.league.getValue()),
    clubId: Number(this.club.getValue()),
    sortBy: this.sortBy.getValue(),
  };
};

AlbumViewImpl.prototype._saveSelection = function () {
  configuration.plugins.album.lastSelection = this.getSelection();
  persistConfiguration();
};

AlbumViewImpl.prototype.clearCardListeners = function () {
  this.cardListeners.forEach(([cardElement, cardListener]) =>
    stopListeningForEvent(cardElement, "click", cardListener),
  );
  this.cardListeners = [];
};

AlbumViewImpl.prototype.clearCards = function () {
  this.clearCardListeners();
  this._list.removeListRows();
};

AlbumViewImpl.prototype.setStatus = function (statusText) {
  this.status.textContent = statusText;
};

AlbumViewImpl.prototype.setAlbumEntries = function (albumEntries) {
  this.albumEntries = new Map(albumEntries.map((entry) => [entry.item.definitionId, entry]));
};

AlbumViewImpl.prototype.setEmptyListMessage = function () {
  this.clearCards();
  this.setStatus(translateAlbumViewText("empty"));
};

AlbumViewImpl.prototype.setItems = function (listItems, ...otherArguments) {
  this.clearCardListeners();
  UTClubSearchResultsView.prototype.setItems.call(this, listItems, ...otherArguments);
  for (const row of this._list.getRows()) {
    const item = row.getData();
    const { status: entryStatus, canMarkFirstOwner: canMarkFirstOwner } = this.albumEntries.get(
      item.definitionId,
    );
    addClasses(row, "album-player", "album-" + entryStatus);
    const nameLabel = createElement("p", {
      className: "album-player-name",
    });
    nameLabel.textContent = item.getStaticData().name || "";
    const actionsContainer = createElement("div", {
      className: "album-player-actions",
    });
    const addActionButton = (labelKey, onClick) => {
      const button = createElement("button", {
        className: "btn-standard mini primary",
        type: "button",
      });
      button.textContent = translateAlbumViewText(labelKey);
      const clickListener = (event) => {
        event.stopPropagation();
        onClick();
      };
      listenForEvent(button, "click", clickListener);
      this.cardListeners.push([button, clickListener]);
      appendElements(actionsContainer, button);
      return button;
    };
    if (!item.isCollected) {
      addActionButton("market", () =>
        this.onMarketClicked.notify({
          definitionId: item.definitionId,
        }),
      );
    }
    const pluginSettings = configuration.plugins[this.selectedCards ? "gallery" : "album"];
    if (
      !item.isCollected &&
      configuration.enabled &&
      pluginSettings.enabled &&
      pluginSettings.buyEnabled
    ) {
      addActionButton("buy", () =>
        this.onBuyClicked.notify({
          definitionId: item.definitionId,
        }),
      );
    }
    if (item.isCollected && canMarkFirstOwner) {
      const firstOwnerButton = addActionButton("markFirstOwner", () =>
        this.onFirstOwnerClicked.notify({
          definitionId: item.definitionId,
        }),
      );
      firstOwnerButton.textContent = "";
      firstOwnerButton.setAttribute("aria-label", translateAlbumViewText("markFirstOwner"));
      firstOwnerButton.setAttribute("title", translateAlbumViewText("markFirstOwner"));
      appendElements(
        firstOwnerButton,
        createElement("span", {
          className: "fut_icon icon_chemistry_first_owner",
        }),
      );
    }
    appendElements(row, nameLabel, actionsContainer);
  }
  this.setStatus(
    this.albumEntries.size
      ? translateAlbumViewText("players") + ": " + this.albumEntries.size
      : translateAlbumViewText("empty"),
  );
};

AlbumViewImpl.prototype.destroyGeneratedElements = function () {
  this.clearCards();
  this.league.removeTarget(this, this._leagueChanged, EventType.CHANGE);
  this.club.removeTarget(this, this._clubChanged, EventType.CHANGE);
  this.sortBy.removeTarget(this, this._sortChanged, EventType.CHANGE);
  this.sortBy.destroy();
  this.league.destroy();
  this.club.destroy();
  UTClubSearchResultsView.prototype.destroyGeneratedElements.call(this);
};

export const AlbumView = AlbumViewImpl;
