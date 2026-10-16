/**
 * `AlbumViewController` (extends `UTClubSearchResultsViewController`): loads every concept player
 * of the selected club, adds owner info, sorts and renders the album, and opens market searches
 * or records first owners. Pushed by the album home-hub tile (album/index.js) and extended by
 * `GalleryViewController`.
 *
 * Invariants:
 * - Async work is guarded by `requestId` (incremented per request, in `viewWillDisappear` and
 *   `dealloc`) and re-checked after every await; requests run only while `active` (set in
 *   `viewDidAppear`, cleared on disappear/dealloc).
 * - `init` runs once (`initialized`): observes the view, then calls `this._restoreSelection()`
 *   polymorphically (GalleryViewController overrides it).
 * - `viewWillDisappear` calls the super method only if `viewDidAppear` set `nativeViewAppeared`;
 *   disappear, `dealloc` and the request paths hide the loading shield.
 * - Club searches are cached in `albumClubPlayersCache`; a rejected promise is evicted only if
 *   the cache still holds that same promise, and the error is re-thrown.
 * - `_renderAlbum` replaces `clubViewModel.organizeItems` with a no-op during `addArray`
 *   (restored in `finally`) so EA does not re-sort; it renders page 0 with
 *   `numItemsPerPage = 100`.
 * - `_firstOwnerClicked` stores `trackedPlayers.add(definitionId, 1)`, checks the `gallery` or
 *   `album` flag depending on `this.selectedCards` (only the gallery has it) and calls
 *   `this._updateGrade?.()`.
 * - `_marketClicked` presets `maxBuy` from `findLowestMarketPrices` (errors ignored) and clears
 *   the transfer-market cache before pushing the market search.
 */
import { searchConceptItemsPaged } from "../../club/concept-items.js";
import { configuration } from "../../config/configuration.js";
import { paletoolsDatabase } from "../../db/database.js";
import { translate } from "../../i18n/translations.js";
import { findLowestMarketPrices } from "../../market/lowest-price-search.js";
import {
  addOwnersToAlbumEntries,
  albumClubPlayersCache,
  createAlbumEntries,
  registerAlbumCacheInvalidation,
} from "./album-data.js";
import { AlbumView } from "./album-view.js";
import { showErrorNotification } from "../../ui/notifications.js";
import { showElements } from "../../ui/visibility.js";
import { hideLoadingShield, showLoadingShield } from "../../webapp/loading-shield.js";

const translateAlbumControllerText = (translationKey) =>
  translate("plugins.album." + translationKey);

const AlbumViewControllerImpl = function () {
  UTClubSearchResultsViewController.call(this);
  this.clubViewModel = new UTClubViewModel([]);
  this.searchCriteria.type = SearchType.PLAYER;
  this.searchCriteria.sort = SearchSortOrder.DESCENDING;
  this.searchCriteria.sortBy = SearchSortType.RATING;
  this.displayAsDetails = true;
  this.active = false;
  this.nativeViewAppeared = false;
  this.requestId = 0;
  this.selectedClub = -1;
  this.sortBy = "rating";
  this.albumEntries = [];
};

JSUtils.inherits(AlbumViewControllerImpl, UTClubSearchResultsViewController);

AlbumViewControllerImpl.prototype.init = function () {
  if (!this.initialized) {
    UTClubSearchResultsViewController.prototype.init.call(this);
    this.getView().onClubChanged.observe(this, this._clubChanged);
    this.getView().onSortChanged.observe(this, this._sortChanged);
    this.getView().onMarketClicked.observe(this, this._marketClicked);
    this.getView().onFirstOwnerClicked.observe(this, this._firstOwnerClicked);
    this._restoreSelection();
    this.initialized = true;
  }
};

AlbumViewControllerImpl.prototype._restoreSelection = function () {
  const selection = this.getView().getSelection();
  this.selectedClub = selection.clubId;
  this.searchCriteria.club = selection.clubId;
  this.sortBy = selection.sortBy;
};

AlbumViewControllerImpl.prototype._getViewInstanceFromData = function () {
  return new AlbumView();
};

AlbumViewControllerImpl.prototype.getNavigationTitle = function () {
  return translateAlbumControllerText("settings.title");
};

AlbumViewControllerImpl.prototype.viewDidAppear = async function () {
  const view = this.getView();
  this.active = true;
  this.getNavigationController().setNavigationVisibility(true, true);
  showElements(view);
  this.nativeViewAppeared = true;
  UTClubSearchResultsViewController.prototype.viewDidAppear.call(this);
};

AlbumViewControllerImpl.prototype.viewWillDisappear = function () {
  this.active = false;
  this.requestId++;
  hideLoadingShield();
  if (this.nativeViewAppeared) {
    this.nativeViewAppeared = false;
    UTClubSearchResultsViewController.prototype.viewWillDisappear.call(this);
  }
};

AlbumViewControllerImpl.prototype.setupHeader = function () {
  this.getNavigationController().setNavigationTitle(this.getNavigationTitle());
};

AlbumViewControllerImpl.prototype.setTableCellCallbacks = function () {
  this.getView().disableRowTap();
};

AlbumViewControllerImpl.prototype._clubChanged = function (observable, eventData) {
  this.selectedClub = eventData.club;
  this.searchCriteria.club = eventData.club;
  this.searchCriteria.offset = 0;
  this._requestItems();
};

AlbumViewControllerImpl.prototype._sortChanged = function (observable, { sortBy: sortBy }) {
  if (["rating", "name", "gradingScore", "tracked"].includes(sortBy)) {
    this.sortBy = sortBy;
    if (this.active && this.albumEntries.length) {
      this._renderAlbum();
    }
  }
};

AlbumViewControllerImpl.prototype._getGradingScore = function (item) {
  return item.gradingScore || 0;
};

AlbumViewControllerImpl.prototype._getVisibleEntries = function () {
  return this.albumEntries;
};

AlbumViewControllerImpl.prototype._renderAlbum = function () {
  const visibleItems = this._getVisibleEntries().map((entry) => entry.item);
  const trackedDefinitionIds = new Set(
    this.albumEntries.filter((entry) => entry.tracked).map((entry) => entry.item.definitionId),
  );
  const compareByName = (left, right) =>
    (left.getStaticData().name || "").localeCompare(right.getStaticData().name || "", undefined, {
      sensitivity: "base",
    });
  const compareByRating = (left, right) => (right.rating || 0) - (left.rating || 0);
  const compareByGradingScore = (left, right) =>
    this._getGradingScore(right) - this._getGradingScore(left);
  visibleItems.sort(
    (left, right) =>
      (this.sortBy === "name"
        ? compareByName(left, right)
        : this.sortBy === "gradingScore"
          ? compareByGradingScore(left, right)
          : this.sortBy === "tracked"
            ? Number(trackedDefinitionIds.has(right.definitionId)) -
              Number(trackedDefinitionIds.has(left.definitionId))
            : compareByRating(left, right)) ||
      compareByGradingScore(left, right) ||
      compareByRating(left, right) ||
      compareByName(left, right) ||
      left.definitionId - right.definitionId,
  );
  this.clubViewModel.numItemsPerPage = 100;
  this.clubViewModel.sort = this.searchCriteria.sort;
  this.clubViewModel.sortType = this.searchCriteria.sortBy;
  this.clubViewModel.resetCollection([]);
  const originalOrganizeItems = this.clubViewModel.organizeItems;
  this.clubViewModel.organizeItems = () => {};
  try {
    this.clubViewModel.addArray(visibleItems);
  } finally {
    this.clubViewModel.organizeItems = originalOrganizeItems;
  }
  this.clubViewModel.isFull = true;
  this.searchCriteria.offset = 0;
  this.clubViewModel.setIndex(0);
  this.updateItemList(this.clubViewModel.getPageItems(), true);
};

AlbumViewControllerImpl.prototype._requestItems = async function () {
  if (!this.active) {
    return;
  }
  const requestId = ++this.requestId;
  const view = this.getView();
  this.albumEntries = [];
  this.clubViewModel.resetCollection([]);
  this.updateItemList([], true);
  if (!configuration.enabled || !configuration.plugins.album.enabled) {
    hideLoadingShield();
    return void view.setStatus(translateAlbumControllerText("disabled"));
  }
  if (!Number.isSafeInteger(this.selectedClub) || this.selectedClub < 0) {
    hideLoadingShield();
    return void view.setStatus(translateAlbumControllerText("selectClub"));
  }
  view.setStatus(translateAlbumControllerText("loading"));
  showLoadingShield();
  try {
    if (requestId !== this.requestId) {
      return;
    }
    const albumEntries = await addOwnersToAlbumEntries(
      await (async function (clubId) {
        registerAlbumCacheInvalidation();
        return createAlbumEntries(
          await (function (club) {
            if (!albumClubPlayersCache.has(club)) {
              const searchCriteria = new UTSearchCriteriaDTO();
              searchCriteria.type = SearchType.PLAYER;
              searchCriteria.club = club;
              const searchPromise = searchConceptItemsPaged(searchCriteria, Number.MAX_VALUE).catch(
                (error) => {
                  if (albumClubPlayersCache.get(club) === searchPromise) {
                    albumClubPlayersCache.delete(club);
                  }
                  throw error;
                },
              );
              albumClubPlayersCache.set(club, searchPromise);
            }
            return albumClubPlayersCache.get(club);
          })(clubId),
        );
      })(this.selectedClub),
    );
    if (requestId !== this.requestId) {
      return;
    }
    view.setAlbumEntries(albumEntries);
    this.albumEntries = albumEntries;
    this._renderAlbum();
  } catch {
    if (requestId === this.requestId) {
      view.setStatus(translateAlbumControllerText("error"));
    }
  } finally {
    if (requestId === this.requestId) {
      hideLoadingShield();
    }
  }
};

AlbumViewControllerImpl.prototype._firstOwnerClicked = async function (
  observable,
  { definitionId: definitionId },
) {
  const isPluginEnabled = () =>
    configuration.enabled &&
    configuration.plugins[this.selectedCards ? "gallery" : "album"].enabled;
  if (!this.active || !isPluginEnabled()) {
    return;
  }
  const requestId = this.requestId;
  try {
    await (function (trackedDefinitionId) {
      return paletoolsDatabase.trackedPlayers.add(trackedDefinitionId, 1);
    })(definitionId);
    if (!this.active || requestId !== this.requestId || !isPluginEnabled()) {
      return;
    }
    const matchingEntry = this.albumEntries.find(
      (entry) => entry.item.definitionId === definitionId,
    );
    if (!matchingEntry) {
      return;
    }
    matchingEntry.item.owners = 1;
    matchingEntry.canMarkFirstOwner = false;
    this.getView().setAlbumEntries(this.albumEntries);
    this._renderAlbum();
    this._updateGrade?.();
  } catch {
    if (this.active && requestId === this.requestId) {
      showErrorNotification(translateAlbumControllerText("firstOwnerError"));
    }
  }
};

AlbumViewControllerImpl.prototype._marketClicked = async function (
  observable,
  { definitionId: definitionId },
) {
  const searchCriteria = new UTSearchCriteriaDTO();
  searchCriteria.type = SearchType.PLAYER;
  searchCriteria.defId = [definitionId];
  showLoadingShield();
  try {
    const lowestPrices = await findLowestMarketPrices(definitionId);
    if (lowestPrices.length > 0) {
      searchCriteria.maxBuy = lowestPrices[0].value;
    }
  } catch {}
  hideLoadingShield();
  const marketSearchController = isPhone()
    ? new UTMarketSearchResultsViewController()
    : new UTMarketSearchResultsSplitViewController();
  services.Item.clearTransferMarketCache();
  marketSearchController.initWithSearchCriteria(searchCriteria);
  this.getNavigationController().pushViewController(marketSearchController);
};

AlbumViewControllerImpl.prototype.dealloc = function () {
  this.requestId++;
  this.getView().onClubChanged.unobserve(this);
  this.getView().onSortChanged.unobserve(this);
  this.getView().onMarketClicked.unobserve(this);
  this.getView().onFirstOwnerClicked.unobserve(this);
  this.active = false;
  hideLoadingShield();
  UTClubSearchResultsViewController.prototype.dealloc.call(this);
};

export const AlbumViewController = AlbumViewControllerImpl;
