/**
 * Refresh Coins plugin (`refreshCoinsPlugin`, order 25), installed by the plugin list in
 * src/bootstrap/boot.js: tapping the coins counter of the navigation bar re-reads the user's
 * currencies and updates the displayed coins.
 *
 * Hooks:
 * - `run()` wraps `UTCurrencyNavigationBarView.prototype._tapDetected` (after original, result
 *   returned unchanged); it acts only when the tap target is inside `this.__currencyCoins`.
 *
 * Invariants:
 * - Stylesheet id `paletools-refresh-coins` (pointer cursor): injected at boot when enabled and
 *   on `APP_ENABLED`, removed on `APP_DISABLED`.
 * - Setting `plugins.refreshCoins.enabled`.
 *
 * Known issues (kept as-is):
 * - `APP_ENABLED` re-injects the stylesheet without checking `refreshCoins.enabled`.
 * - A failed currencies request makes `requestUserCurrencies` return 0 coins, which is displayed.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { removeStylesheet, upsertStylesheet } from "../../ui/stylesheets.js";
import { requestUserCurrencies } from "../../webapp/currencies.js";
import refreshCoinsCss from "./refresh-coins.css";

let refreshCoinsPluginDefinition;

const refreshCoinsSettings = configuration.plugins.refreshCoins;

function injectRefreshCoinsStyles() {
  upsertStylesheet("paletools-refresh-coins", refreshCoinsCss);
}

refreshCoinsPluginDefinition = {
  run: function () {
    const originalTapDetected = UTCurrencyNavigationBarView.prototype._tapDetected;
    UTCurrencyNavigationBarView.prototype._tapDetected = function (event) {
      const tapResult = originalTapDetected.call(this, event);
      if (
        configuration.enabled &&
        refreshCoinsSettings.enabled &&
        this.__currencyCoins.contains(event.target)
      ) {
        requestUserCurrencies().then((currencies) => {
          this.setCurrency(currencies.coins);
        });
      }
      return tapResult;
    };
    if (configuration.enabled && refreshCoinsSettings.enabled) {
      injectRefreshCoinsStyles();
    }
    listenForEvent(paletoolsEvents.APP_ENABLED, () => injectRefreshCoinsStyles());
    listenForEvent(paletoolsEvents.APP_DISABLED, () => {
      removeStylesheet("paletools-refresh-coins");
    });
  },
  order: 25,
  settings: {
    name: "refresh-coins",
    title: "plugins.refreshCoins.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", refreshCoinsSettings.enabled, (isEnabled) => {
        refreshCoinsSettings.enabled = isEnabled;
        persistConfiguration();
      });
      return container;
    },
  },
};

export const refreshCoinsPlugin = refreshCoinsPluginDefinition;
