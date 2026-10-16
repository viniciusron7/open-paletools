/**
 * Bulk buy plugin (`bulkBuyPlugin`, order 10011, installed by the plugin list in
 * src/bootstrap/boot.js): adds the 'Bulk Buy' button to the market filters; the dialog and
 * the run live in market-automation/sessions.js.
 *
 * Hooks:
 * - In `run()`, via `hookPrototypeMethod`: `UTMarketSearchFiltersView._generate` and
 *   `UTMarketSearchFiltersViewController.viewDidAppear` (after: attach button),
 *   `destroyGeneratedElements` (before: close this view's dialog, destroy the button, forget the
 *   view).
 *
 * Invariants:
 * - One button per view (`view._bulkBuyButton`) in `.button-container`, tracked in
 *   `bulkBuyViews`; attached to the current filters view at `run()`.
 * - APP_DISABLED stops a running bulk buy and closes the dialog; APP_ENABLED refreshes the
 *   buttons. Stylesheet id `paletools-bulk-buy`. No search/reset hooks: a run searches through
 *   the services directly.
 */
import { addClasses, appendElements, queryElement } from "../../core/dom.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { hookPrototypeMethod } from "../../core/prototype-override.js";
import {
  activeBulkBuySession,
  bulkBuyConfirmation,
  bulkBuyViews,
  openBulkBuyDialog,
  refreshBulkBuyButtons,
} from "../market-automation/sessions.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { getActiveController } from "../../webapp/navigation.js";
import bulkBuyCss from "./bulk-buy.css";

function attachBulkBuyButton(view) {
  if (view._bulkBuyButton) {
    return;
  }
  const container = queryElement(".button-container", view.__searchContainer);
  if (!container) {
    return;
  }
  const button = new UTStandardButtonControl();
  button.init();
  button.setText("Bulk Buy");
  button.addTarget(view, () => openBulkBuyDialog(view), EventType.TAP);
  addClasses(button, "paletools-bulk-buy-button");
  appendElements(container, button);
  view._bulkBuyButton = button;
  bulkBuyViews.add(view);
  refreshBulkBuyButtons();
}

export const bulkBuyPlugin = {
  order: 10011,
  run() {
    upsertStylesheet("paletools-bulk-buy", bulkBuyCss);
    hookPrototypeMethod(UTMarketSearchFiltersView, "_generate", null, function () {
      attachBulkBuyButton(this);
    });
    hookPrototypeMethod(UTMarketSearchFiltersViewController, "viewDidAppear", null, function () {
      attachBulkBuyButton(this.getView());
    });
    hookPrototypeMethod(UTMarketSearchFiltersView, "destroyGeneratedElements", function () {
      if (bulkBuyConfirmation?.view === this) {
        bulkBuyConfirmation.close();
      }
      this._bulkBuyButton?.destroy();
      delete this._bulkBuyButton;
      bulkBuyViews.delete(this);
    });
    listenForEvent(paletoolsEvents.APP_DISABLED, () => {
      activeBulkBuySession?.runner.stop();
      bulkBuyConfirmation?.close();
      refreshBulkBuyButtons();
    });
    listenForEvent(paletoolsEvents.APP_ENABLED, refreshBulkBuyButtons);
    const currentController = getActiveController();
    if (currentController instanceof UTMarketSearchFiltersViewController) {
      attachBulkBuyButton(currentController.getView());
    }
  },
};
