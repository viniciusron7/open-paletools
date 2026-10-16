/**
 * Event token progress plugin `eventTokenProgressPlugin` (order 26, no settings), installed by
 * the plugin list in src/bootstrap/boot.js: shows "earned this period / amount" on event-token
 * currency views.
 *
 * Hooks:
 * - After-hook (`hookPrototypeMethod`) on `UTCurrencyEventTokenView.setCurrency`, registered in
 *   `run()`.
 *
 * Invariants:
 * - Hook arguments are `(amount, tokenCurrency, originalResult)`; it returns the original result
 *   unchanged and does nothing without `tokenCurrency` or `this.__value`.
 * - Text: localized `services.EventToken.getPeriodEarnedCurrent(currencyName)` + `/` + localized
 *   amount. Always active (no flag is checked).
 */
import { hookPrototypeMethod } from "../../core/prototype-override.js";

let eventTokenProgressPluginDefinition;

eventTokenProgressPluginDefinition = {
  run: function () {
    hookPrototypeMethod(
      UTCurrencyEventTokenView,
      "setCurrency",
      null,
      function (amount, tokenCurrency, originalResult) {
        if (!tokenCurrency || !this.__value) {
          return originalResult;
        }
        const periodEarnedCurrent = services.EventToken.getPeriodEarnedCurrent(
          tokenCurrency.currencyName,
        );
        this.__value.textContent =
          services.Localization.localizeNumber(periodEarnedCurrent) +
          "/" +
          services.Localization.localizeNumber(amount);
        return originalResult;
      },
    );
  },
  order: 26,
};

export const eventTokenProgressPlugin = eventTokenProgressPluginDefinition;
