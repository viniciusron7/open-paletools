/**
 * Legacy snipe plugin (`snipePlugin`, order 7, installed by the plugin list in
 * src/bootstrap/boot.js): snipe-on-search queue, Buy Now auto-confirm, one-touch price-bump
 * searches, global keyboard shortcuts with CSS hints and the snipe settings menu
 * (`configuration.plugins.snipe`).
 *
 * Hooks:
 * - In `run()`, direct overrides: `UTNavigationController._showController` and the
 *   `marketSearchResultValidators` entry (once, `areSnipeHooksInstalled`),
 *   `utils.PopupManager.showConfirmation`, `UTDefaultActionPanelView.render`,
 *   `UTSlotActionPanelView._generate`, `UTMarketSearchFiltersView._generate` and
 *   `destroyGeneratedElements`; a `keydown` listener on document.body (never removed).
 *
 * Invariants:
 * - Queue: `queueSnipeRequest` (one-touch, superMode shortcuts) pushes `[noop, true]`; the
 *   validator runs for responses without `disableOverrides`, takes one request, clears the queue,
 *   bids the cheapest ACTIVE offer (`buyFirstActiveItem` from src/market/item-actions.js: own 30 s
 *   timeout, status 408), fires `SNIPE_SUCCESS` (ding if `sounds.enabled`) or `SNIPE_FAILED`, then returns to the
 *   filters (`SNIPE_GOBACK`); returning false makes patches.js mark the response unsuccessful.
 * - With `buttons.results.pressEnter`, `CONFIRM_BUY_NOW` calls `onConfirm` without a popup.
 *   Classes added once per panel (send-to-club, send-to-transfer-list, quick-sell, compare-price,
 *   send-to-storage, redeem-item) are what shortcuts click and hints target.
 * - One-touch buttons (`snipe-min-bid` / `snipe-min-buy-now`) are always built and destroyed,
 *   appended only when enabled; a run queues a request, bumps the row with
 *   `incrementPriceRowWithinMax` and triggers SEARCH; `SNIPE_EXECUTE` runs it on the min-bid row.
 * - Hook chaining: the direct `_generate`/`destroyGeneratedElements` overrides call the
 *   hookPrototypeMethod wrapper installed earlier by market-search-filters; the player-snipe and
 *   bulk-buy hooks added later to it run only through this call.
 * - Shortcuts ignore INPUT targets and Shift/Ctrl/Alt combinations (unless the key is the
 *   modifier) and need `configuration.enabled`; the `KeyboardEvent.code` map is rebuilt from
 *   `buttons` per key press; without a match the `keyboardShortcutsByKeyCode` entries run.
 * - Stylesheet `paletools-snipe-styles`: hints rebuilt on APP_ENABLED and CONFIGURATION_SAVED; on
 *   APP_DISABLED replaced by snipe-styles.css, which hides every `.paletools-element`.
 *   `snipeSettings` and `snipeRuntimeSettings` are the same object (menu edits by dotted path,
 *   runtime reads live).
 *
 * Known issues (kept as-is):
 * - No ACTIVE offer in the results: `.then` is called on `false`; the validator throws and the
 *   search observable is never notified.
 * - Undeclared identifiers: `response` in the bid `.catch` (swallowed, so
 *   `onResult`/`SNIPE_FAILED` never run on bid exceptions) and `info` in the
 *   quickSellNonDuplicates/quickSellDuplicates shortcuts.
 * - `!AuctionBidStateEnum.BUYNOW` is constant: the transfer/club/sell condition reduces to
 *   `tradeState === CLOSED`.
 * - Every `_generate` and one-touch run adds a `SNIPE_EXECUTE` once-listener; they accumulate, so
 *   one event can start several snipes.
 * - Menu key `buttons.results.sbcStorage` is never read (runtime uses `buttons.results.storage`);
 *   `lastSbcSelection.set;` is a no-op.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import {
  addClasses,
  appendElements,
  createElement,
  isElementVisible,
  queryElement,
} from "../../core/dom.js";
import { dispatchPaletoolsEvent, listenForEvent, paletoolsEvents } from "../../core/events.js";
import { debugLog } from "../../core/logger.js";
import { getValueAtPath, setValueAtPath } from "../../core/objects.js";
import { formatNumber, translate } from "../../i18n/translations.js";
import { buyFirstActiveItem } from "../../market/item-actions.js";
import { getPriceRowValue, incrementPriceRowWithinMax } from "../../market/price-inputs.js";
import { marketSearchResultValidators } from "../../market/search-hooks.js";
import { selectMarketSearchResultAt } from "../../market/search-results.js";
import {
  clearSnipeRequests,
  pendingSnipeRequests,
  snipePendingShowControllerCallbacks,
} from "./state.js";
import { challengeId, currentSbcSet } from "../../sbc/current-sbc-set.js";
import { LabelWithKeyPressInputControl } from "../../ui/controls/label-with-keypress-input-control.js";
import {
  isUnassignedShortcut,
  iterateKeyboardShortcuts,
  keyboardShortcutsByKeyCode,
  reassignKeyboardShortcut,
} from "../../ui/keyboard-shortcuts.js";
import { showSuccessNotification } from "../../ui/notifications.js";
import { appendToggle, translateLabel } from "../../ui/settings-controls.js";
import { simulateClick } from "../../ui/simulate-click.js";
import { dingSoundPlayer } from "../../ui/sound.js";
import { removeStylesheet, upsertStylesheet } from "../../ui/stylesheets.js";
import { fetchUnassignedItems, moveItemsToSbcStorage } from "../../webapp/item-piles.js";
import {
  findControllerOfType,
  getActiveController,
  getLeftController,
  getRightController,
  getViewModel,
  goBackToMarketSearchFilters,
  navigateBack,
} from "../../webapp/navigation.js";
import snipeStylesCss from "./snipe-styles.css";

let areSnipeHooksInstalled = false;

const snipeSettings = configuration.plugins.snipe;

let snipePluginDefinition;

const snipeRuntimeSettings = configuration.plugins.snipe;

function queueSnipeRequest() {
  (function (onResult = () => {}) {
    pendingSnipeRequests.push([onResult, true]);
    debugLog("Snipe requested");
  })();
}

snipePluginDefinition = {
  run: function () {
    (function () {
      if (areSnipeHooksInstalled) {
        return;
      }
      areSnipeHooksInstalled = true;
      const originalShowController = UTNavigationController.prototype._showController;
      var handleSnipeSearchResults;
      UTNavigationController.prototype._showController = function (...args) {
        originalShowController.call(this, ...args);
        if (snipePendingShowControllerCallbacks.length > 0) {
          const queuedAction = snipePendingShowControllerCallbacks.shift();
          snipePendingShowControllerCallbacks.length = 0;
          queuedAction();
          this._eBackButtonTapped();
        }
      };
      handleSnipeSearchResults = (items, itemService) => {
        if (pendingSnipeRequests.length === 0) {
          return true;
        }
        debugLog("Snipe Requests: " + pendingSnipeRequests.length);
        let [onResult, shouldGoBack] = pendingSnipeRequests.shift();
        function goBackIfRequested() {
          if (shouldGoBack) {
            goBackToMarketSearchFilters();
            dispatchPaletoolsEvent(paletoolsEvents.SNIPE_GOBACK);
          }
        }
        clearSnipeRequests();
        if (items.length === 0) {
          onResult({
            success: true,
            item: null,
          });
          goBackIfRequested();
        } else {
          buyFirstActiveItem(
            items
              .slice()
              .sort(
                (left, right) =>
                  left.getAuctionData().buyNowPrice - right.getAuctionData().buyNowPrice,
              ),
          )
            .then((purchaseResult) => {
              if (purchaseResult.success) {
                onResult({
                  success: true,
                  item: purchaseResult.item,
                });
                fetchUnassignedItems();
                dispatchPaletoolsEvent(paletoolsEvents.SNIPE_SUCCESS, purchaseResult.item);
                if (configuration.plugins.snipe.sounds.enabled) {
                  dingSoundPlayer.ding();
                }
                showSuccessNotification(
                  translate("market.itemBuy.success").replace(
                    "{coins}",
                    formatNumber(purchaseResult.item.getAuctionData().buyNowPrice),
                  ),
                );
              } else {
                try {
                  onResult({
                    success: false,
                    item: purchaseResult.item,
                  });
                  dispatchPaletoolsEvent(paletoolsEvents.SNIPE_FAILED, purchaseResult);
                } catch {}
              }
            })
            .catch((error) => {
              try {
                onResult({
                  success: false,
                  item: response.item,
                  error: error,
                });
                dispatchPaletoolsEvent(paletoolsEvents.SNIPE_FAILED, {
                  response: response,
                  err: error,
                });
              } catch {}
            })
            .finally(() => {
              goBackIfRequested();
            });
        }
        return !shouldGoBack;
      };
      marketSearchResultValidators.push(handleSnipeSearchResults);
    })();
    const originalShowConfirmation = utils.PopupManager.showConfirmation;
    utils.PopupManager.showConfirmation = function (
      confirmation,
      messageParams,
      onConfirm,
      showConfirmationArgument4,
    ) {
      if (snipeRuntimeSettings.buttons.results.pressEnter) {
        if (confirmation !== utils.PopupManager.Confirmations.CONFIRM_BUY_NOW) {
          originalShowConfirmation.call(
            this,
            confirmation,
            messageParams,
            onConfirm,
            showConfirmationArgument4,
          );
        } else {
          onConfirm();
        }
      } else {
        originalShowConfirmation.call(
          this,
          confirmation,
          messageParams,
          onConfirm,
          showConfirmationArgument4,
        );
      }
    };
    const originalRender = UTDefaultActionPanelView.prototype.render;
    UTDefaultActionPanelView.prototype.render = function (
      renderArgument1,
      renderArgument2,
      renderArgument3,
      renderArgument4,
      renderArgument5,
      renderArgument6,
      renderArgument7,
    ) {
      originalRender.call(
        this,
        renderArgument1,
        renderArgument2,
        renderArgument3,
        renderArgument4,
        renderArgument5,
        renderArgument6,
        renderArgument7,
      );
      if (!this.snipeGenerated) {
        addClasses(this._sendClubButton, "send-to-club");
        addClasses(this._sendTransferButton, "send-to-transfer-list");
        addClasses(this._discardButton, "quick-sell");
        addClasses(this._comparePriceButton, "compare-price");
        addClasses(this._sendToStorageButton, "send-to-storage");
        addClasses(this._redeemButton, "redeem-item");
        this.snipeGenerated = true;
      }
    };
    const originalSlotActionPanelGenerate = UTSlotActionPanelView.prototype._generate;
    UTSlotActionPanelView.prototype._generate = function (...args) {
      originalSlotActionPanelGenerate.call(this, ...args);
      if (!this._snipeGenerated) {
        addClasses(this._btnTransfer, "send-to-transfer-list");
        addClasses(this._btnRemove, "send-to-club");
        addClasses(this._btnDiscard, "quick-sell");
        this._snipeGenerated = true;
      }
    };
    const originalMarketSearchFiltersGenerate = UTMarketSearchFiltersView.prototype._generate;
    UTMarketSearchFiltersView.prototype._generate = function () {
      originalMarketSearchFiltersGenerate.call(this);
      const filtersView = this;
      function appendOneTouchButton(button, label, priceRow, className) {
        button.init();
        button.setText(label);
        button.addTarget(
          this,
          () => {
            runOneTouchSnipe(priceRow);
          },
          EventType.TAP,
        );
        button.getRootElement().classList.add("primary");
        button.getRootElement().classList.add(className);
        appendElements(
          queryElement(".button-container", filtersView.__searchContainer),
          button.getRootElement(),
        );
      }
      const runOneTouchSnipe = (priceRow) => {
        queueSnipeRequest();
        incrementPriceRowWithinMax(priceRow, getPriceRowValue(filtersView._maxBuyNowPriceRow));
        filtersView._triggerActions(UTMarketSearchFiltersView.Event.SEARCH);
        listenForEvent(
          paletoolsEvents.SNIPE_EXECUTE,
          () => runOneTouchSnipe(this._minBidPriceRow),
          {
            once: true,
          },
        );
      };
      this._searchButton.addTarget(
        this,
        () => {
          clearSnipeRequests();
        },
        EventType.TAP,
      );
      this._oneTouchIncMinBid = new UTStandardButtonControl();
      this._oneTouchIncMinBuyNow = new UTStandardButtonControl();
      if (snipeRuntimeSettings.oneTouch.isEnabled && snipeRuntimeSettings.oneTouch.displayMinBid) {
        appendOneTouchButton(
          this._oneTouchIncMinBid,
          translate("plugins.snipe.settings.search.oneTouchMinBid"),
          this._minBidPriceRow,
          "snipe-min-bid",
        );
      }
      if (snipeRuntimeSettings.oneTouch.isEnabled && snipeRuntimeSettings.oneTouch.displayMinBuy) {
        appendOneTouchButton(
          this._oneTouchIncMinBuyNow,
          translate("plugins.snipe.settings.search.oneTouchMinBuy"),
          this._minBuyNowPriceRow,
          "snipe-min-buy-now",
        );
      }
      listenForEvent(paletoolsEvents.SNIPE_EXECUTE, () => runOneTouchSnipe(this._minBidPriceRow), {
        once: true,
      });
    };
    const originalDestroyGeneratedElements =
      UTMarketSearchFiltersView.prototype.destroyGeneratedElements;
    UTMarketSearchFiltersView.prototype.destroyGeneratedElements = function () {
      originalDestroyGeneratedElements.call(this);
      this._oneTouchIncMinBid.destroy();
      this._oneTouchIncMinBuyNow.destroy();
    };
    const pressBuyNowButton = () => {
      const detailPaneController = getActiveController(getRightController(getActiveController()));
      detailPaneController.panel._eButtonSelected(detailPaneController.panel._buyNowButton);
    };
    const cancelSnipeAndGoBack = () => {
      clearSnipeRequests();
      navigateBack();
    };
    const triggerMarketSearch = () => {
      const view = getActiveController().getView();
      view.eMinBidPriceChanged();
      view.eMaxBidPriceChanged();
      view.eMinBuyPriceChanged();
      view.eMaxBuyPriceChanged();
      if (view.updateSearchCriteria) {
        view.updateSearchCriteria();
      }
      view.eSearchButtonSelected();
    };
    const findSendToTransferListButton = () => queryElement("button.send-to-transfer-list");
    const findSendToClubButton = () => queryElement("button.send-to-club");
    const findQuickSellButton = () => queryElement("button.quick-sell");
    const buildSnipeShortcutActions = (shortcutKeys) => {
      let actionsByKeyCode = {};
      const currentController = getActiveController();
      actionsByKeyCode[shortcutKeys.back] = () => cancelSnipeAndGoBack();
      ((actions, keys, controller) => {
        if (controller instanceof UTMarketSearchFiltersViewController) {
          actions[keys.search.decMinBid] = () => {
            controller.getView()._minBidPriceRow._currencyInput._currencyInput.decrease();
          };
          actions[keys.search.incMinBid] = () => {
            incrementPriceRowWithinMax(
              controller.getView()._minBidPriceRow,
              getPriceRowValue(controller.getView()._maxBuyNowPriceRow),
            );
          };
          actions[keys.search.decMaxBid] = () => {
            controller.getView()._maxBidPriceRow._currencyInput._currencyInput.decrease();
          };
          actions[keys.search.incMaxBid] = () => {
            controller.getView()._maxBidPriceRow._currencyInput._currencyInput.increase();
          };
          actions[keys.search.decMinBuy] = () => {
            controller.getView()._minBuyNowPriceRow._currencyInput._currencyInput.decrease();
          };
          actions[keys.search.incMinBuy] = () => {
            incrementPriceRowWithinMax(
              controller.getView()._minBuyNowPriceRow,
              getPriceRowValue(controller.getView()._maxBuyNowPriceRow),
            );
          };
          actions[keys.search.decMaxBuy] = () => {
            controller.getView()._maxBuyNowPriceRow._currencyInput._currencyInput.decrease();
          };
          actions[keys.search.incMaxBuy] = () => {
            controller.getView()._maxBuyNowPriceRow._currencyInput._currencyInput.increase();
          };
          actions[keys.search.search] = () => {
            clearSnipeRequests();
            triggerMarketSearch();
          };
          actions[keys.search.resetBid] = () => {
            controller.getView()._minBidPriceRow.value = 0;
            controller.getView()._maxBidPriceRow.value = 0;
          };
          actions[keys.search.oneTouchMinBid] = () => {
            if (snipeRuntimeSettings.oneTouch.isEnabled) {
              actions[keys.search.incMinBid]();
              if (snipeRuntimeSettings.oneTouch.superMode) {
                queueSnipeRequest();
              }
              triggerMarketSearch();
            }
          };
          actions[keys.search.oneTouchMinBuy] = () => {
            if (snipeRuntimeSettings.oneTouch.isEnabled) {
              actions[keys.search.incMinBuy]();
              if (snipeRuntimeSettings.oneTouch.superMode) {
                queueSnipeRequest();
              }
              triggerMarketSearch();
            }
          };
        }
      })(actionsByKeyCode, shortcutKeys, currentController);
      ((actions, keys, controller) => {
        if (!(controller instanceof UTMarketSearchResultsSplitViewController)) {
          return;
        }
        const resultList = getLeftController(controller).getView()._list;
        const listRows = resultList.listRows;
        if (listRows.length > 0) {
          let selectedIndex = resultList.listRows.findIndex((row) =>
            row.__root.classList.contains("selected"),
          );
          actions[keys.lists.up] = () => {
            if (selectedIndex - 1 < 0) {
              selectedIndex = listRows.length - 1;
            } else {
              selectedIndex--;
            }
            selectMarketSearchResultAt(selectedIndex);
          };
          actions[keys.lists.down] = () => {
            if (selectedIndex + 1 >= listRows.length) {
              selectedIndex = 0;
            } else {
              selectedIndex++;
            }
            selectMarketSearchResultAt(selectedIndex);
          };
        } else {
          actions[keys.search.oneTouchMinBid] = () =>
            !!snipeRuntimeSettings.oneTouch.isEnabled && cancelSnipeAndGoBack();
          actions[keys.search.oneTouchMinBuy] = () =>
            !!snipeRuntimeSettings.oneTouch.isEnabled && cancelSnipeAndGoBack();
        }
      })(actionsByKeyCode, shortcutKeys, currentController);
      ((actions, keys, controller) => {
        let itemDetailsController;
        itemDetailsController =
          controller._itemDetailController instanceof UTItemDetailsViewController
            ? controller._itemDetailController
            : controller._itemDetailController?.getCurrentController() instanceof
                UTItemDetailsViewController
              ? controller._itemDetailController.getCurrentController()
              : findControllerOfType(UTItemDetailsViewController, controller);
        if (itemDetailsController) {
          if (itemDetailsController.currentAuction) {
            const {
              _bidState: bidState,
              _tradeState: tradeState,
              tradeId: tradeId,
              tradeOwner: isTradeOwner,
            } = itemDetailsController.currentAuction;
            if (tradeState === "active" && bidState !== "highest") {
              actions[keys.results.bid] = () =>
                (() => {
                  const detailPaneController = getActiveController(
                    getRightController(getActiveController()),
                  );
                  detailPaneController.panel._eButtonSelected(
                    detailPaneController.panel._bidButton,
                  );
                })();
              actions[keys.results.buy] = () => pressBuyNowButton();
              actions[keys.results.decBid] = () => {
                const bidNumericStepper = itemDetailsController.panel._bidNumericStepper;
                bidNumericStepper.beginDecrease();
                bidNumericStepper.endDecrease();
              };
              actions[keys.results.incBid] = () => {
                const bidNumericStepper = itemDetailsController.panel._bidNumericStepper;
                bidNumericStepper.beginIncrease();
                bidNumericStepper.endIncrease();
              };
              if (snipeRuntimeSettings.oneTouch.isEnabled) {
                actions[keys.search.oneTouchMinBid] = actions[keys.search.oneTouchMinBuy] = () =>
                  pressBuyNowButton();
              }
            }
            if (
              !(
                tradeState !== AuctionTradeStateEnum.CLOSED ||
                (bidState !== AuctionBidStateEnum.HIGHEST && !AuctionBidStateEnum.BUYNOW)
              )
            ) {
              actions[keys.results.transfer] = () => simulateClick(findSendToTransferListButton());
              actions[keys.results.club] = () => simulateClick(findSendToClubButton());
              actions[keys.results.sell] = () => simulateClick(findQuickSellButton());
            }
            if (tradeState === AuctionTradeStateEnum.EXPIRED && isTradeOwner) {
              actions[keys.results.club] = () => simulateClick(findSendToClubButton());
              actions[keys.results.sell] = () => simulateClick(findQuickSellButton());
            }
            if (tradeId === "0") {
              const viewModel = getViewModel(itemDetailsController);
              const currentItem = viewModel._collection[viewModel._index];
              if (currentItem.tradable) {
                actions[keys.results.transfer] = () =>
                  simulateClick(findSendToTransferListButton());
              }
              actions[keys.results.club] = () => simulateClick(findSendToClubButton());
              if (currentItem.discardable) {
                actions[keys.results.sell] = () => simulateClick(findQuickSellButton());
              }
            }
          }
          actions[keys.results.sell] = () => simulateClick(findQuickSellButton());
          actions[keys.results.compare] = () => {
            clearSnipeRequests();
            simulateClick(queryElement("button.compare-price"));
          };
          actions[keys.results.storage] = () =>
            simulateClick(queryElement("button.send-to-storage"));
        }
      })(actionsByKeyCode, shortcutKeys, currentController);
      ((actions, keys, unusedArgument3) => {
        if (isElementVisible(queryElement(".pagingContainer"))) {
          actions[keys.lists.prev] = () => {
            const previousPageButton = queryElement(".pagingContainer > button.pagination.prev");
            if (isElementVisible(previousPageButton)) {
              simulateClick(previousPageButton);
            }
          };
          actions[keys.lists.next] = () => {
            const nextPageButton = queryElement(".pagingContainer > button.pagination.next");
            if (isElementVisible(nextPageButton)) {
              simulateClick(nextPageButton);
            }
          };
        }
      })(actionsByKeyCode, shortcutKeys);
      ((actions, keys, unusedArgument3) => {
        function selectPlayerPick(pickIndex) {
          let playerPicksController = findControllerOfType(UTPlayerPicksViewController);
          if (!(pickIndex >= playerPicksController.picks.length)) {
            if (playerPicksController.selectedPicks.length > 0) {
              for (let selectedPick of playerPicksController.selectedPicks) {
                playerPicksController.onPickCanceled(null, null, {
                  item: selectedPick,
                });
              }
            }
            playerPicksController.onCarouselScrolled(null, null, {
              index: pickIndex,
            });
            playerPicksController.onButtonTapped(
              null,
              UTPlayerPicksView.Event.SELECT_CURRENT_PICK,
              null,
            );
            if (playerPicksController.isAtMaxPicks()) {
              playerPicksController.eConfirmSelection();
            }
          }
        }
        if (isElementVisible(queryElement(".ut-player-picks-view"))) {
          actions[keys.pick.first] = () => {
            selectPlayerPick(0);
          };
          actions[keys.pick.second] = () => {
            selectPlayerPick(1);
          };
          actions[keys.pick.third] = () => {
            selectPlayerPick(2);
          };
          actions[keys.pick.fourth] = () => {
            selectPlayerPick(3);
          };
          actions[keys.pick.fifth] = () => {
            selectPlayerPick(4);
          };
        }
      })(actionsByKeyCode, shortcutKeys);
      ((actions, keys, controller) => {
        if (
          !(
            controller instanceof UTUnassignedItemsSplitViewController ||
            controller instanceof UTUnassignedItemsViewController
          )
        ) {
          return;
        }
        const unassignedController =
          controller instanceof UTUnassignedItemsSplitViewController
            ? controller.listViewController
            : controller;
        actions[keys.unassigned.organize] = async () => {
          await unassignedController.organize();
        };
        actions[keys.unassigned.quickSell] = () => {
          const discardableInfo = unassignedController.viewmodel.getDiscardableInfo();
          unassignedController.quickSell(
            [...discardableInfo.items.entities, ...discardableInfo.duplicates.entities],
            discardableInfo.items.value + discardableInfo.duplicates.value,
          );
        };
        actions[keys.unassigned.quickSellNonDuplicates] = () => {
          unassignedController.quickSell(info.items.entities, info.items.value);
        };
        actions[keys.unassigned.quickSellDuplicates] = () => {
          unassignedController.quickSell(info.duplicates.entities, info.duplicates.value);
        };
        actions[keys.unassigned.storeInClub] = () => {
          if (
            unassignedController.viewmodel &&
            unassignedController.viewmodel.getMovableItems().length > 0
          ) {
            unassignedController.storeInClub();
          }
        };
        actions[keys.unassigned.transferList] = () => {
          const tradeableNonDuplicates = unassignedController.viewmodel
            .getRegularItemsSection()
            .filter((item) => item.isTradeable() && !item.isDuplicate());
          if (unassignedController.viewmodel && tradeableNonDuplicates.length > 0) {
            unassignedController.sendStorablesToTransferList();
          }
          if (
            unassignedController.viewmodel &&
            unassignedController.viewmodel.getTradeableDuplicates().length > 0
          ) {
            unassignedController.sendDuplicatesToTransferList();
          }
        };
        actions[keys.unassigned.sbcStorage] = async () => {
          await moveItemsToSbcStorage(
            unassignedController.viewmodel.getDiscardableInfo().untradeableDuplicates.entities,
          );
          unassignedController.getUnassignedItems();
        };
        actions[keys.results.redeem] = () => {
          simulateClick(queryElement("button.redeem-item"));
        };
        actions[keys.results.redeemHideout] = () => {
          simulateClick(queryElement("button.redeem-item-hideout"));
        };
      })(actionsByKeyCode, shortcutKeys, currentController);
      ((actions, keys, controller) => {
        if (getRightController(controller) instanceof UTSquadItemDetailsNavigationController) {
          actions[keys.results.transfer] = () => simulateClick(findSendToTransferListButton());
          actions[keys.results.club] = () => simulateClick(findSendToClubButton());
          actions[keys.results.sell] = () => simulateClick(findQuickSellButton());
        }
      })(actionsByKeyCode, shortcutKeys, currentController);
      ((actions, keys, controller) => {
        if (controller instanceof UTSBCHubViewController) {
          actions[keys.sbcHub.repeat] = async () => {
            const lastSbcSelection = {
              set: currentSbcSet,
              challengeId: challengeId,
            };
            if (!lastSbcSelection.set || !lastSbcSelection.set.isComplete()) {
              if (lastSbcSelection.challengeId) {
                const matchingSetTiles = controller
                  .getView()
                  .sbcSetTiles.filter((tile) => tile.data.id === lastSbcSelection.set.id);
                if (matchingSetTiles && matchingSetTiles.length > 0) {
                  return void matchingSetTiles[0]._tapDetected(
                    new MouseEvent("click", {
                      bubbles: true,
                      cancelable: true,
                    }),
                  );
                }
              } else {
                lastSbcSelection.set;
              }
            }
          };
        }
      })(actionsByKeyCode, shortcutKeys, currentController);
      return actionsByKeyCode;
    };
    const applySnipeShortcutHints = (shortcutKeys) => {
      let buildStepButtonHintRule = (selector, group, actionName, isIncrement) =>
        selector +
        " ." +
        (isIncrement ? "in" : "de") +
        "crement-value::after { font-size:10px; display:block; margin-top:-30px; content: '[ " +
        shortcutKeys[group][actionName] +
        " ]' }";
      let buildPriceFilterHintRule = (filterPosition, actionName, isIncrement) =>
        buildStepButtonHintRule(
          ".search-prices .price-filter:nth-child(" + filterPosition + ")",
          "search",
          actionName,
          isIncrement,
        );
      let buildPriceFilterHintRules = (filterPosition, decrementAction, incrementAction) =>
        "" +
        buildPriceFilterHintRule(filterPosition, decrementAction) +
        buildPriceFilterHintRule(filterPosition, incrementAction, true);
      upsertStylesheet(
        "paletools-snipe-styles",
        "\n        " +
          buildPriceFilterHintRules(2, "decMinBid", "incMinBid") +
          "\n        " +
          buildPriceFilterHintRules(3, "decMaxBid", "incMaxBid") +
          "\n        " +
          buildPriceFilterHintRules(5, "decMinBuy", "incMinBuy") +
          "\n        " +
          buildPriceFilterHintRules(6, "decMaxBuy", "incMaxBuy") +
          "\n        " +
          buildStepButtonHintRule(".DetailPanel > .bidOptions", "results", "decBid", false) +
          "\n        " +
          buildStepButtonHintRule(".DetailPanel > .bidOptions", "results", "incBid", true) +
          "\n        .ut-market-search-filters-view .primary::after { content: '[ " +
          shortcutKeys.search.search +
          "]'}\n        .ut-market-search-filters-view .primary.snipe-min-bid::after { content: '[ " +
          shortcutKeys.search.oneTouchMinBid +
          "]'}\n        .ut-market-search-filters-view .primary.snipe-min-buy-now::after { content: '[ " +
          shortcutKeys.search.oneTouchMinBuy +
          "]'}\n        .ut-market-search-filters-view .search-price-header:first-child > button::after { content: '[ " +
          shortcutKeys.search.resetBid +
          "]';  font-size: 10px; display: block  }\n        .ut-navigation-button-control::after { font-size:10px; float:right; margin-right:12px; content: '[ " +
          shortcutKeys.back +
          " ]' }\n        .pagingContainer .prev::after { font-size: 10px; display:block; content: '[ " +
          shortcutKeys.lists.prev +
          " ]' }\n        .pagingContainer .next::after { font-size: 10px; display:block; content: '[ " +
          shortcutKeys.lists.next +
          " ]' }\n        .bidButton::after { content: ' [ " +
          shortcutKeys.results.bid +
          " ]' }\n        .buyButton::after { float:right; content: ' [ " +
          shortcutKeys.results.buy +
          " ]' }\n        .send-to-transfer-list .btn-text::after { content: ' [ " +
          shortcutKeys.results.transfer +
          " ]' }\n        .send-to-club .btn-text::after { content: ' [ " +
          shortcutKeys.results.club +
          " ]' }\n        .quick-sell .btn-text::after { content: ' [ " +
          shortcutKeys.results.sell +
          " ]' }\n        .compare-price .btn-text::after { content: ' [ " +
          shortcutKeys.results.compare +
          " ]' }\n        .redeem-item .btn-text::after { content: ' [ " +
          shortcutKeys.results.redeem +
          " ]' }\n        .redeem-item-hideout .btn-text::after { content: ' [ " +
          shortcutKeys.results.redeemHideout +
          " ]' }\n        .send-to-storage .btn-text::after { content: ' [ " +
          shortcutKeys.results.storage +
          " ]' }\n        ",
      );
    };
    const refreshSnipeShortcutHints = () => {
      removeStylesheet("paletools-snipe-styles");
      applySnipeShortcutHints(snipeRuntimeSettings.buttons);
    };
    listenForEvent(paletoolsEvents.APP_ENABLED, () => {
      refreshSnipeShortcutHints();
    });
    listenForEvent(paletoolsEvents.APP_DISABLED, () => {
      removeStylesheet("paletools-snipe-styles");
      upsertStylesheet("paletools-snipe-styles", snipeStylesCss);
    });
    listenForEvent(paletoolsEvents.CONFIGURATION_SAVED, () => {
      refreshSnipeShortcutHints();
    });
    document.body.addEventListener("keydown", (event) => {
      const isModifierKey =
        event.code === "ControlLeft" ||
        event.code === "ControlRight" ||
        event.code === "ShiftLeft" ||
        event.code === "ShiftRight" ||
        event.code === "AltLeft" ||
        event.code === "AltRight";
      if (
        event.target.tagName === "INPUT" ||
        (!isModifierKey && (event.shiftKey || event.ctrlKey || event.altKey))
      ) {
        return;
      }
      if (!configuration.enabled) {
        return;
      }
      let shortcutAction = buildSnipeShortcutActions(snipeRuntimeSettings.buttons)[event.code];
      if (shortcutAction) {
        shortcutAction();
        event.preventDefault();
      } else {
        const customShortcuts =
          ((keyCode = event.code),
          keyboardShortcutsByKeyCode[keyCode] ? keyboardShortcutsByKeyCode[keyCode] : null);
        if (customShortcuts && customShortcuts.length > 0) {
          for (const shortcut of customShortcuts) {
            shortcut.action();
          }
        }
      }
      var keyCode;
    });
    applySnipeShortcutHints(snipeRuntimeSettings.buttons);
  },
  order: 7,
  settings: {
    name: "snipe",
    title: "plugins.snipe.settings.title",
    menu: function () {
      function appendSnipeShortcutSetting(container, settingPath, labelKey) {
        appendShortcutInput(
          container,
          labelKey || "plugins.snipe.settings." + settingPath.replace("buttons.", ""),
          () => getValueAtPath(snipeSettings, settingPath),
          (previousKeyCode, newKeyCode) => setValueAtPath(snipeSettings, settingPath, newKeyCode),
        );
      }
      function appendShortcutInput(container, labelKey, getKeyCode, setKeyCode) {
        let keyCode = getKeyCode();
        if (isUnassignedShortcut(keyCode)) {
          keyCode = "";
        }
        (function (
          targetContainer,
          targetLabelKey,
          initialKeyCode,
          unusedArgument4,
          unusedArgument5,
          unusedArgument6,
        ) {
          const shortcutInput = new LabelWithKeyPressInputControl();
          shortcutInput.addClearButton(!![]);
          shortcutInput.setLabel(translateLabel(targetLabelKey));
          shortcutInput.setInputValue(initialKeyCode);
          shortcutInput.onInputChange((input, newKeyCode, previousKeyCode) => {
            setKeyCode(previousKeyCode, newKeyCode);
            input.value = newKeyCode;
            persistConfiguration();
          });
          appendElements(targetContainer, shortcutInput);
        })(container, labelKey, keyCode);
      }
      function appendSnipeSettingToggle(container, settingPath, requiresConfirmation, labelKey) {
        const initialValue = getValueAtPath(snipeSettings, settingPath);
        appendToggle(
          container,
          labelKey || "plugins.snipe.settings." + settingPath.replace("buttons.", ""),
          initialValue,
          (isEnabled) => {
            if (isEnabled && requiresConfirmation && !confirm(translate("plugins.dangerous"))) {
              return false;
            }
            setValueAtPath(snipeSettings, settingPath, isEnabled);
            persistConfiguration();
          },
        );
      }
      let createSettingsSection = () =>
        createElement("div", {
          className: "snipe-settings-container",
        });
      let menuContainer = document.createElement("div");
      let generalSection = createSettingsSection();
      addClasses(generalSection, "snipe-settings-container");
      appendElements(
        generalSection,
        createElement("p", null, translate("plugins.snipe.settings.categories.general")),
      );
      appendSnipeSettingToggle(generalSection, "buttons.results.pressEnter");
      appendSnipeSettingToggle(generalSection, "oneTouch.isEnabled", true);
      appendSnipeSettingToggle(generalSection, "oneTouch.displayMinBid");
      appendSnipeSettingToggle(generalSection, "oneTouch.displayMinBuy");
      appendSnipeSettingToggle(generalSection, "oneTouch.superMode", true);
      appendSnipeSettingToggle(generalSection, "sounds.enabled");
      let transferMarketSection = createSettingsSection();
      appendElements(
        transferMarketSection,
        createElement("p", null, translate("plugins.snipe.settings.categories.transferMarket")),
      );
      appendSnipeShortcutSetting(transferMarketSection, "buttons.back");
      appendSnipeShortcutSetting(transferMarketSection, "buttons.search.search");
      appendSnipeShortcutSetting(transferMarketSection, "buttons.results.buy");
      appendSnipeShortcutSetting(transferMarketSection, "buttons.search.resetBid");
      appendSnipeShortcutSetting(transferMarketSection, "buttons.results.bid");
      appendSnipeShortcutSetting(transferMarketSection, "buttons.results.transfer");
      appendSnipeShortcutSetting(transferMarketSection, "buttons.results.club");
      appendSnipeShortcutSetting(transferMarketSection, "buttons.results.sell");
      appendSnipeShortcutSetting(transferMarketSection, "buttons.results.compare");
      appendSnipeShortcutSetting(
        transferMarketSection,
        "buttons.results.sbcStorage",
        translate("search.searchmode.storage"),
      );
      appendSnipeShortcutSetting(transferMarketSection, "buttons.lists.up");
      appendSnipeShortcutSetting(transferMarketSection, "buttons.lists.down");
      appendSnipeShortcutSetting(transferMarketSection, "buttons.lists.prev");
      appendSnipeShortcutSetting(transferMarketSection, "buttons.lists.next");
      let bidSection = createSettingsSection();
      appendElements(
        bidSection,
        createElement("p", null, translate("plugins.snipe.settings.categories.bid")),
      );
      appendSnipeShortcutSetting(bidSection, "buttons.search.decMinBid");
      appendSnipeShortcutSetting(bidSection, "buttons.search.incMinBid");
      appendSnipeShortcutSetting(bidSection, "buttons.search.decMaxBid");
      appendSnipeShortcutSetting(bidSection, "buttons.search.incMaxBid");
      appendSnipeShortcutSetting(bidSection, "buttons.search.decMinBuy");
      appendSnipeShortcutSetting(bidSection, "buttons.search.incMinBuy");
      appendSnipeShortcutSetting(bidSection, "buttons.search.decMaxBuy");
      appendSnipeShortcutSetting(bidSection, "buttons.search.incMaxBuy");
      appendSnipeShortcutSetting(bidSection, "buttons.search.oneTouchMinBid");
      appendSnipeShortcutSetting(bidSection, "buttons.search.oneTouchMinBuy");
      let playerPicksSection = createSettingsSection();
      appendElements(
        playerPicksSection,
        createElement("p", null, translate("plugins.snipe.settings.categories.playerPicks")),
      );
      appendSnipeShortcutSetting(playerPicksSection, "buttons.pick.first");
      appendSnipeShortcutSetting(playerPicksSection, "buttons.pick.second");
      appendSnipeShortcutSetting(playerPicksSection, "buttons.pick.third");
      appendSnipeShortcutSetting(playerPicksSection, "buttons.pick.fourth");
      appendSnipeShortcutSetting(playerPicksSection, "buttons.pick.fifth");
      let unassignedSection = createSettingsSection();
      appendElements(
        unassignedSection,
        createElement("p", null, translate("plugins.snipe.settings.categories.unassigned")),
      );
      appendSnipeShortcutSetting(unassignedSection, "buttons.unassigned.storeInClub");
      appendSnipeShortcutSetting(unassignedSection, "buttons.unassigned.transferList");
      appendSnipeShortcutSetting(unassignedSection, "buttons.unassigned.quickSell");
      appendSnipeShortcutSetting(unassignedSection, "buttons.unassigned.quickSellNonDuplicates");
      appendSnipeShortcutSetting(unassignedSection, "buttons.unassigned.quickSellDuplicates");
      appendSnipeShortcutSetting(unassignedSection, "buttons.unassigned.sbcStorage");
      appendSnipeShortcutSetting(unassignedSection, "buttons.unassigned.organize");
      let sbcHubSection = createSettingsSection();
      appendElements(
        sbcHubSection,
        createElement("p", null, translate("plugins.snipe.settings.categories.sbcHub")),
      );
      appendSnipeShortcutSetting(sbcHubSection, "buttons.sbcHub.repeat");
      let customShortcutsSection = createSettingsSection();
      appendElements(
        customShortcutsSection,
        createElement("p", null, translate("plugins.snipe.settings.categories.custom")),
      );
      for (const shortcut of iterateKeyboardShortcuts()) {
        appendShortcutInput(
          customShortcutsSection,
          shortcut.locale,
          shortcut.getKeyCode,
          (previousKeyCode, newKeyCode) => {
            reassignKeyboardShortcut(previousKeyCode, shortcut.name, newKeyCode);
          },
        );
      }
      menuContainer.appendChild(generalSection);
      menuContainer.appendChild(transferMarketSection);
      menuContainer.appendChild(bidSection);
      menuContainer.appendChild(playerPicksSection);
      menuContainer.appendChild(unassignedSection);
      menuContainer.appendChild(sbcHubSection);
      menuContainer.appendChild(customShortcutsSection);
      return menuContainer;
    },
  },
};

export const snipePlugin = snipePluginDefinition;
