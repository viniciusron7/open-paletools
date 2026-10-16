/**
 * `AddMultiplePlayersSearchResultsView`, the `UTClubSearchResultsView` subclass created by
 * `AddMultiplePlayersSearchResultsViewController`: pins the squad slots view, shows an SBC
 * summary banner (rating, chemistry, requirements progress and popup), club / SBC-storage source
 * buttons and a group-by dropdown (nation, league, team) that reorders rows under group headings.
 *
 * Invariants:
 * - The `original*` bindings are read from the subclass prototype at module evaluation, right
 *   after `JSUtils.inherits`: they hold EA's `UTClubSearchResultsView` methods as they were
 *   before any plugin `run()`, so later plugin wrappers on that prototype (e.g. lock-players'
 *   `setItems`) do not run for this view. Keep the inherits call before these reads.
 * - `setItems` keeps the unfiltered items and extra args in `_ungroupedItems`/`_groupRenderArgs`
 *   for `_groupChanged`; `_clearGroupHeaders` must run in `setItems`, `setEmptyListMessage` and
 *   `destroyGeneratedElements`.
 * - Group headings (`li.add-multiple-group-heading`, kept in `_groupHeaders`) are inserted before
 *   the first row of each group, so the item array passed to EA must stay in group order.
 * - The source buttons set `viewModel.searchType` to `club` / `sbcstorage` and notify `onSearch`
 *   (handled by the controller); header controls are added once (`_sbcStorageAdded`).
 * - The banner rating calls `UTSquadEntity.prototype.getDecimalRating`, installed by the
 *   decimal-rating plugin's `run()`; progress total is `eligibilityRequirements.length + 1`.
 * - `onPlayerAdded`/`onPlayerRemoved` observers added here are never removed.
 *
 * Known issues (kept as-is):
 * - `viewModel.displayLoans` is never defined by `AddMultiplePlayersViewModel`, so loan items are
 *   always filtered out.
 */
import {
  addClasses,
  appendElements,
  createElement,
  insertAfter,
  prependElements,
} from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { AddMultiplePlayersSquadSlotsView } from "./squad-slots-view.js";
import { hideElements, showElements } from "../../ui/visibility.js";

export function AddMultiplePlayersSearchResultsView(viewModel) {
  this.viewModel = viewModel;
  UTClubSearchResultsView.call(this);
  this.appendPinnedItemView(new AddMultiplePlayersSquadSlotsView(viewModel));
}

JSUtils.inherits(AddMultiplePlayersSearchResultsView, UTClubSearchResultsView);

const originalAddMultiplePlayersViewSetItems =
  AddMultiplePlayersSearchResultsView.prototype.setItems;

AddMultiplePlayersSearchResultsView.prototype.setItems = function (...args) {
  this._clearGroupHeaders();
  this._ungroupedItems = [...args[0]];
  this._groupRenderArgs = args.slice(1);
  if (!this.viewModel.displayLoans) {
    args[0] = args[0].filter((item) => -1 === item.loans);
  }
  const groupByField = this._groupBy?.getValue() || "none";
  const groupOptions =
    groupByField === "nation"
      ? factories.DataProvider.getNationDP()
      : groupByField === "league"
        ? factories.DataProvider.getLeagueDP()
        : groupByField === "team"
          ? factories.DataProvider.getTeamDP()
          : [];
  const itemGroups = (function (ungroupedItems, groupField, groupOptions) {
    const itemGroupProperty = {
      nation: "nationId",
      league: "leagueId",
      team: "teamId",
    }[groupField];
    if (!itemGroupProperty) {
      return [];
    }
    const labelsById = new Map(groupOptions.map((option) => [Number(option.id), option.label]));
    const groupsById = new Map();
    for (const item of ungroupedItems) {
      const groupId = Number(item[itemGroupProperty]);
      if (!groupsById.has(groupId)) {
        groupsById.set(groupId, {
          id: groupId,
          label: labelsById.get(groupId) || String(item[itemGroupProperty] ?? "—"),
          items: [],
        });
      }
      groupsById.get(groupId).items.push(item);
    }
    return [...groupsById.values()].sort(
      (left, right) =>
        left.label.localeCompare(right.label, undefined, {
          sensitivity: "base",
        }) || left.id - right.id,
    );
  })(args[0], groupByField, groupOptions);
  if (itemGroups.length) {
    args[0] = itemGroups.flatMap((group) => group.items);
  }
  originalAddMultiplePlayersViewSetItems.call(this, ...args);
  const rows = this._list.getRows();
  let rowIndex = 0;
  for (const group of itemGroups) {
    const groupHeading = createElement("li", {
      className: "add-multiple-group-heading",
    });
    groupHeading.textContent = group.label + " (" + group.items.length + ")";
    const rootElement = rows[rowIndex]?.getRootElement();
    if (rootElement) {
      rootElement.parentNode.insertBefore(groupHeading, rootElement);
      this._groupHeaders.push(groupHeading);
    }
    rowIndex += group.items.length;
  }
};

AddMultiplePlayersSearchResultsView.prototype._clearGroupHeaders = function () {
  this._groupHeaders?.forEach((groupHeader) => groupHeader.remove());
  this._groupHeaders = [];
};

AddMultiplePlayersSearchResultsView.prototype._groupChanged = function () {
  if (this._ungroupedItems) {
    this.setItems(this._ungroupedItems, ...this._groupRenderArgs);
    this.setRowTapCallback();
  }
};

const originalAddMultiplePlayersViewSetEmptyListMessage =
  AddMultiplePlayersSearchResultsView.prototype.setEmptyListMessage;

AddMultiplePlayersSearchResultsView.prototype.setEmptyListMessage = function (...args) {
  this._clearGroupHeaders();
  this._ungroupedItems = null;
  originalAddMultiplePlayersViewSetEmptyListMessage.call(this, ...args);
};

const originalAddMultiplePlayersViewDestroyGeneratedElements =
  AddMultiplePlayersSearchResultsView.prototype.destroyGeneratedElements;

AddMultiplePlayersSearchResultsView.prototype.destroyGeneratedElements = function (...args) {
  this._clearGroupHeaders();
  this._ungroupedItems = null;
  if (this._groupBy) {
    this._groupBy.removeTarget(this, this._groupChanged, EventType.CHANGE);
    this._groupBy.destroy();
    this._groupBy = null;
  }
  this._groupContainer?.remove();
  originalAddMultiplePlayersViewDestroyGeneratedElements.call(this, ...args);
};

AddMultiplePlayersSearchResultsView.prototype.displaySearchContainer = function () {
  showElements(this.header.__searchContainer);
};

const originalAddMultiplePlayersViewGenerate =
  AddMultiplePlayersSearchResultsView.prototype._generate;

AddMultiplePlayersSearchResultsView.prototype._generate = function (...args) {
  originalAddMultiplePlayersViewGenerate.call(this, ...args);
  addClasses(this, "sbc-add-multiple-players");
  this._summaryView = new UTSBCSquadSummaryBannerView();
  this._summaryView.init();
  this._summaryView.getRequirementsButton().addTarget(
    this,
    (control) => {
      var requirementsPopupController = new UTSBCRequirementsPopupViewController(
        this.viewModel.set,
        this.viewModel.sbcChallenge.id,
        true,
      );
      requirementsPopupController.onExit.observe(this, (observable, unusedArgument2) => {
        this._summaryView.getRequirementsButton().setChecked(false);
      });
      if (isPhone()) {
        requirementsPopupController.modalDisplayDimensions.width = "400px";
      } else {
        requirementsPopupController.modalDisplayDimensions.minWidth = "400px";
      }
      hideElements(requirementsPopupController.getView()._btnConfirm);
      gPopupClickShield.setActivePopup(requirementsPopupController);
    },
    EventType.TAP,
  );
};

const originalAddMultiplePlayersViewSetItemTypeHeader =
  AddMultiplePlayersSearchResultsView.prototype.setItemTypeHeader;

AddMultiplePlayersSearchResultsView.prototype.setItemTypeHeader = function (...args) {
  originalAddMultiplePlayersViewSetItemTypeHeader.call(this, ...args);
  if (!this._sbcStorageAdded) {
    const btnClubSearch = new UTStandardButtonControl();
    btnClubSearch.init();
    btnClubSearch.setText(translate("nav.label.club"));
    btnClubSearch.getRootElement().classList.add("mini");
    btnClubSearch.addTarget(
      this,
      () => {
        this.viewModel.searchType = "club";
        this.viewModel.onSearch.notify();
        hideElements(btnClubSearch);
        showElements(btnStorageSearch);
      },
      EventType.TAP,
    );
    this._btnClubSearch = btnClubSearch;
    const btnStorageSearch = new UTStandardButtonControl();
    btnStorageSearch.init();
    btnStorageSearch.setText(translate("search.searchmode.storage"));
    btnStorageSearch.getRootElement().classList.add("mini");
    btnStorageSearch.addTarget(
      this,
      () => {
        this.viewModel.searchType = "sbcstorage";
        this.viewModel.onSearch.notify();
        hideElements(btnStorageSearch);
        showElements(btnClubSearch);
      },
      EventType.TAP,
    );
    hideElements(btnClubSearch);
    this._btnStorageSearch = btnStorageSearch;
    const updateSummaryBanner = () => {
      this._summaryView.setRating(this.viewModel.squad.getDecimalRating());
      this._summaryView.setChemistry(this.viewModel.squad.getChemistry());
      if (this.viewModel.sbcChallenge) {
        this._summaryView.setChallengeProgress(
          this.viewModel.sbcChallenge.getNumberOfRequirementsMet(),
          this.viewModel.sbcChallenge.eligibilityRequirements.length + 1,
        );
      }
    };
    this.viewModel.onPlayerAdded.observe(this, (observable, item) => {
      updateSummaryBanner();
    });
    this.viewModel.onPlayerRemoved.observe(this, (observable, item) => {
      updateSummaryBanner();
    });
    updateSummaryBanner();
    if (isPhone()) {
      appendElements(this.header, this._summaryView);
    } else {
      prependElements(this.header.__searchContainer, this._summaryView);
    }
    appendElements(this.header.__searchContainer, btnClubSearch, btnStorageSearch);
    this._groupContainer = createElement("div", {
      className: "add-multiple-group-filter",
    });
    this._groupBy = new UTDropDownControl();
    this._groupBy.init();
    this._groupBy.setOptions(
      ["none", "nation", "league", "team"].map((groupByOption) => ({
        id: groupByOption,
        value: groupByOption,
        label:
          groupByOption === "none"
            ? "-- " + translate("groupBy") + " --"
            : translate("groupBy." + groupByOption),
      })),
    );
    this._groupBy.getRootElement().setAttribute("aria-label", translate("groupBy"));
    this._groupBy.setIndex(0);
    this._groupBy.addTarget(this, this._groupChanged, EventType.CHANGE);
    appendElements(this._groupContainer, this._groupBy);
    insertAfter(this._groupContainer, this.header.__searchContainer);
    this._sbcStorageAdded = true;
  }
};
