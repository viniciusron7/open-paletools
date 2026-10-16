/**
 * `AddMultiplePlayersSearchResultsViewController`, the `UTClubSearchResultsViewController`
 * subclass pushed by add-multiple-players-to-squad/index.js: tapping a result adds the player to
 * the first empty squad slot via the view model; searches the club (EA original) or SBC storage
 * (`searchSbcStorageItems`).
 *
 * Invariants:
 * - Like the view, `original*` methods are read after `JSUtils.inherits` at module evaluation and
 *   are therefore EA's methods without plugin wrappers.
 * - `updateItemList` drops items whose `endTime !== -1` (on the market) and shows the search
 *   container when nothing is left.
 * - The custom field `searchCriteria.searchType` (default `club`) selects the source; club pages
 *   hold 80 items, storage pages 100 (sorted by rating desc, then definitionId).
 * - The storage branch replaces `clubViewModel.organizeItems` with a no-op during `addArray` so
 *   that order survives, then restores it.
 * - `onSearch` is observed in the constructor (never unobserved); it shows the loading shield,
 *   which each branch hides.
 *
 * Known issues (kept as-is):
 * - The storage search promise has no rejection handler (a failed request leaves the loading
 *   shield up) and `organizeItems` is not restored if `addArray` throws (no `finally`).
 */
import { AddMultiplePlayersSearchResultsView } from "./search-results-view.js";
import { searchSbcStorageItems } from "../../webapp/item-piles.js";
import { hideLoadingShield, showLoadingShield } from "../../webapp/loading-shield.js";

export function AddMultiplePlayersSearchResultsViewController(viewModel, challenge) {
  UTClubSearchResultsViewController.call(this);
  this.clubViewModel = new UTClubViewModel();
  this.clubViewModel.numItemsPerPage = 80;
  this.viewModel = viewModel;
  this.viewModel.onSearch.observe(this, (observable, unusedArgument2) => {
    this.searchCriteria.searchType = this.viewModel.searchType;
    showLoadingShield();
    this._requestItems();
  });
  this._challenge = challenge;
}

JSUtils.inherits(AddMultiplePlayersSearchResultsViewController, UTClubSearchResultsViewController);

AddMultiplePlayersSearchResultsViewController.prototype.onTableCellSelected = function (...args) {
  const item = args[2].item;
  if (item) {
    this.viewModel.addPlayer(item);
    this.getView().selectListRow(item.id);
  }
};

AddMultiplePlayersSearchResultsViewController.prototype._getViewInstanceFromData = function () {
  return new AddMultiplePlayersSearchResultsView(this.viewModel);
};

const originalAddMultiplePlayersControllerUpdateItemList =
  AddMultiplePlayersSearchResultsViewController.prototype.updateItemList;

AddMultiplePlayersSearchResultsViewController.prototype.updateItemList = function (...args) {
  args[0] = args[0].filter((item) => -1 === item.endTime);
  originalAddMultiplePlayersControllerUpdateItemList.call(this, ...args);
  if (args[0].length === 0) {
    this.getView().displaySearchContainer();
  }
};

const originalAddMultiplePlayersControllerRequestItems =
  AddMultiplePlayersSearchResultsViewController.prototype._requestItems;

AddMultiplePlayersSearchResultsViewController.prototype._requestItems = function (...args) {
  this.searchCriteria.searchType = this.searchCriteria.searchType || "club";
  if (this.searchCriteria.searchType == "club") {
    this.clubViewModel.numItemsPerPage = 80;
    originalAddMultiplePlayersControllerRequestItems.call(this, ...args);
    hideLoadingShield();
  } else {
    const storageSearchCriteria = new UTSearchCriteriaDTO();
    storageSearchCriteria.update(this.searchCriteria);
    searchSbcStorageItems(storageSearchCriteria, false, true).then((searchResponse) => {
      this.clubViewModel.numItemsPerPage = 100;
      this.clubViewModel.sort = this.searchCriteria.sort;
      this.clubViewModel.sortType = this.searchCriteria.sortBy;
      this.clubViewModel.resetCollection([]);
      let storageItems = searchResponse.response.items;
      storageItems.sort((left, right) =>
        right.rating !== left.rating
          ? right.rating - left.rating
          : left.definitionId - right.definitionId,
      );
      const originalOrganizeItems = this.clubViewModel.organizeItems;
      this.clubViewModel.organizeItems = () => {};
      this.clubViewModel.addArray(storageItems);
      this.clubViewModel.organizeItems = originalOrganizeItems;
      this.clubViewModel.isFull = searchResponse.response.endOfList;
      this.clubViewModel.setIndex(0);
      this.updateItemList(this.clubViewModel.getPageItems(), true);
      hideLoadingShield();
    });
  }
};
