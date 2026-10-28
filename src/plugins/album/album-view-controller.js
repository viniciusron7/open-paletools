/**
 * `AlbumViewController` (extends `UTClubSearchResultsViewController`): loads every concept player
 * of the selected club, adds owner info, sorts and renders the album, and opens market searches,
 * buys cards (Buy button, 27.2.1) or records first owners. Pushed by the album home-hub tile
 * (album/index.js) and extended by `GalleryViewController`.
 *
 * Invariants:
 * - Async work is guarded by `requestId` (incremented per request, in `viewWillDisappear` and
 *   `dealloc`) and re-checked after every await; requests run only while `active` (set in
 *   `viewDidAppear`, cleared on disappear/dealloc).
 * - `init` runs once (`initialized`): observes the view, then calls `this._restoreSelection()`
 *   polymorphically (GalleryViewController overrides it).
 * - `viewWillDisappear` calls the super method only if `viewDidAppear` set `nativeViewAppeared`.
 * - The loading shield of item requests and market clicks is owned by `_startItemsLoader`: it
 *   stops the previous loader, shows the shield and returns a release function (hides it once);
 *   `_stopItemsLoader` releases the current one and runs on disappear, `dealloc` and every new
 *   request.
 * - Club searches are cached in `albumClubPlayersCache`; a rejected promise is evicted only if
 *   the cache still holds that same promise, and the error is re-thrown.
 * - `_renderAlbum` replaces `clubViewModel.organizeItems` with a no-op during `addArray`
 *   (restored in `finally`) so EA does not re-sort; it renders page 0 with
 *   `numItemsPerPage = 100`.
 * - `_firstOwnerClicked` stores `trackedPlayers.add(definitionId, 1)`, checks the `gallery` or
 *   `album` flag depending on `this.selectedCards` (only the gallery has it) and calls
 *   `this._updateGrade?.()`.
 * - `_marketClicked` (one at a time, `marketPending`) presets `maxBuy` from
 *   `findLowestMarketPrices` (errors ignored) and clears the transfer-market cache before
 *   pushing the market search, unless the view went away or the plugin was disabled meanwhile.
 * - `_buyClicked` (one at a time, `buyPending`; needs the plugin's `enabled` and `buyEnabled`)
 *   makes a real purchase: it finds the cheapest active offer of that exact definitionId
 *   (up to 10 searches of 100 results without result overrides, lowering `maxBuy` one price
 *   step below the cheapest each time), asks for confirmation with the card and price
 *   (`showDialog`), buys it with `buyFirstActiveItem` only if the price is unchanged, then shows
 *   `AlbumBoughtDialogController` and moves the card to the club or the transfer list. Errors
 *   show `buyUnavailable`, `buyMoveError` or `buyError`; the album reloads after a purchase.
 */
import { searchConceptItemsPaged } from "../../club/concept-items.js";
import { configuration } from "../../config/configuration.js";
import { appendElements, createElement } from "../../core/dom.js";
import { paletoolsDatabase } from "../../db/database.js";
import { formatNumber, translate } from "../../i18n/translations.js";
import { buyFirstActiveItem } from "../../market/item-actions.js";
import { findLowestMarketPrices } from "../../market/lowest-price-search.js";
import { decreasePriceByOneStep } from "../../market/prices.js";
import { AlbumBoughtDialogController } from "./album-bought-dialog.js";
import {
  addOwnersToAlbumEntries,
  albumClubPlayersCache,
  createAlbumEntries,
  registerAlbumCacheInvalidation,
} from "./album-data.js";
import { AlbumView } from "./album-view.js";
import { showDialog } from "../../ui/dialog.js";
import { showErrorNotification, showSuccessNotification } from "../../ui/notifications.js";
import { showElements } from "../../ui/visibility.js";
import { moveItemsToClub, moveItemsToTransferList } from "../../webapp/item-piles.js";
import { hideLoadingShield, showLoadingShield } from "../../webapp/loading-shield.js";
import { observableToPromiseWithTimeout } from "../../webapp/observable.js";

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
    this.getView().onBuyClicked.observe(this, this._buyClicked);
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
  this._stopItemsLoader();
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

AlbumViewControllerImpl.prototype._stopItemsLoader = function () {
  this._releaseItemsLoader?.();
  this._releaseItemsLoader = null;
};

AlbumViewControllerImpl.prototype._startItemsLoader = function () {
  this._stopItemsLoader();
  let isLoaderShown = true;
  showLoadingShield();
  const releaseItemsLoader = () => {
    if (isLoaderShown) {
      isLoaderShown = false;
      hideLoadingShield();
    }
  };
  this._releaseItemsLoader = releaseItemsLoader;
  return releaseItemsLoader;
};

AlbumViewControllerImpl.prototype._requestItems = async function () {
  if (!this.active) {
    return;
  }
  this._stopItemsLoader();
  const requestId = ++this.requestId;
  const view = this.getView();
  this.albumEntries = [];
  this.clubViewModel.resetCollection([]);
  this.updateItemList([], true);
  if (!configuration.enabled || !configuration.plugins.album.enabled) {
    return void view.setStatus(translateAlbumControllerText("disabled"));
  }
  if (!Number.isSafeInteger(this.selectedClub) || this.selectedClub < 0) {
    return void view.setStatus(translateAlbumControllerText("selectClub"));
  }
  view.setStatus(translateAlbumControllerText("loading"));
  const releaseItemsLoader = this._startItemsLoader();
  try {
    if (requestId !== this.requestId) {
      return;
    }
    const albumEntries = await addOwnersToAlbumEntries(
      await (async function (clubId) {
        registerAlbumCacheInvalidation();
        const clubPlayers = await (function (club) {
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
        })(clubId);
        return createAlbumEntries(clubPlayers);
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
    releaseItemsLoader();
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
  const requestId = this.requestId;
  const pluginSettings = configuration.plugins[this.selectedCards ? "gallery" : "album"];
  const canOpenMarket = () =>
    this.active && requestId === this.requestId && configuration.enabled && pluginSettings.enabled;
  if (!canOpenMarket() || this.marketPending) {
    return;
  }
  this.marketPending = true;
  const searchCriteria = new UTSearchCriteriaDTO();
  searchCriteria.type = SearchType.PLAYER;
  searchCriteria.defId = [definitionId];
  const releaseItemsLoader = this._startItemsLoader();
  try {
    const lowestPrices = await findLowestMarketPrices(definitionId);
    if (lowestPrices.length) {
      searchCriteria.maxBuy = lowestPrices[0].value;
    }
  } catch {
  } finally {
    releaseItemsLoader();
    this.marketPending = false;
  }
  if (!canOpenMarket()) {
    return;
  }
  const marketSearchController = isPhone()
    ? new UTMarketSearchResultsViewController()
    : new UTMarketSearchResultsSplitViewController();
  services.Item.clearTransferMarketCache();
  marketSearchController.initWithSearchCriteria(searchCriteria);
  this.getNavigationController().pushViewController(marketSearchController);
};

AlbumViewControllerImpl.prototype._buyClicked = async function (
  observable,
  { definitionId: definitionId },
) {
  const requestId = this.requestId;
  const pluginSettings = configuration.plugins[this.selectedCards ? "gallery" : "album"];
  const canBuy = () =>
    this.active &&
    requestId === this.requestId &&
    configuration.enabled &&
    pluginSettings.enabled &&
    pluginSettings.buyEnabled;
  if (!canBuy() || this.buyPending) {
    return;
  }
  this.buyPending = true;
  let isLoaderShown = false;
  const showBuyLoader = () => {
    isLoaderShown = true;
    showLoadingShield();
  };
  const hideBuyLoader = () => {
    if (isLoaderShown) {
      isLoaderShown = false;
      hideLoadingShield();
    }
  };
  let cardView;
  showBuyLoader();
  try {
    const cheapestItem = await (async function (searchDefinitionId, shouldContinue = () => true) {
      const searchCriteria = new UTSearchCriteriaDTO();
      searchCriteria.type = SearchType.PLAYER;
      searchCriteria.defId = [searchDefinitionId];
      searchCriteria.count = 100;
      searchCriteria.disableOverrides = true;
      let cheapest = null;
      for (let page = 0; page < 10 && shouldContinue(); page++) {
        services.Item.clearTransferMarketCache();
        const response = await observableToPromiseWithTimeout(
          services.Item.searchTransferMarket(searchCriteria, 1),
        );
        if (!shouldContinue()) {
          return null;
        }
        if (!response?.success || response.error || Number(response.status) >= 400) {
          throw new Error("search");
        }
        const items = response.data?.items;
        if (!Array.isArray(items)) {
          throw new Error("search");
        }
        for (const item of items) {
          const auctionData = item.getAuctionData();
          // Only active offers of this exact card with a valid buy-now price.
          if (
            !(
              Number(item.definitionId) !== Number(searchDefinitionId) ||
              auctionData._tradeState !== AuctionTradeStateEnum.ACTIVE ||
              !Number.isFinite(auctionData.buyNowPrice) ||
              auctionData.buyNowPrice <= 0
            )
          ) {
            if (!cheapest || auctionData.buyNowPrice < cheapest.getAuctionData().buyNowPrice) {
              cheapest = item;
            }
          }
        }
        if (!cheapest || items.length < searchCriteria.count) {
          return cheapest;
        }
        searchCriteria.maxBuy = decreasePriceByOneStep(cheapest.getAuctionData().buyNowPrice);
        if (searchCriteria.maxBuy <= 0) {
          return cheapest;
        }
      }
      if (!shouldContinue()) {
        return null;
      }
      throw new Error("search");
    })(definitionId, canBuy);
    if (!canBuy()) {
      return;
    }
    if (!cheapestItem) {
      return void showErrorNotification(translateAlbumControllerText("buyUnavailable"));
    }
    const buyNowPrice = cheapestItem.getAuctionData().buyNowPrice;
    const dialogContent = createElement("div", {
      className: "album-buy-dialog",
    });
    cardView = UTItemViewFactory.createLargeItem(cheapestItem);
    cardView.init();
    cardView.render(cheapestItem);
    const priceText = createElement("p");
    priceText.textContent =
      translateAlbumControllerText("lowestPrice") + ": " + formatNumber(buyNowPrice);
    appendElements(dialogContent, cardView, priceText);
    hideBuyLoader();
    if (
      (await new Promise((resolve) =>
        showDialog(
          [
            {
              labelEnum: enums.UIDialogOptions.OK,
            },
            {
              labelEnum: enums.UIDialogOptions.CANCEL,
            },
          ],
          translateAlbumControllerText("buy"),
          dialogContent,
          resolve,
        ),
      )) !== enums.UIDialogOptions.OK ||
      !canBuy()
    ) {
      return;
    }
    showBuyLoader();
    const boughtItem = await (async function (item, expectedPrice) {
      if (item.getAuctionData().buyNowPrice !== expectedPrice) {
        throw new Error("purchase");
      }
      const purchaseResult = await buyFirstActiveItem([item]);
      if (!purchaseResult?.success) {
        throw new Error("purchase");
      }
      return purchaseResult.item;
    })(cheapestItem, buyNowPrice);
    hideBuyLoader();
    cardView.destroy();
    cardView = null;
    const destination = await (function (item) {
      return new Promise((resolve) => {
        const dialogController = new AlbumBoughtDialogController(item);
        dialogController.init();
        dialogController.onExit.observe(dialogController, function (sender, choice) {
          sender.unobserve(this);
          resolve(choice);
        });
        gPopupClickShield.setActivePopup(dialogController);
      });
    })(boughtItem);
    if (!(destination !== "club" && destination !== "transferList")) {
      showBuyLoader();
      await (async function (item, pile) {
        if (pile !== "club" && pile !== "transferList") {
          throw new Error("move");
        }
        try {
          const moveResult = await (pile === "club"
            ? moveItemsToClub([item])
            : moveItemsToTransferList([item]));
          if (!moveResult?.success || moveResult.error || Number(moveResult.status) >= 400) {
            throw new Error("move");
          }
        } catch {
          throw new Error("move");
        }
      })(boughtItem, destination);
      hideBuyLoader();
      showSuccessNotification(
        translateAlbumControllerText(destination === "club" ? "buySuccess" : "buyTransferSuccess"),
      );
    }
    if (canBuy()) {
      await this._requestItems();
    }
  } catch (error) {
    showErrorNotification(
      translateAlbumControllerText(error.message === "move" ? "buyMoveError" : "buyError"),
    );
  } finally {
    hideBuyLoader();
    this.buyPending = false;
    cardView?.destroy();
  }
};

AlbumViewControllerImpl.prototype.dealloc = function () {
  this.requestId++;
  this.getView().onClubChanged.unobserve(this);
  this.getView().onSortChanged.unobserve(this);
  this.getView().onMarketClicked.unobserve(this);
  this.getView().onBuyClicked.unobserve(this);
  this.getView().onFirstOwnerClicked.unobserve(this);
  this.active = false;
  this._stopItemsLoader();
  UTClubSearchResultsViewController.prototype.dealloc.call(this);
};

export const AlbumViewController = AlbumViewControllerImpl;
