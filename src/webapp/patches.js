/**
 * Core (non-plugin) overrides of EA Web App prototypes and services. `applyWebAppPatches()` is
 * called exactly once by `bootWhenWebAppReady` (src/bootstrap/boot.js), before
 * `paletoolsDatabase.init()` and every plugin `run()`; `restoreNotificationQueue()` is also called
 * by the bulk-buy and market-automation session flows.
 *
 * Hooks (installed when `applyWebAppPatches()` runs; each wraps the method present then):
 * - `services.Item` `searchTransferMarket`, `list`, `discard`, `bid`, `move`,
 *   `requestUnassignedItems`, `searchStorageItems`; `services.Club.search`;
 *   `UTSBCService.prototype.submitChallenge`.
 * - Market: `UTMarketSearchFiltersViewController.eSearchSelected` and
 *   `UTMarketSearchFiltersView.init` (keep the picked player in the user's
 *   `marketSearchCriteria.maskedDefId`), `UTMarketSearchView.setItems`,
 *   `UTQuickListPanelViewController.renderView` (prices from the lowest-price cache); manual taps
 *   call `clearSnipeRequests()` (filters Search, `UTDefaultActionPanelView.render`,
 *   `UTAuctionActionPanelView.render`, `UTSlotActionPanelView._generate`).
 * - Lists/club/SBC: `UTItemDetailsViewController.onClearSold`, `UTTransferListViewController`
 *   `_clearSold`/`_requestItems`, `UTWatchListViewController._requestItems`,
 *   `UTSearchCriteriaDTO.update`, `UTSquadBuilderViewController.onClubSearchComplete`,
 *   `UTUnassignedItemsViewController._getUnassignedItems`, `UTSBCSetsViewModel.completeRequest`,
 *   `UTSBCSquadDetailPanelView` `_generate`/`destroyGeneratedElements` (run the
 *   src/sbc/squad-detail-panel-hooks.js lists) and `render` (hides `__expireStatus` when the
 *   challenge ends over 365 days away), `UTSBCSetTileView.render`, `initWithSBCSet` of
 *   `UTSBCSquadSplitViewController` and `UTSBCChallengesViewController`.
 * - Views: `UTItemTableCellView`, `UTSquadSlotView`, `UTLargePlayerItemView` (plus new
 *   `addItemValue`), `UTNotificationView.display` (HTML), `UTTransfersHubView._generate`,
 *   `UTDataProviderFactory.getItemRarityDP`, `EAViewController.isViewDisplayed`,
 *   `UTAcademyHubViewController.setupTabs`.
 * - Replaced outright: `EADialogView.setMessage` (Element or innerHTML), `UTDoubleRangeControl`
 *   `_updateTextFieldPossibleRangeValues`/`_handleMinInputChange`/`_handleMaxInputChange`.
 * - `hookPrototypeMethod` after-hooks: `UTItemEntityFactory.createItem` (copies `assists`,
 *   `lifetimeAssists`, `isCollected`), `UTSquadOverviewView._generate`.
 *
 * Invariants:
 * - Call once (a second call double-wraps). Later plugin overrides (player snipe's
 *   `searchTransferMarket`, other `submitChallenge` wrappers, external-market-prices `_generate`
 *   hooks calling `addItemValue`) wrap these and need them installed first.
 * - Each `searchTransferMarket` call runs `restoreNotificationQueue()` FIRST, then saves
 *   `services.Notification.queue` in `originalNotificationQueue` and installs a filter dropping
 *   `translate("popup.error.searcherror")` (EA key), so the saved queue is always EA's own. The
 *   swap also happens with `disableOverrides`; only the next search, `setItems` or a restore call
 *   undoes it.
 * - Without `criteria.disableOverrides` the search returns a NEW `EAObservable`, notified after
 *   the transformers ((items, controller active at request time), native Promises awaited) and
 *   validators ((items, services.Item); the first falsy one sets `response.success = false`) ran
 *   in order; `setItems` handlers run after the original with (items, active controller).
 * - Before the original: `list` records a buy from `lastSalePrice`, `submitChallenge` collects
 *   the squad's players, `onClubSearchComplete` drops locked players
 *   (`playerActions.lockPlayer` and `this.challenge`), `_getUnassignedItems` dirties
 *   PURCHASED/INBOX, `setupTabs` sets `numItemsPerPage` to `Number.MAX_SAFE_INTEGER`.
 * - `Club.search`/`searchStorageItems` force `criteria.count = clubSearchPageSize`; club results
 *   are filtered by `minRating`/`maxRating`/`hideLoans`/`hideLocked` (kept on criteria copies by
 *   the `UTSearchCriteriaDTO.update` override); storage results are sorted client-side.
 * - Payloads: ITEMS_SOLD/ITEMS_WON `{items}`, ITEM_MOVED `{item, itemPile}` (`list` sends
 *   `ItemPile.TRANSFER`), ITEM_DISCARDED `{item}`, ITEM_WON `{item, bid}`, SBC_SUBMITTED
 *   `{challenge, players}`, REQUEST_UNASSIGNED the bare items array.
 * - Plugins and CSS rely on `item-values-container`, `squad-values-container`, `untradeable`,
 *   `__itemValuesContainer`, `__squadValuesContainer` and `addItemValue` (the `UTSquadSlotView`
 *   one ignores `initialValue`). Fixed arity: `UTDefaultActionPanelView.render` forwards 7
 *   arguments, `UTAuctionActionPanelView.render` 2, `UTItemTableCellView.render` 1, `_generate` 0.
 *
 * Known issues (kept as-is):
 * - Transfer-list `_requestItems` marks and dispatches every new item as ITEMS_SOLD without
 *   `isSold()`, so an item first seen unsold is not re-dispatched there once it sells.
 * - A throwing or rejecting transformer/validator leaves the returned observable un-notified.
 * - `UTSBCSetTileView.render` checks `this.data` for the `/` spacing but not for the expiry check.
 * - `_handleMaxInputChange` clamps against `getAbsoluteMin()`, never `getAbsoluteMax()`.
 * - `services.Item.list` dereferences `paletoolsDatabase.transactions`, null when IndexedDB is
 *   unsupported, so listing an item that has `lastSalePrice` then throws.
 * - `EADialogView.prototype.setMessage;` is a leftover no-op statement.
 */
import { clubSearchPageSize } from "../club/club-search.js";
import { isItemLocked } from "../club/locked-items.js";
import { configuration } from "../config/configuration.js";
import { isPromise } from "../core/async.js";
import { toArray } from "../core/collections.js";
import { getCalendarDaysBetween } from "../core/dates.js";
import {
  addClasses,
  appendElements,
  createElement,
  insertBefore,
  removeClasses,
} from "../core/dom.js";
import { dispatchPaletoolsEvent, paletoolsEvents } from "../core/events.js";
import { hookPrototypeMethod, setHookResult } from "../core/prototype-override.js";
import { paletoolsDatabase } from "../db/database.js";
import { translate } from "../i18n/translations.js";
import { reportedSoldItemsById, reportedWonItemsById } from "../market/item-events.js";
import { getCachedLowestMarketPrice } from "../market/lowest-price-cache.js";
import { decreasePriceByOneStep } from "../market/prices.js";
import {
  marketSearchResultTransformers,
  marketSearchResultValidators,
  marketSearchSetItemsHandlers,
} from "../market/search-hooks.js";
import { clearSnipeRequests } from "../plugins/snipe/state.js";
import { setCurrentSbcSet } from "../sbc/current-sbc-set.js";
import {
  sbcSquadDetailPanelDestroyHandlers,
  sbcSquadDetailPanelGenerateHandlers,
} from "../sbc/squad-detail-panel-hooks.js";
import { ItemValueDisplay } from "../ui/components/item-value-display.js";
import { hideElements } from "../ui/visibility.js";
import { getActiveController, getViewModel } from "./navigation.js";

let originalNotificationQueue;

export function restoreNotificationQueue() {
  if (originalNotificationQueue) {
    services.Notification.queue = originalNotificationQueue;
  }
}

export function applyWebAppPatches() {
  (function () {
    const originalESearchSelected = UTMarketSearchFiltersViewController.prototype.eSearchSelected;
    UTMarketSearchFiltersViewController.prototype.eSearchSelected = function () {
      const maskedDefId = getViewModel(this).searchCriteria.maskedDefId;
      originalESearchSelected.call(this);
      services.User.getUser().marketSearchCriteria.maskedDefId = maskedDefId;
    };
  })();
  (function () {
    const originalInit = UTMarketSearchFiltersView.prototype.init;
    UTMarketSearchFiltersView.prototype.init = function (...args) {
      originalInit.call(this, ...args);
      const maskedDefId = services.User.getUser().marketSearchCriteria.maskedDefId;
      if (maskedDefId) {
        this._searchFilters
          .getPlayerNameSearch()
          .setPlayerData(repositories.Item.getStaticDataByDefId(maskedDefId));
      }
      this._searchButton.addTarget(
        this,
        () => {
          clearSnipeRequests();
        },
        EventType.TAP,
      );
    };
  })();
  (function () {
    const originalSearchTransferMarket = services.Item.searchTransferMarket;
    services.Item.searchTransferMarket = function (...args) {
      restoreNotificationQueue();
      originalNotificationQueue = services.Notification.queue;
      services.Notification.queue = function (...queueArgs) {
        if (queueArgs[0][0] !== translate("popup.error.searcherror")) {
          originalNotificationQueue.call(this, ...queueArgs);
        }
      };
      const currentController = getActiveController();
      const resultObservable = new EAObservable();
      const searchObservable = originalSearchTransferMarket.call(this, ...args);
      if (args[0].disableOverrides) {
        return searchObservable;
      } else {
        searchObservable.observe(this, async (observable, response) => {
          if (response.success) {
            let searchResultItems = response.data.items;
            if (marketSearchResultTransformers.length > 0) {
              for (let resultTransformer of marketSearchResultTransformers) {
                let transformedItems = resultTransformer(searchResultItems, currentController);
                searchResultItems = isPromise(transformedItems)
                  ? await transformedItems
                  : transformedItems;
              }
            }
            for (let resultValidator of marketSearchResultValidators) {
              let validationResult = resultValidator(searchResultItems, this);
              if (isPromise(validationResult)) {
                if (!(await validationResult)) {
                  response.success = false;
                  break;
                }
              } else if (!validationResult) {
                response.success = false;
                break;
              }
            }
            response.data.items = searchResultItems;
          }
          resultObservable.notify(response);
        });
        return resultObservable;
      }
    };
    const originalSetItems = UTMarketSearchView.prototype.setItems;
    UTMarketSearchView.prototype.setItems = function (...args) {
      restoreNotificationQueue();
      originalSetItems.call(this, ...args);
      if (marketSearchSetItemsHandlers.length > 0) {
        for (let setItemsListener of marketSearchSetItemsHandlers) {
          setItemsListener(args[0], getActiveController());
        }
      }
    };
  })();
  (function () {
    const originalRender = UTDefaultActionPanelView.prototype.render;
    UTDefaultActionPanelView.prototype.render = function (
      item,
      renderArgument2,
      renderArgument3,
      renderArgument4,
      renderArgument5,
      renderArgument6,
      renderArgument7,
    ) {
      originalRender.call(
        this,
        item,
        renderArgument2,
        renderArgument3,
        renderArgument4,
        renderArgument5,
        renderArgument6,
        renderArgument7,
      );
      this._comparePriceButton.addTarget(
        this,
        () => {
          clearSnipeRequests();
        },
        EventType.TAP,
      );
    };
  })();
  (function () {
    const originalRender = UTAuctionActionPanelView.prototype.render;
    UTAuctionActionPanelView.prototype.render = function (item, renderArgument2) {
      originalRender.call(this, item, renderArgument2);
      this._findRelatedButton.addTarget(
        this,
        () => {
          clearSnipeRequests();
        },
        EventType.TAP,
      );
    };
  })();
  (function () {
    const originalGenerate = UTItemTableCellView.prototype._generate;
    UTItemTableCellView.prototype._generate = function () {
      originalGenerate.call(this);
      this.__itemValuesContainer = createElement("div", {
        className: "item-values-container",
      });
      appendElements(this.__rowContent, this.__itemValuesContainer);
    };
    UTItemTableCellView.prototype.addItemValue = function (initialValue, className) {
      const itemValueControl = new ItemValueDisplay(initialValue, className);
      appendElements(this.__itemValuesContainer, itemValueControl);
      return itemValueControl;
    };
    const originalRender = UTItemTableCellView.prototype.render;
    UTItemTableCellView.prototype.render = function (item) {
      originalRender.call(this, item);
      if (!this.data.tradable) {
        addClasses(this.getRootElement(), "untradeable");
      }
    };
  })();
  (function () {
    const originalGenerate = UTSlotActionPanelView.prototype._generate;
    UTSlotActionPanelView.prototype._generate = function () {
      originalGenerate.call(this);
      this._btnSearchMarket.addTarget(
        this,
        () => {
          clearSnipeRequests();
        },
        EventType.TAP,
      );
    };
  })();
  (function () {
    const originalOnClearSold = UTItemDetailsViewController.prototype.onClearSold;
    UTItemDetailsViewController.prototype.onClearSold = function (...args) {
      originalOnClearSold.call(this, ...args);
      const currentItem = getViewModel(this).current();
      if (currentItem.getAuctionData().isSold()) {
        dispatchPaletoolsEvent(paletoolsEvents.ITEMS_SOLD, {
          items: [currentItem],
        });
      }
    };
    const originalClearSold = UTTransferListViewController.prototype._clearSold;
    UTTransferListViewController.prototype._clearSold = function () {
      originalClearSold.call(this);
      const soldItems = this.getView()
        .getSection(UTTransferSectionListViewModel.SECTION.SOLD)
        .listRows.map((row) => row.data)
        .filter((item) => item.getAuctionData().isSold());
      dispatchPaletoolsEvent(paletoolsEvents.ITEMS_SOLD, {
        items: soldItems,
      });
    };
  })();
  (function () {
    const originalRequestItems = UTTransferListViewController.prototype._requestItems;
    UTTransferListViewController.prototype._requestItems = function () {
      originalRequestItems.call(this);
      this.onDataChange.observe(this, (observable, eventData) => {
        let newItems = [];
        for (let item of eventData.items) {
          if (!reportedSoldItemsById[item.id]) {
            reportedSoldItemsById[item.id] = item;
            newItems.push(item);
          }
        }
        dispatchPaletoolsEvent(paletoolsEvents.ITEMS_SOLD, {
          items: newItems,
        });
      });
    };
  })();
  (function () {
    const originalRequestItems = UTWatchListViewController.prototype._requestItems;
    UTWatchListViewController.prototype._requestItems = function () {
      originalRequestItems.call(this);
      this.onDataChange.observe(this, (observable, eventData) => {
        let newlyWonItems = [];
        for (let wonItem of eventData.items.filter((item) => item.getAuctionData().isWon())) {
          if (!reportedWonItemsById[wonItem.id]) {
            reportedWonItemsById[wonItem.id] = wonItem;
            newlyWonItems.push(wonItem);
          }
        }
        dispatchPaletoolsEvent(paletoolsEvents.ITEMS_WON, {
          items: newlyWonItems,
        });
      });
    };
  })();
  (function () {
    const originalList = services.Item.list;
    services.Item.list = function (...args) {
      const item = args[0];
      if (item.lastSalePrice) {
        paletoolsDatabase.transactions.insertBuy(item, item.lastSalePrice);
      }
      const listObservable = originalList.call(this, ...args);
      listObservable.observe(this, (observable, response) => {
        observable.unobserve(this);
        if (response.success) {
          dispatchPaletoolsEvent(paletoolsEvents.ITEM_MOVED, {
            item: item,
            itemPile: ItemPile.TRANSFER,
          });
        }
      });
      return listObservable;
    };
    const originalDiscard = services.Item.discard;
    services.Item.discard = function (...args) {
      const discardObservable = originalDiscard.call(this, ...args);
      discardObservable.observe(this, (observable, response) => {
        observable.unobserve(this);
        if (response.success) {
          const discardedItems = toArray(args[0]);
          for (const item of discardedItems) {
            dispatchPaletoolsEvent(paletoolsEvents.ITEM_DISCARDED, {
              item: item,
            });
          }
        }
      });
      return discardObservable;
    };
    const originalBid = services.Item.bid;
    services.Item.bid = function (...args) {
      const bidObservable = originalBid.call(this, ...args);
      bidObservable.observe(this, (observable, response) => {
        const [item, bidAmount] = args;
        observable.unobserve(this);
        if (response.success && item.getAuctionData().isWon()) {
          dispatchPaletoolsEvent(paletoolsEvents.ITEM_WON, {
            item: item,
            bid: bidAmount,
          });
        }
      });
      return bidObservable;
    };
    const originalMove = services.Item.move;
    services.Item.move = function (...args) {
      const moveObservable = originalMove.call(this, ...args);
      moveObservable.observe(this, (observable, response) => {
        observable.unobserve(this);
        if (response.success) {
          const movedItems = toArray(args[0]);
          const itemPile = args[1];
          for (const item of movedItems) {
            dispatchPaletoolsEvent(paletoolsEvents.ITEM_MOVED, {
              item: item,
              itemPile: itemPile,
            });
          }
        }
      });
      return moveObservable;
    };
    const originalRequestUnassignedItems = services.Item.requestUnassignedItems;
    services.Item.requestUnassignedItems = function (...args) {
      const requestObservable = originalRequestUnassignedItems.call(this, ...args);
      requestObservable.observe(this, (observable, response) => {
        observable.unobserve(this);
        if (response.success) {
          dispatchPaletoolsEvent(paletoolsEvents.REQUEST_UNASSIGNED, response.response.items);
        }
      });
      return requestObservable;
    };
    const originalSubmitChallenge = UTSBCService.prototype.submitChallenge;
    UTSBCService.prototype.submitChallenge = function (...args) {
      const challenge = args[0];
      const players = (
        challenge?.squad?.getNonBrickSlots?.() ||
        challenge?.squad?.getFieldPlayers?.() ||
        []
      )
        .map((slot) => (typeof slot?.getItem === "function" ? slot.getItem() : slot?.item))
        .filter((item) => item?.type === ItemType.PLAYER);
      const submitObservable = originalSubmitChallenge.call(this, ...args);
      submitObservable.observe(this, (observable, response) => {
        observable.unobserve(this);
        if (response.success) {
          dispatchPaletoolsEvent(paletoolsEvents.SBC_SUBMITTED, {
            challenge: challenge,
            players: players,
          });
        }
      });
      return submitObservable;
    };
    const originalSearch = services.Club.search;
    services.Club.search = function (...args) {
      const searchCriteria = args[0];
      searchCriteria.count = clubSearchPageSize;
      const searchObservable = originalSearch.call(this, ...args);
      searchObservable.observe(this, (observable, response) => {
        if (
          response.success &&
          (searchCriteria.minRating ||
            searchCriteria.maxRating ||
            searchCriteria.hideLoans ||
            searchCriteria.hideLocked)
        ) {
          const matchesClubFilters =
            ((minRating = searchCriteria.minRating),
            (maxRating = searchCriteria.maxRating),
            (hideLoans = searchCriteria.hideLoans),
            (hideLocked = searchCriteria.hideLocked),
            (item) =>
              !(
                (minRating && !(item.rating >= minRating)) ||
                (maxRating && !(item.rating <= maxRating)) ||
                (hideLoans && -1 !== item.loans) ||
                (hideLocked && isItemLocked(item))
              ));
          response.response.items = response.response.items.filter(matchesClubFilters);
        }
        var minRating;
        var maxRating;
        var hideLoans;
        var hideLocked;
      });
      return searchObservable;
    };
    const originalSearchStorageItems = services.Item.searchStorageItems;
    services.Item.searchStorageItems = function (...args) {
      const searchCriteria = args[0];
      searchCriteria.count = clubSearchPageSize;
      const searchObservable = originalSearchStorageItems.call(this, ...args);
      searchObservable.observe(this, (observable, response) => {
        observable.unobserve(this);
        if (!response.success || !response.response?.items) {
          return;
        }
        const sortBy = searchCriteria.sortBy;
        const requestedSortOrder = searchCriteria.sort || searchCriteria._sort;
        const sortDirection =
          requestedSortOrder === SearchSortOrder.DESCENDING || requestedSortOrder === "desc"
            ? -1
            : 1;
        const getSortValue = (function (sortType) {
          switch (sortType) {
            case SearchSortType.RATING:
              return (item) => item.rating;
            case SearchSortType.RECENCY:
              return (item) => item.timestamp;
            case SearchSortType.VALUE:
              return (item) => item.discardValue;
            default:
              return null;
          }
        })(sortBy);
        if (getSortValue) {
          response.response.items.sort(
            (left, right) => sortDirection * (getSortValue(left) - getSortValue(right)),
          );
        }
      });
      return searchObservable;
    };
  })();
  (function () {
    const originalRenderView = UTQuickListPanelViewController.prototype.renderView;
    UTQuickListPanelViewController.prototype.renderView = function () {
      originalRenderView.call(this);
      const cachedLowestPrice = getCachedLowestMarketPrice(this.item.definitionId);
      if (cachedLowestPrice) {
        let buyNowPrice = cachedLowestPrice.value;
        let bidPrice = decreasePriceByOneStep(buyNowPrice);
        this.getView().setBuyNowValue(buyNowPrice);
        this.getView().setBidValue(bidPrice);
      }
    };
  })();
  (function () {
    const originalGenerate = UTSquadSlotView.prototype._generate;
    UTSquadSlotView.prototype._generate = function () {
      originalGenerate.call(this);
      this.__itemValuesContainer = createElement("div", {
        className: "item-values-container",
      });
      appendElements(this, this.__itemValuesContainer);
    };
    UTSquadSlotView.prototype.addItemValue = function (initialValue, className) {
      const itemValueControl = new ItemValueDisplay("", className);
      appendElements(this.__itemValuesContainer, itemValueControl);
      return itemValueControl;
    };
  })();
  (function () {
    const originalOnClubSearchComplete =
      UTSquadBuilderViewController.prototype.onClubSearchComplete;
    UTSquadBuilderViewController.prototype.onClubSearchComplete = function (...args) {
      if (configuration.plugins.playerActions.lockPlayer && this.challenge) {
        args[1].response.items = args[1].response.items.filter(
          (item) => !item.isPlayer() || !isItemLocked(item),
        );
      }
      originalOnClubSearchComplete.call(this, ...args);
    };
  })();
  (function () {
    const originalGetUnassignedItems =
      UTUnassignedItemsViewController.prototype._getUnassignedItems;
    UTUnassignedItemsViewController.prototype._getUnassignedItems = function (...args) {
      repositories.Item.setDirty(ItemPile.PURCHASED);
      repositories.Item.setDirty(ItemPile.INBOX);
      originalGetUnassignedItems.call(this, ...args);
    };
  })();
  (function () {
    const originalDisplay = UTNotificationView.prototype.display;
    UTNotificationView.prototype.display = function (...args) {
      this.__content.textContent = "";
      this.__content.innerHTML = this.message;
      originalDisplay.call(this, ...args);
    };
  })();
  EADialogView.prototype.setMessage;
  EADialogView.prototype.setMessage = function (message) {
    if (message instanceof Element) {
      this.__msg.appendChild(message);
    } else {
      this.__msg.innerHTML = message;
    }
  };
  (function () {
    const originalGenerate = UTTransfersHubView.prototype._generate;
    UTTransfersHubView.prototype._generate = function (...args) {
      originalGenerate.call(this, ...args);
      removeClasses(this._transferMarketTile, "col-2-3-md");
      removeClasses(this._transferListTile, "col-1-3-md");
      removeClasses(this._transferTargetsTile, "col-1-3-md");
    };
  })();
  (function () {
    const originalGenerate = UTLargePlayerItemView.prototype._generate;
    UTLargePlayerItemView.prototype._generate = function () {
      originalGenerate.call(this);
      this.__itemValuesContainer = createElement("div", {
        className: "item-values-container",
      });
      appendElements(this, this.__itemValuesContainer);
    };
    UTLargePlayerItemView.prototype.addItemValue = function (initialValue, className) {
      const itemValueControl = new ItemValueDisplay(initialValue, className);
      appendElements(this.__itemValuesContainer, itemValueControl);
      return itemValueControl;
    };
    const originalRenderItem = UTLargePlayerItemView.prototype.renderItem;
    UTLargePlayerItemView.prototype.renderItem = function (...args) {
      originalRenderItem.call(this, ...args);
      if (args[0].untradeable) {
        addClasses(this.getRootElement(), "untradeable");
      }
    };
  })();
  (function () {
    const originalCompleteRequest = UTSBCSetsViewModel.prototype.completeRequest;
    UTSBCSetsViewModel.prototype.completeRequest = function (...args) {
      originalCompleteRequest.call(this, ...args);
      for (let sbcSet of args[1].data.sets) {
        if (sbcSet.awards.length === 0) {
          sbcSet.awards.push({
            count: 0,
          });
        }
      }
    };
  })();
  (function () {
    const originalGenerate = UTSBCSquadDetailPanelView.prototype._generate;
    UTSBCSquadDetailPanelView.prototype._generate = function () {
      originalGenerate.call(this);
      for (let generateHook of sbcSquadDetailPanelGenerateHandlers) {
        generateHook(this);
      }
    };
    const originalRender = UTSBCSquadDetailPanelView.prototype.render;
    UTSBCSquadDetailPanelView.prototype.render = function (...args) {
      originalRender.call(this, ...args);
      const challenge = args[0];
      if (
        challenge &&
        getCalendarDaysBetween(new Date(), new Date(1000 * challenge.endTime)) > 365
      ) {
        hideElements(this.__expireStatus);
      }
    };
    const originalDestroyGeneratedElements =
      UTSBCSquadDetailPanelView.prototype.destroyGeneratedElements;
    UTSBCSquadDetailPanelView.prototype.destroyGeneratedElements = function () {
      originalDestroyGeneratedElements.call(this);
      for (let destroyHook of sbcSquadDetailPanelDestroyHandlers) {
        destroyHook(this);
      }
    };
  })();
  (function () {
    const originalRender = UTSBCSetTileView.prototype.render;
    UTSBCSetTileView.prototype.render = function (...args) {
      originalRender.call(this, ...args);
      if (this.data) {
        this.__tileContent.textContent = this.__tileContent.textContent.replace(
          /(\S)\/(\S)/gm,
          "$1 / $2",
        );
      }
      if (
        getCalendarDaysBetween(
          new Date(1000 * this.data.startTime),
          new Date(1000 * this.data.endTime),
        ) > 365
      ) {
        hideElements(this._expireStatus);
      }
    };
  })();
  (function () {
    const originalUpdate = UTSearchCriteriaDTO.prototype.update;
    UTSearchCriteriaDTO.prototype.update = function (...args) {
      originalUpdate.call(this, ...args);
      this.hideLoans = args[0].hideLoans;
      this.minRating = args[0].minRating;
      this.maxRating = args[0].maxRating;
      this.hideLocked = args[0].hideLocked;
    };
  })();
  (function () {
    const originalInitWithSBCSet = UTSBCSquadSplitViewController.prototype.initWithSBCSet;
    UTSBCSquadSplitViewController.prototype.initWithSBCSet = function (...args) {
      originalInitWithSBCSet.call(this, ...args);
      setCurrentSbcSet(args[0], args[1]);
    };
  })();
  (function () {
    const originalInitWithSBCSet = UTSBCChallengesViewController.prototype.initWithSBCSet;
    UTSBCChallengesViewController.prototype.initWithSBCSet = function (...args) {
      originalInitWithSBCSet.call(this, ...args);
      setCurrentSbcSet(args[0]);
    };
  })();
  UTDoubleRangeControl.prototype._updateTextFieldPossibleRangeValues = function () {
    this._rangeSliderMinTextInput.setMinValue(this.getAbsoluteMin());
    this._rangeSliderMinTextInput.setMaxValue(this.getMaxValue());
    this._rangeSliderMaxTextInput.setMinValue(this.getMinValue());
    this._rangeSliderMaxTextInput.setMaxValue(this.getAbsoluteMax());
  };
  UTDoubleRangeControl.prototype._handleMinInputChange = function (shouldNotify = false) {
    let minValue = this.getMinValue();
    if (minValue > this.latestSetMax) {
      minValue = this.latestSetMax - this.getStep();
    }
    if (minValue < this.getAbsoluteMin()) {
      minValue = this.getAbsoluteMin();
    }
    this._rangeSliderMinTextInput.value = minValue;
    this.__rangeSliderMinInput.value = minValue.toString();
    this._updateTextFieldPossibleRangeValues();
    this._updateFillSpanLength();
    if (minValue !== this.latestSetMin) {
      this.latestSetMin = minValue;
      if (shouldNotify) {
        this._notifyInputListeners();
      }
    }
  };
  UTDoubleRangeControl.prototype._handleMaxInputChange = function (shouldNotify = false) {
    let maxValue = this.getMaxValue();
    if (maxValue < this.latestSetMin) {
      maxValue = this.latestSetMin + this.getStep();
    }
    if (maxValue < this.getAbsoluteMin()) {
      maxValue = this.getAbsoluteMin();
    }
    this._rangeSliderMaxTextInput.value = maxValue;
    this.__rangeSliderMaxInput.value = maxValue.toString();
    this._updateFillSpanLength();
    if (maxValue !== this.latestSetMax) {
      this.latestSetMax = maxValue;
      if (shouldNotify) {
        this._notifyInputListeners();
      }
    }
  };
  (function () {
    const originalGetItemRarityDP = UTDataProviderFactory.prototype.getItemRarityDP;
    UTDataProviderFactory.prototype.getItemRarityDP = function (...args) {
      args[0].tradableOnly = false;
      return originalGetItemRarityDP.call(this, ...args);
    };
  })();
  (function () {
    const originalIsViewDisplayed = EAViewController.prototype.isViewDisplayed;
    EAViewController.prototype.isViewDisplayed = function (...args) {
      return !!this.getView() && originalIsViewDisplayed.call(this, ...args);
    };
  })();
  (function () {
    const originalSetupTabs = UTAcademyHubViewController.prototype.setupTabs;
    UTAcademyHubViewController.prototype.setupTabs = function (...args) {
      this.paginationList.numItemsPerPage = Number.MAX_SAFE_INTEGER;
      originalSetupTabs.call(this, ...args);
    };
  })();
  hookPrototypeMethod(UTItemEntityFactory, "createItem", null, function (...argsAndResult) {
    let createdItem = argsAndResult.at(-1);
    if (argsAndResult.length === 0) {
      return createdItem;
    } else if (argsAndResult[0]) {
      createdItem.assists = argsAndResult[0].assists;
      createdItem.lifetimeAssists = argsAndResult[0].lifetimeAssists;
      createdItem.isCollected = argsAndResult[0].isCollected;
      return setHookResult(createdItem);
    } else {
      return createdItem;
    }
  });
  hookPrototypeMethod(UTSquadOverviewView, "_generate", null, function (...argsAndResult) {
    this.__squadValuesContainer = createElement("div", {
      className: "squad-values-container",
    });
    insertBefore(this.__squadValuesContainer, this.__draggableArea);
  });
}
