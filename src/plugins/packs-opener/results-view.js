/**
 * `PacksOpenerResultsViewController` (exported) and its private `PacksOpenerResultsView`: the
 * screen pushed by `showPacksOpenerDialog` (src/plugins/packs-opener/index.js) after a run, with
 * the statistics summary and one `UTSectionedItemListView` per item destination.
 *
 * Invariants:
 * - Built on the Web App's `EAView`/`EAViewController` via `JSUtils.inherits`: the view sets
 *   `__root` and `generated` in `_generate`; the controller creates it in
 *   `_getViewInstanceFromData` and observes `onCloseClicked` once in `init()`.
 * - The summary is `translate("plugins.packsOpener.packResult.html")` with `{packs}`,
 *   `{players}`, `{playersToClub}` ... `{coinsSpent}`, `{coinsEarned}` placeholders (first
 *   occurrence each); the placeholder names are part of the translation tables.
 * - Sections follow the `PacksOpenerState` item lists (club, storage, transferList, unassigned,
 *   discarded) and sort those arrays in place by rating, descending.
 * - On phones the summary and back button go below the list, otherwise into a right sidebar; it
 *   re-upserts stylesheet `paletools-packs-opener`. Back calls `navigateBack()`.
 */
import { addClasses, appendElements, createElement } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { navigateBack } from "../../webapp/navigation.js";
import packsOpenerStyles from "./packs-opener.css";

function PacksOpenerResultsView(state) {
  this.state = state;
  this.sectionViews = [];
  this.onCloseClicked = new EAObservable();
  EAView.call(this);
}

export function PacksOpenerResultsViewController(state) {
  this.state = state;
  EAViewController.call(this);
}

JSUtils.inherits(PacksOpenerResultsView, EAView);

PacksOpenerResultsView.prototype.dealloc = function () {
  this.onCloseClicked.dealloc();
  this.onCloseClicked = null;
  this.sectionViews.forEach((sectionView) => sectionView.dealloc());
  this.sectionViews = [];
};

PacksOpenerResultsView.prototype._getGroups = function () {
  const compareByRatingDescending = (left, right) => right.rating - left.rating;
  return [
    {
      key: "club",
      items: this.state.clubItems.sort(compareByRatingDescending),
      title: "plugins.packsOpener.results.club",
    },
    {
      key: "storage",
      items: this.state.storageItems.sort(compareByRatingDescending),
      title: "plugins.packsOpener.results.storage",
    },
    {
      key: "transferList",
      items: this.state.transferListItems.sort(compareByRatingDescending),
      title: "plugins.packsOpener.results.transferList",
    },
    {
      key: "unassigned",
      items: this.state.unassignedItems.sort(compareByRatingDescending),
      title: "plugins.packsOpener.results.unassigned",
    },
    {
      key: "discarded",
      items: this.state.discardedItems.sort(compareByRatingDescending),
      title: "plugins.packsOpener.results.discarded",
    },
  ];
};

PacksOpenerResultsView.prototype._createSection = function (group) {
  const sectionView = new UTSectionedItemListView();
  sectionView.init();
  sectionView.setActionHeader(translate(group.title) + " (" + group.items.length + ")");
  sectionView.addItems(group.items);
  sectionView.render();
  this.sectionViews.push(sectionView);
  return sectionView;
};

PacksOpenerResultsView.prototype._getStats = function () {
  const statsPlaceholders = {
    packs: this.state.packsOpened,
    players: this.state.players,
    playersToClub: this.state.playersToClub,
    playersToTransfer: this.state.playersToTransferList,
    playersDiscarded: this.state.playersDiscarded,
    playersToSbcStorage: this.state.playersToSbcStorage,
    duplicatedPlayers: this.state.duplicatedPlayers,
    managers: this.state.managers,
    managersToClub: this.state.managersToClub,
    managersToTransfer: this.state.managersToTransferList,
    managersDiscarded: this.state.managersDiscarded,
    duplicatedManagers: this.state.duplicatedManagers,
    items: this.state.items,
    itemsToClub: this.state.itemsToClub,
    itemsToTransfer: this.state.itemsToTransferList,
    itemsDiscarded: this.state.itemsDiscarded,
    duplicatedItems: this.state.duplicatedItems,
    coinsSpent: this.state.coinsSpent,
    coinsEarned: this.state.coinsEarned,
  };
  return Object.entries(statsPlaceholders).reduce(
    (html, [placeholderKey, placeholderValue]) =>
      html.replace("{" + placeholderKey + "}", placeholderValue),
    translate("plugins.packsOpener.packResult.html"),
  );
};

PacksOpenerResultsView.prototype._generate = function () {
  upsertStylesheet("paletools-packs-opener", packsOpenerStyles);
  const root = createElement("div", {
    className: isPhone()
      ? "ut-content-container ut-pinned-list-container pack-opener-results"
      : "ut-split-view sidebar-right pack-opener-results",
  });
  const contentContainer = createElement("div", {
    className: "ut-content-container ut-pinned-list-container",
  });
  const content = createElement("div", {
    className: "ut-content",
  });
  const pinnedList = createElement("div", {
    className: "ut-pinned-list",
  });
  const summary = createElement("div", {
    className: "pack-opener-results-summary",
  });
  const summaryHeader = createElement(
    "div",
    {
      className: "ut-list-header",
    },
    translate("plugins.packsOpener.packResult.title"),
  );
  const statsContainer = createElement("div", {
    className: "pack-opener-result",
  });
  const buttonsContainer = createElement("div", {
    className: "sbc-button-container pack-opener-results-buttons",
  });
  const backButton = new UTStandardButtonControl();
  statsContainer.innerHTML = this._getStats();
  backButton.init();
  backButton.setText(translate("infopanel.button.back"));
  backButton.addTarget(this, () => this.onCloseClicked.notify(), EventType.TAP);
  this._getGroups().forEach((group) => appendElements(pinnedList, this._createSection(group)));
  appendElements(content, pinnedList);
  appendElements(contentContainer, content);
  appendElements(summary, summaryHeader, statsContainer);
  appendElements(buttonsContainer, addClasses(backButton, "primary"));
  appendElements(root, contentContainer);
  if (isPhone()) {
    appendElements(content, summary, buttonsContainer);
  } else {
    const sidebar = createElement("div", {
      className: "ut-navigation-container-view ui-layout-right",
    });
    const sidebarContent = createElement("div", {
      className: "ut-content",
    });
    appendElements(sidebarContent, summary, buttonsContainer);
    appendElements(sidebar, sidebarContent);
    appendElements(root, sidebar);
  }
  this.__root = root;
  this.generated = true;
};

JSUtils.inherits(PacksOpenerResultsViewController, EAViewController);

PacksOpenerResultsViewController.prototype._getViewInstanceFromData = function () {
  return new PacksOpenerResultsView(this.state);
};

PacksOpenerResultsViewController.prototype.init = function () {
  if (!this.initialized) {
    this.getView().onCloseClicked.observe(this, this._close);
    this.initialized = true;
  }
};

PacksOpenerResultsViewController.prototype.dealloc = function () {
  this.getView()?.onCloseClicked?.unobserve(this);
};

PacksOpenerResultsViewController.prototype.viewDidAppear = function () {
  this.getNavigationController().setNavigationVisibility(true, true);
};

PacksOpenerResultsViewController.prototype.getNavigationTitle = function () {
  return translate("plugins.packsOpener.packResult.title");
};

PacksOpenerResultsViewController.prototype._close = function () {
  navigateBack();
};
