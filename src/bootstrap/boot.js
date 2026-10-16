/**
 * Start-up sequence; the last module of src/manifest.json, so its top-level code runs after
 * every other module was evaluated. Waits for the EA Web App, applies the core patches, opens
 * the database, starts player tracking, runs the plugins and then the settings plugin.
 *
 * Invariants:
 * - Entry: `bootWhenWebAppReady()` runs at once if `document.body` exists, otherwise once on
 *   DOMContentLoaded. Its promise is never caught: any exception ends start-up for good.
 * - `bootWhenWebAppReady` is skipped while `getAppMain()._ptBooted` is set (flag on the EA app
 *   object). Each attempt removes `.ui-orientation-warning`, then continues only without
 *   `.ut-login` and with `services.Localization` and `services.Authentication.utasSession.url`;
 *   otherwise it retries every 1000 ms, forever.
 * - Then, in order: hidden <iframe> whose `console` replaces the page console (keep it in the
 *   DOM); on `isPhone()` body classes `landscape`/`web` -> `phone`, minus `with-fifa-header`;
 *   `applyWebAppPatches()` once, before any plugin (plugin overrides wrap the core ones); await
 *   `paletoolsDatabase.init()` if IndexedDB exists (errors go to the no-op `debugLog`); await
 *   `initializePluginsWhenReady()`; `_ptBooted = true`.
 * - `initializePluginsWhenReady` latches `isWebAppUiReady` once `services.Localization` and
 *   `.ut-tab-bar` exist; otherwise it re-arms a 1000 ms timer and returns, so `_ptBooted` can
 *   be set before the plugins run.
 * - Ready path, in order: `paletoolsStorage.upgrade()`; one-time player tracking (EA observer of
 *   `AppNotification.UNASSIGNED_ITEM_ADDED` re-dispatched as UNASSIGNED_ITEM_ADDED, tracking
 *   listeners, initial sync running concurrently with plugin start-up); hide `.fc-header-view`;
 *   stylesheet `paletools` (shared CSS variables) before the plugin stylesheets; plugin runner;
 *   `reloadGameView()` (rebuilds the game view with the plugin and settings overrides);
 *   APP_LOADED; club-cache listeners (they run after the tracking ones and call
 *   `transactions.insertBuy` for players moved to the club); `dingSoundPlayer.init()`; phone
 *   back button; 'SOFTBAN?' on REQUEST_FINISHED with status 426/429/521 (events emitted by
 *   `xhrRequestEventsPlugin`); APP_STARTED.
 * - Runner: drop falsy entries, sort in place by `left.order - right.order`, append the
 *   plugins of src/custom-plugins.js (in their list order, unsorted), run each entry that has
 *   `run` in that order, await native-Promise results (`isPromise`), collect `settings` in run
 *   order for `settingsPlugin.run()` (the settings view sorts its tiles by translated title),
 *   which is not in the list. No try/catch: a throwing or rejecting `run()` stops all later
 *   plugins, the settings plugin and everything after.
 * - Keep the built-in list literal (positions included), the `getEmptyModule831Default()`
 *   entry, the comparator and `Array.prototype.sort` unchanged. That entry is module 831's
 *   exports `{}`:
 *   truthy, no `run` (skipped), no `order`, like `unassignedCountPlugin`,
 *   `xhrRequestEventsPlugin` and `warningScreenPlugin`. Comparisons with them yield NaN (taken
 *   as equal), so the comparator is inconsistent and the result depends on list positions and
 *   on the engine. In V8 the first 37 and the last 36 entries are sorted separately and
 *   concatenated (`keyboardShortcutHintsPlugin`, order -100, runs 38th; equal orders keep list
 *   order, except that `sellProfitPlugin` runs after `trackTransactionsPlugin` and
 *   `playerCardInfoPlugin`, all order 100); without `{}`, `sellProfitPlugin` would run before
 *   `xhrRequestEventsPlugin` and `trackTransactionsPlugin`, `playerCardInfoPlugin` after it.
 *   Prototype methods replaced directly by plugins nest in this run order. New plugins go in
 *   src/custom-plugins.js, not in this list: an extra sorted entry can move built-in plugins.
 *
 * Known issues (kept as-is):
 * - `hasClass("phone")` gets no element, so its guard is always true (harmless).
 * - `isPaletoolsBooted` and `playerTrackingInitialSync` are written but never read.
 * - If `getAppMain()` was falsy when the attempt started, `appMain._ptBooted = true` throws.
 * - Without IndexedDB the stores stay null, so the tracking and `insertBuy` calls made here
 *   throw (tracking failures show 'services.playerTracking.error').
 */
import { clubPlayersByDefinitionId, definitionIdsNotInClub } from "../club/club-players-cache.js";
import {
  notifyPlayerTrackingError,
  trackClubIndexPlayers,
  trackPlayerItems,
  trackPlayersFromLoader,
} from "../club/player-tracking.js";
import { isPromise } from "../core/async.js";
import {
  addClasses,
  hasClass,
  queryElement,
  removeClasses,
  removeFromParentNode,
} from "../core/dom.js";
import {
  dispatchPaletoolsEvent,
  listenForEvent,
  mobileEvents,
  paletoolsEvents,
} from "../core/events.js";
import { debugLog } from "../core/logger.js";
import { getPageWindow } from "../core/page-window.js";
import { paletoolsStorage } from "../core/storage.js";
import { customPlugins } from "../custom-plugins.js";
import { paletoolsDatabase } from "../db/database.js";
import { addMultiplePlayersToSquadPlugin } from "../plugins/add-multiple-players-to-squad/index.js";
import { albumPlugin } from "../plugins/album/index.js";
import { autoRelistPlugin } from "../plugins/auto-relist/index.js";
import { babysitterPlugin } from "../plugins/babysitter/index.js";
import { benchManagementPlugin } from "../plugins/bench-management/index.js";
import { birthdayPlugin } from "../plugins/birthday/index.js";
import { bulkBuyPlugin } from "../plugins/bulk-buy/index.js";
import { checkForUpdatesPlugin } from "../plugins/check-for-updates/index.js";
import { claimObjectivesPlugin } from "../plugins/claim-objectives/index.js";
import { claimSbcRewardsPlugin } from "../plugins/claim-sbc-rewards/index.js";
import { clubAnalyzerPlugin } from "../plugins/club-analyzer/index.js";
import { clubIndexPlugin } from "../plugins/club-index/index.js";
import { clubPagerPlugin } from "../plugins/club-pager/index.js";
import { clubSearchEnhancerPlugin } from "../plugins/club-search-enhancer/index.js";
import { compareMinMaxPricesPlugin } from "../plugins/compare-min-max-prices/index.js";
import { countMyPacksPlugin } from "../plugins/count-my-packs/index.js";
import { decimalRatingPlugin } from "../plugins/decimal-rating/index.js";
import { disablePackAnimationsPlugin } from "../plugins/disable-pack-animations/index.js";
import { donationPlugin } from "../plugins/donation/index.js";
import { duplicatedToSbcPlugin } from "../plugins/duplicated-to-sbc/index.js";
import { eventTokenProgressPlugin } from "../plugins/event-token-progress/index.js";
import { externalMarketPricesPlugin } from "../plugins/external-market-prices/index.js";
import { filterSbcsPlugin } from "../plugins/filter-sbcs/index.js";
import { galleryPlugin } from "../plugins/gallery/index.js";
import { goToPackStorePlugin } from "../plugins/go-to-pack-store/index.js";
import { gradingScorePlugin } from "../plugins/grading-score/index.js";
import { gridModePlugin } from "../plugins/grid-mode/index.js";
import { hiddenInjuryPlugin } from "../plugins/hidden-injury/index.js";
import { hideSbcsPlugin } from "../plugins/hide-sbcs/index.js";
import { importSbcPlugin } from "../plugins/import-sbc/index.js";
import { importantLeaguesAndNationsPlugin } from "../plugins/important-leagues-and-nations/index.js";
import { improvedFiltersPlugin } from "../plugins/improved-filters/index.js";
import { improvedPlayerSearchPlugin } from "../plugins/improved-player-search/index.js";
import { keepPlayerSellValuesPlugin } from "../plugins/keep-player-sell-values/index.js";
import { keyboardShortcutHintsPlugin } from "../plugins/keyboard-shortcut-hints/index.js";
import { lockPlayersPlugin } from "../plugins/lock-players/index.js";
import { lowestMarketPricePlugin } from "../plugins/lowest-market-price/index.js";
import { markDuplicatedPlugin } from "../plugins/mark-duplicated/index.js";
import { marketSearchFiltersPlugin } from "../plugins/market-search-filters/index.js";
import { myPacksPlugin } from "../plugins/my-packs/index.js";
import { packsOpenerPlugin } from "../plugins/packs-opener/index.js";
import { playerActionsPlugin } from "../plugins/player-actions/index.js";
import { playerCardInfoPlugin } from "../plugins/player-card-info/index.js";
import { playerPicksPlugin } from "../plugins/player-picks/index.js";
import { playerSnipePlugin } from "../plugins/player-snipe/index.js";
import { priceTrackerPlugin } from "../plugins/price-tracker/index.js";
import { refreshCoinsPlugin } from "../plugins/refresh-coins/index.js";
import { removeExchangePlayersButtonPlugin } from "../plugins/remove-exchange-players-button/index.js";
import { removeRoundedCornersPlugin } from "../plugins/remove-rounded-corners/index.js";
import { repeatSbcPlugin } from "../plugins/repeat-sbc/index.js";
import { sbcAutoSolverPlugin } from "../plugins/sbc-auto-solver/index.js";
import { sbcBuilderEnhancerPlugin } from "../plugins/sbc-builder-enhancer/index.js";
import { sbcChallengesViewPlugin } from "../plugins/sbc-challenges-view/index.js";
import { sbcRatingCalculatorPlugin } from "../plugins/sbc-rating-calculator/index.js";
import { sbcSmartBuilderPlugin } from "../plugins/sbc-smart-builder/index.js";
import { sbcTemplateBuilderPlugin } from "../plugins/sbc-template-builder/index.js";
import { sbcTimesCompletedPlugin } from "../plugins/sbc-times-completed/index.js";
import { selectCheapestPlugin } from "../plugins/select-cheapest/index.js";
import { sellMultiplePlugin } from "../plugins/sell-multiple/index.js";
import { sellProfitPlugin } from "../plugins/sell-profit/index.js";
import { settingsPlugin } from "../plugins/settings/index.js";
import { snipePlugin } from "../plugins/snipe/index.js";
import { trackTransactionsPlugin } from "../plugins/track-transactions/index.js";
import { transferListSendAllToClubPlugin } from "../plugins/transfer-list-send-all-to-club/index.js";
import { transferListToSbcPlugin } from "../plugins/transfer-list-to-sbc/index.js";
import { unassignedCountPlugin } from "../plugins/unassigned-count/index.js";
import { unassignedGoBackPlugin } from "../plugins/unassigned-go-back/index.js";
import { unassignedOrganizePlugin } from "../plugins/unassigned-organize/index.js";
import { unassignedToSbcPlugin } from "../plugins/unassigned-to-sbc/index.js";
import { warningScreenPlugin } from "../plugins/warning-screen/index.js";
import { whatsNewPlugin } from "../plugins/whats-new/index.js";
import { wideModePlugin } from "../plugins/wide-mode/index.js";
import { xhrRequestEventsPlugin } from "../plugins/xhr-request-events/index.js";
import { getEmptyModule831Default } from "../runtime/empty-module-831.js";
import { showErrorNotification } from "../ui/notifications.js";
import { dingSoundPlayer } from "../ui/sound.js";
import { upsertStylesheet } from "../ui/stylesheets.js";
import { hideElements } from "../ui/visibility.js";
import { reloadGameView } from "../webapp/game-view.js";
import {
  fetchSbcStorageItems,
  fetchTransferListItems,
  fetchUnassignedItems,
  fetchWatchlistItems,
} from "../webapp/item-piles.js";
import { getActiveNavigationController } from "../webapp/navigation.js";
import { applyWebAppPatches } from "../webapp/patches.js";
import paletoolsStyles from "../styles/paletools.css";

let unassignedObserverRegistered = false;

let playerTrackingInitialSync;

let isPlayerTrackingInitialized = false;

let isPaletoolsBooted = false;

let isWebAppUiReady = false;

async function bootWhenWebAppReady() {
  const appMain = getAppMain();
  var consoleIframe;
  if (!(appMain && appMain._ptBooted)) {
    (function () {
      const orientationWarning = queryElement(".ui-orientation-warning");
      if (orientationWarning) {
        removeFromParentNode(orientationWarning);
      }
    })();
    if (
      !queryElement(".ut-login") &&
      services &&
      services.Localization &&
      services.Authentication.utasSession &&
      services.Authentication.utasSession.url
    ) {
      (consoleIframe = document.createElement("iframe")).style.display = "none";
      document.body.appendChild(consoleIframe);
      getPageWindow().console = consoleIframe.contentWindow.console;
      (function () {
        if (isPhone()) {
          const bodyElement = queryElement("body");
          if (!hasClass("phone")) {
            addClasses(removeClasses(removeClasses(bodyElement, "landscape"), "web"), "phone");
          }
          removeClasses(queryElement("body"), "with-fifa-header");
        }
      })();
      applyWebAppPatches();
      await (async function () {
        if (paletoolsDatabase.isSupported()) {
          try {
            await paletoolsDatabase.init();
          } catch {
            debugLog("Error initializing database");
          }
        }
      })();
      await initializePluginsWhenReady();
      isPaletoolsBooted = true;
      appMain._ptBooted = true;
    } else {
      setTimeout(bootWhenWebAppReady, 1000);
    }
  }
}

async function initializePluginsWhenReady() {
  if (services.Localization && queryElement(".ut-tab-bar")) {
    isWebAppUiReady = true;
  }
  if (isWebAppUiReady) {
    paletoolsStorage.upgrade();
    if (!isPlayerTrackingInitialized) {
      isPlayerTrackingInitialized = true;
      if (!unassignedObserverRegistered) {
        unassignedObserverRegistered = true;
        getDefaultDispatcher().addObserver(
          AppNotification.UNASSIGNED_ITEM_ADDED,
          {},
          (unusedArgument1, unusedArgument2, notificationData) => {
            dispatchPaletoolsEvent(paletoolsEvents.UNASSIGNED_ITEM_ADDED, notificationData);
          },
        );
      }
      listenForEvent(paletoolsEvents.UNASSIGNED_ITEM_ADDED, (event) =>
        trackPlayerItems(event.detail?.items || []).catch(notifyPlayerTrackingError),
      );
      listenForEvent(paletoolsEvents.ITEM_MOVED, (event) =>
        trackPlayerItems([event.detail?.item]).catch(notifyPlayerTrackingError),
      );
      listenForEvent(paletoolsEvents.ITEM_WON, (event) =>
        trackPlayerItems([event.detail?.item]).catch(notifyPlayerTrackingError),
      );
      listenForEvent(paletoolsEvents.ITEM_DISCARDED, (event) =>
        trackPlayerItems([event.detail?.item]).catch(notifyPlayerTrackingError),
      );
      listenForEvent(paletoolsEvents.CLUB_INDEX_LOADED, () =>
        trackClubIndexPlayers().catch(notifyPlayerTrackingError),
      );
      playerTrackingInitialSync = Promise.all([
        trackClubIndexPlayers().catch(notifyPlayerTrackingError),
        ...[
          fetchUnassignedItems,
          fetchSbcStorageItems,
          fetchTransferListItems,
          fetchWatchlistItems,
        ].map(trackPlayersFromLoader),
      ]);
    }
    hideElements(queryElement(".fc-header-view"));
    upsertStylesheet("paletools", paletoolsStyles);
    await (async function () {
      const plugins = [
        donationPlugin,
        compareMinMaxPricesPlugin,
        playerActionsPlugin,
        unassignedCountPlugin,
        marketSearchFiltersPlugin,
        gridModePlugin,
        wideModePlugin,
        duplicatedToSbcPlugin,
        unassignedToSbcPlugin,
        transferListToSbcPlugin,
        selectCheapestPlugin,
        importSbcPlugin,
        improvedPlayerSearchPlugin,
        markDuplicatedPlugin,
        filterSbcsPlugin,
        sbcTimesCompletedPlugin,
        clubIndexPlugin,
        clubAnalyzerPlugin,
        countMyPacksPlugin,
        transferListSendAllToClubPlugin,
        sbcBuilderEnhancerPlugin,
        getEmptyModule831Default(),
        sbcSmartBuilderPlugin,
        disablePackAnimationsPlugin,
        clubSearchEnhancerPlugin,
        keepPlayerSellValuesPlugin,
        sellMultiplePlugin,
        xhrRequestEventsPlugin,
        gradingScorePlugin,
        checkForUpdatesPlugin,
        warningScreenPlugin,
        sellProfitPlugin,
        trackTransactionsPlugin,
        playerCardInfoPlugin,
        importantLeaguesAndNationsPlugin,
        refreshCoinsPlugin,
        eventTokenProgressPlugin,
        packsOpenerPlugin,
        myPacksPlugin,
        externalMarketPricesPlugin,
        sbcRatingCalculatorPlugin,
        claimObjectivesPlugin,
        decimalRatingPlugin,
        lowestMarketPricePlugin,
        repeatSbcPlugin,
        sbcAutoSolverPlugin,
        goToPackStorePlugin,
        benchManagementPlugin,
        removeExchangePlayersButtonPlugin,
        sbcTemplateBuilderPlugin,
        lockPlayersPlugin,
        claimSbcRewardsPlugin,
        sbcChallengesViewPlugin,
        addMultiplePlayersToSquadPlugin,
        hiddenInjuryPlugin,
        snipePlugin,
        playerSnipePlugin,
        bulkBuyPlugin,
        albumPlugin,
        priceTrackerPlugin,
        galleryPlugin,
        keyboardShortcutHintsPlugin,
        autoRelistPlugin,
        babysitterPlugin,
        birthdayPlugin,
        unassignedGoBackPlugin,
        playerPicksPlugin,
        whatsNewPlugin,
        improvedFiltersPlugin,
        unassignedOrganizePlugin,
        hideSbcsPlugin,
        removeRoundedCornersPlugin,
        clubPagerPlugin,
      ].filter((plugin) => plugin);
      const pluginSettings = [];
      plugins.sort((left, right) => left.order - right.order);
      plugins.push(...customPlugins);
      for (let plugin of plugins) {
        if (!plugin.run) {
          continue;
        }
        const runResult = plugin.run();
        if (isPromise(runResult)) {
          await runResult;
        }
        if (plugin.settings) {
          pluginSettings.push(plugin.settings);
        }
      }
      if (settingsPlugin) {
        settingsPlugin.run(pluginSettings);
      }
    })();
    reloadGameView();
    dispatchPaletoolsEvent(paletoolsEvents.APP_LOADED);
    listenForEvent(paletoolsEvents.ITEM_MOVED, (event) => {
      if (event.detail.item.type === ItemType.PLAYER) {
        if (event.detail.itemPile === ItemPile.CLUB) {
          if (!clubPlayersByDefinitionId[event.detail.item.definitionId]) {
            clubPlayersByDefinitionId[event.detail.item.definitionId] = event.detail.item;
          }
          definitionIdsNotInClub.delete(event.detail.item.definitionId);
          paletoolsDatabase.transactions.insertBuy(event.detail.item);
        } else {
          if (clubPlayersByDefinitionId[event.detail.item.definitionId]) {
            delete clubPlayersByDefinitionId[event.detail.item.definitionId];
          }
          definitionIdsNotInClub.add(event.detail.item.definitionId);
        }
      }
    });
    listenForEvent(paletoolsEvents.ITEM_DISCARDED, (event) => {
      if (event.detail.item.type === ItemType.PLAYER) {
        if (clubPlayersByDefinitionId[event.detail.item.definitionId]) {
          delete clubPlayersByDefinitionId[event.detail.item.definitionId];
        }
        definitionIdsNotInClub.add(event.detail.item.definitionId);
      }
    });
    dingSoundPlayer.init();
    if (isPhone()) {
      listenForEvent(mobileEvents.BACK_BUTTON_PRESSED, () => {
        getActiveNavigationController().popViewController();
      });
    }
    listenForEvent(paletoolsEvents.REQUEST_FINISHED, (event) => {
      var httpStatus;
      if (
        (httpStatus = event.detail.xhr.status) === 426 ||
        httpStatus === 429 ||
        httpStatus === 521
      ) {
        showErrorNotification("SOFTBAN?");
      }
    });
    dispatchPaletoolsEvent(paletoolsEvents.APP_STARTED);
  } else {
    setTimeout(initializePluginsWhenReady, 1000);
  }
}

if (document.body) {
  bootWhenWebAppReady();
} else {
  document.addEventListener("DOMContentLoaded", () => {
    bootWhenWebAppReady();
  });
}
