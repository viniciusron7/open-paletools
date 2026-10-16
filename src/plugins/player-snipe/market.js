/**
 * Web App side of Player snipe, called through the runner callbacks built in
 * market-automation/sessions.js: player/Player ID identity checks, the search driven through the
 * native filters screen, the purchase and the navigation back to the filters.
 *
 * Invariants:
 * - Identity: an offer counts only if `isPlayer()` and its definitionId equals the confirmed id
 *   or `getItemDatabaseId(item)` equals `id & ItemIdMask.DATABASE` (any card version).
 *   `validatePlayerSnipeFilterIdentity` throws when a `criteria.defId` entry or the Paletools
 *   Player ID input (`view._playerId`) has another base id.
 * - Before each search: the session controller must be visible, the view is re-read (native views
 *   are rebuilt), the selection id and maximum must equal the confirmed ones, and the identity is
 *   checked before applying filters and again after `updateSearchCriteria()`; a mismatch rejects
 *   and ends the session with an error.
 * - Prices are set directly: session criteria plus minBid/minBuy, maxBid 0 and maxBuy go into the
 *   DTO, then `setFilters` and the four view price setters run, then the DTO prices are written
 *   again because the setters emit CHANGE. The native `e*PriceChanged` handlers are not used
 *   (they read old inputs, change equal minimums and need a delta); player-snipe/index.js cancels
 *   them while a session is active.
 * - Search: clears the legacy snipe queue (`clearSnipeRequests`, keeps its validator inert) and
 *   the transfer-market cache, registers `session.pendingSearch` { prices, captured, accept } and
 *   calls `controller.eSearchSelected()` with `session.triggeringSearch` set; the
 *   `searchTransferMarket` override in index.js hands the native observable to `accept`. Not
 *   started within 30 s, or no answer within 30 s, fails.
 * - Stop during a search rejects with AbortError and clears `pendingSearch` (the native request
 *   is not cancelled, its answer is ignored). Results keep server order, filtered to the
 *   confirmed player, `_tradeState` ACTIVE and an integer buyNowPrice in (0, maxBuy].
 * - Purchase: nothing is sent once aborted; identity and price <= maxBuy are re-checked (throw)
 *   and a non-ACTIVE offer returns false; the bid via `sharedItemActionController.bid` is
 *   observed WITHOUT the signal; success marks `ItemPile.PURCHASED` dirty and dispatches
 *   `SNIPE_SUCCESS`.
 * - Return: reuse the visible filters controller, pop to one in the navigation stack, or push a
 *   new one built from `session.criteria` (popping a results controller first); poll
 *   `getActiveController()` up to 50 x 40 ms (abortable), then update
 *   `session.controller`/`session.view`.
 *
 * Known issues (kept as-is):
 * - `session.applyingFilters` is written but never read.
 * - The search does not set `disableOverrides`, so market-search-filters transformers apply: with
 *   hideDuplicates on, offers of a card version the user owns are removed before the runner sees
 *   them.
 */
import { getItemDatabaseId } from "../../club/club-index.js";
import { dispatchPaletoolsEvent, paletoolsEvents } from "../../core/events.js";
import { sharedItemActionController } from "../../market/item-actions.js";
import {
  PLAYER_SNIPE_REQUEST_TIMEOUT_MS,
  createPlayerSnipeAbortError,
  observePlayerSnipeRequest,
  validatePlayerSnipeResponse,
  waitForPlayerSnipe,
} from "../market-automation/requests.js";
import { getPlayerSnipeMaximum, getPlayerSnipeSelection } from "./selection.js";
import { clearSnipeRequests } from "../snipe/state.js";
import { getActiveController, getViewModel } from "../../webapp/navigation.js";

function isPlayerSnipeResultsController(controller) {
  return (
    controller instanceof UTMarketSearchResultsViewController ||
    controller instanceof UTMarketSearchResultsSplitViewController
  );
}

function isConfirmedPlayerSnipeItem(session, item) {
  const definitionId = item?.definitionId ?? item?.itemData?.definitionId;
  const selectedId = Number(session.player.id);
  // A selected name may include all card revisions of the same player.
  return (
    item?.isPlayer?.() === true &&
    (definitionId === selectedId || getItemDatabaseId(item) === (selectedId & ItemIdMask.DATABASE))
  );
}

export function validatePlayerSnipeFilterIdentity(view, controller, player) {
  const criteria = getViewModel(controller).searchCriteria;
  const ids = Array.isArray(criteria.defId)
    ? [...criteria.defId]
    : criteria.defId
      ? [criteria.defId]
      : [];
  const playerIdControl = view._playerId;
  if (playerIdControl) {
    const entered =
      typeof playerIdControl.getValue === "function"
        ? playerIdControl.getValue()
        : playerIdControl.getRootElement().value;
    if (String(entered ?? "").trim()) {
      ids.push(entered);
    }
  }
  const confirmedBaseId = Number(player.id) & ItemIdMask.DATABASE;
  for (const rawId of ids) {
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0 || (id & ItemIdMask.DATABASE) !== confirmedBaseId) {
      throw new Error(
        "The Player ID filter does not match the selected player. Clear or correct that field before sniping.",
      );
    }
  }
}

export async function returnToPlayerSnipeFilters(session, signal) {
  if (signal.aborted) {
    throw createPlayerSnipeAbortError();
  }
  const navigation = session.navigation;
  const currentController = navigation.getCurrentController();
  const stack = navigation.childViewControllers || navigation._childViewControllers || [];
  let controller =
    currentController instanceof UTMarketSearchFiltersViewController
      ? currentController
      : stack.find((candidate) => candidate instanceof UTMarketSearchFiltersViewController);
  if (!controller) {
    controller = new UTMarketSearchFiltersViewController();
    const criteria = new UTSearchCriteriaDTO();
    Object.assign(criteria, session.criteria);
    controller.initWithSearchCriteria(criteria);
    if (isPlayerSnipeResultsController(currentController)) {
      navigation.popViewController();
    }
    navigation.pushViewController(controller);
  } else if (currentController !== controller) {
    navigation.popToViewController(controller);
  }
  for (let attempts = 0; attempts < 50; attempts++) {
    if (signal.aborted) {
      throw createPlayerSnipeAbortError();
    }
    let visible;
    try {
      visible = getActiveController();
    } catch {
      /* Native navigation is still transitioning. */
    }
    if (visible === controller) {
      session.controller = controller;
      session.view = controller.getView();
      return;
    }
    await waitForPlayerSnipe(40, signal);
  }
  throw new Error("Could not go back to the Transfer Market filters.");
}

export function searchPlayerSnipeMarket(session, prices, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      return reject(createPlayerSnipeAbortError());
    }
    if (getActiveController() !== session.controller) {
      return reject(new Error("The Transfer Market filters are not ready to search yet."));
    }
    // The native controller can rebuild its view after displaying results.
    session.view = session.controller.getView();
    const selected = getPlayerSnipeSelection(session.view, session.controller);
    if (selected?.id !== session.player.id) {
      return reject(new Error("The selected player changed. Confirm a new search."));
    }
    if (getPlayerSnipeMaximum(session.view) !== session.maxBuy) {
      return reject(new Error("The max price changed. Confirm a new search."));
    }
    validatePlayerSnipeFilterIdentity(session.view, session.controller, session.player);
    const model = getViewModel(session.controller);
    Object.assign(model.searchCriteria, session.criteria, {
      minBid: prices.minBid,
      minBuy: prices.minBuy,
      maxBid: 0,
      maxBuy: session.maxBuy,
    });
    session.applyingFilters = true;
    try {
      session.view.setFilters(model);
      session.view.setMinBidPrice(prices.minBid);
      session.view.setMaxBidPrice(0);
      session.view.setMinBuyNowPrice(prices.minBuy);
      session.view.setMaxBuyNowPrice(session.maxBuy);
      // Currency setters emit CHANGE. The plugin suppresses native price
      // normalizers during this session and explicitly owns these values.
      Object.assign(model.searchCriteria, {
        minBid: prices.minBid,
        maxBid: 0,
        minBuy: prices.minBuy,
        maxBuy: session.maxBuy,
      });
      session.view._clearBidPrice?.setInteractionState(prices.minBid > 0);
      session.view._clearBuyPrice?.setInteractionState(true);
    } finally {
      session.applyingFilters = false;
    }
    clearSnipeRequests();
    services.Item.clearTransferMarketCache();
    const pending = {
      prices,
      captured: false,
      accept: null,
    };
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      if (session.pendingSearch === pending) {
        session.pendingSearch = null;
      }
    };
    const onAbort = () => {
      cleanup();
      reject(createPlayerSnipeAbortError());
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("The Transfer Market search was not started."));
    }, PLAYER_SNIPE_REQUEST_TIMEOUT_MS);
    pending.accept = (observable) => {
      pending.captured = true;
      clearTimeout(timeout);
      observePlayerSnipeRequest(observable, signal)
        .then((response) => {
          validatePlayerSnipeResponse(response, "search the Transfer Market");
          if (!Array.isArray(response.data?.items)) {
            throw new Error("The Transfer Market returned an invalid list of offers.");
          }
          return response.data.items.filter((item) => {
            const auction = item.getAuctionData?.();
            return (
              isConfirmedPlayerSnipeItem(session, item) &&
              auction &&
              auction._tradeState === AuctionTradeStateEnum.ACTIVE &&
              Number.isSafeInteger(auction.buyNowPrice) &&
              auction.buyNowPrice > 0 &&
              auction.buyNowPrice <= session.maxBuy
            );
          });
        })
        .then(resolve, reject)
        .finally(cleanup);
    };
    session.pendingSearch = pending;
    signal.addEventListener("abort", onAbort, {
      once: true,
    });
    try {
      session.triggeringSearch = true;
      // Native price-change handlers read old inputs, alter equal minimums,
      // and require a delta argument. Set prices directly and keep the DTO.
      session.view.updateSearchCriteria?.();
      validatePlayerSnipeFilterIdentity(session.view, session.controller, session.player);
      session.controller.eSearchSelected();
    } catch (error) {
      cleanup();
      reject(error);
    } finally {
      session.triggeringSearch = false;
    }
  });
}

export async function buyPlayerSnipeOffer(session, item, signal) {
  if (signal.aborted) {
    return false;
  }
  if (!isConfirmedPlayerSnipeItem(session, item)) {
    throw new Error("The offer does not match the confirmed player.");
  }
  const auction = item.getAuctionData();
  if (auction._tradeState !== AuctionTradeStateEnum.ACTIVE) {
    return false;
  }
  if (
    !Number.isSafeInteger(auction.buyNowPrice) ||
    auction.buyNowPrice <= 0 ||
    auction.buyNowPrice > session.maxBuy
  ) {
    throw new Error("The offer price is outside the confirmed maximum.");
  }
  // Do not abort observation of a purchase already submitted to the server.
  const response = await observePlayerSnipeRequest(
    sharedItemActionController.bid(item, auction.buyNowPrice),
  );
  validatePlayerSnipeResponse(response, "buy the offer");
  repositories.Item.setDirty(ItemPile.PURCHASED);
  dispatchPaletoolsEvent(paletoolsEvents.SNIPE_SUCCESS, item);
  return true;
}
