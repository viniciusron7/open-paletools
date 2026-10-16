/**
 * Player snipe plugin (`playerSnipePlugin`, order 10010, installed by the plugin list in
 * src/bootstrap/boot.js): adds the 'Snipe Player' button to the market filters, keeps its
 * availability in sync and installs the hooks that protect a running session. The session logic
 * lives in market-automation/sessions.js.
 *
 * Hooks:
 * - In `run()`, via `hookPrototypeMethod`: `UTMarketSearchFiltersView._generate` and
 *   `UTMarketSearchFiltersViewController.viewDidAppear` (after: attach button), `setFilters`
 *   (after: refresh), `destroyGeneratedElements` (before: close this view's confirmation, remove
 *   listeners and button).
 * - `eMinBidPriceChanged`, `eMaxBidPriceChanged`, `eMinBuyPriceChanged`, `eMaxBuyPriceChanged`
 *   (before: `prototypeOverride.cancel()` while `activePlayerSnipeSession` is set; after:
 *   refresh).
 * - `UTMarketSearchFiltersViewController.eSearchSelected` (before: stop the session for a manual
 *   search, i.e. neither `triggeringSearch` nor `pendingSearch`) and `eResetSelected` (before:
 *   stop).
 * - `services.Item.searchTransferMarket` replaced in `run()`, wrapping the src/webapp/patches.js
 *   wrapper.
 *
 * Invariants:
 * - CHANGE protection lasts for the whole session, including 'stopping' and native
 *   `viewDidAppear` restoring the inputs: the native handlers enforce minBid < minBuy and read
 *   `event.delta`, while the session needs equal minimums after each bid step. After hooks still
 *   run on cancel, so the button stays refreshed.
 * - The search override captures only the pending session search (not yet captured;
 *   `criteria.maxBuy`, `minBid || 0`, `minBuy || 0` equal the session values); it always calls
 *   the original first and returns its observable unchanged (already post transformers).
 * - One button per view (`view._playerSnipeButton`) in `.button-container` of
 *   `__searchContainer`; root input/change listeners and the player-name search CHANGE target
 *   call `_refreshPlayerSnipeButton` (now and in a microtask); views are tracked in
 *   `playerSnipeViews`.
 * - APP_DISABLED stops the session and closes the confirmation; APP_ENABLED refreshes. Stylesheet
 *   id `paletools-player-snipe` (also styles the bulk-buy dialog and panel).
 * - The `_generate`/`destroyGeneratedElements` hooks live in the wrapper that the legacy snipe
 *   plugin's direct overrides call first; they run only while those overrides keep calling the
 *   captured original.
 */
import { addClasses, appendElements, queryElement } from "../../core/dom.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { hookPrototypeMethod, prototypeOverride } from "../../core/prototype-override.js";
import {
  activePlayerSnipeSession,
  confirmPlayerSnipe,
  playerSnipeConfirmation,
  playerSnipeViews,
  refreshPlayerSnipeButton,
} from "../market-automation/sessions.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { getActiveController } from "../../webapp/navigation.js";
import playerSnipeCss from "./player-snipe.css";

function attachPlayerSnipeButton(view) {
  if (view._playerSnipeButton) {
    return;
  }
  const container = queryElement(".button-container", view.__searchContainer);
  if (!container) {
    return;
  }
  const button = new UTStandardButtonControl();
  button.init();
  button.setText("Snipe Player");
  button.addTarget(view, () => confirmPlayerSnipe(view), EventType.TAP);
  addClasses(button, "paletools-player-snipe-button");
  appendElements(container, button);
  view._playerSnipeButton = button;
  view._refreshPlayerSnipeButton = () => {
    refreshPlayerSnipeButton(view);
    queueMicrotask(() => refreshPlayerSnipeButton(view));
  };
  view.getRootElement().addEventListener("input", view._refreshPlayerSnipeButton);
  view.getRootElement().addEventListener("change", view._refreshPlayerSnipeButton);
  view._playerSnipePlayerSearch = view._searchFilters?.getPlayerNameSearch();
  view._playerSnipePlayerSearch?.addTarget(view, view._refreshPlayerSnipeButton, EventType.CHANGE);
  playerSnipeViews.add(view);
  refreshPlayerSnipeButton(view);
}

export const playerSnipePlugin = {
  order: 10010,
  run() {
    upsertStylesheet("paletools-player-snipe", playerSnipeCss);
    hookPrototypeMethod(UTMarketSearchFiltersView, "_generate", null, function () {
      attachPlayerSnipeButton(this);
    });
    hookPrototypeMethod(UTMarketSearchFiltersView, "setFilters", null, function () {
      refreshPlayerSnipeButton(this);
    });
    for (const method of [
      "eMinBidPriceChanged",
      "eMaxBidPriceChanged",
      "eMinBuyPriceChanged",
      "eMaxBuyPriceChanged",
    ]) {
      hookPrototypeMethod(
        UTMarketSearchFiltersView,
        method,
        function () {
          // Native handlers enforce minBid < minBuy and read event.delta.
          // Our confirmed session needs equal minimums at each bid reset,
          // including while native viewDidAppear restores these inputs.
          if (activePlayerSnipeSession) {
            return prototypeOverride.cancel();
          }
        },
        function () {
          refreshPlayerSnipeButton(this);
        },
      );
    }
    hookPrototypeMethod(UTMarketSearchFiltersViewController, "viewDidAppear", null, function () {
      attachPlayerSnipeButton(this.getView());
      refreshPlayerSnipeButton(this.getView());
    });
    hookPrototypeMethod(UTMarketSearchFiltersViewController, "eSearchSelected", function () {
      const session = activePlayerSnipeSession;
      if (session && !session.triggeringSearch && !session.pendingSearch) {
        session.runner.stop();
      }
    });
    hookPrototypeMethod(UTMarketSearchFiltersViewController, "eResetSelected", function () {
      activePlayerSnipeSession?.runner.stop();
    });
    hookPrototypeMethod(UTMarketSearchFiltersView, "destroyGeneratedElements", function () {
      if (playerSnipeConfirmation?.view === this) {
        playerSnipeConfirmation.close();
      }
      this.getRootElement().removeEventListener("input", this._refreshPlayerSnipeButton);
      this.getRootElement().removeEventListener("change", this._refreshPlayerSnipeButton);
      this._playerSnipePlayerSearch?.removeTarget(
        this,
        this._refreshPlayerSnipeButton,
        EventType.CHANGE,
      );
      this._playerSnipeButton?.destroy();
      delete this._playerSnipeButton;
      playerSnipeViews.delete(this);
    });
    const originalSearch = services.Item.searchTransferMarket;
    services.Item.searchTransferMarket = function (criteria, ...args) {
      const session = activePlayerSnipeSession;
      const pending = session?.pendingSearch;
      const owned =
        pending &&
        !pending.captured &&
        Number(criteria.maxBuy) === session.maxBuy &&
        Number(criteria.minBid || 0) === pending.prices.minBid &&
        Number(criteria.minBuy || 0) === pending.prices.minBuy;
      const observable = originalSearch.call(this, criteria, ...args);
      if (owned) {
        pending.accept(observable);
      }
      return observable;
    };
    listenForEvent(paletoolsEvents.APP_DISABLED, () => {
      activePlayerSnipeSession?.runner.stop();
      playerSnipeConfirmation?.close();
      for (const view of playerSnipeViews) {
        refreshPlayerSnipeButton(view);
      }
    });
    listenForEvent(paletoolsEvents.APP_ENABLED, () => {
      for (const view of playerSnipeViews) {
        refreshPlayerSnipeButton(view);
      }
    });
    const currentController = getActiveController();
    if (currentController instanceof UTMarketSearchFiltersViewController) {
      attachPlayerSnipeButton(currentController.getView());
    }
  },
};
