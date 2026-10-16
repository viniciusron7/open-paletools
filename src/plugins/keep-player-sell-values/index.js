/**
 * Keep player sell values plugin `keepPlayerSellValuesPlugin` (order 6), installed by the plugin
 * list in src/bootstrap/boot.js: remembers the last listing values per definitionId and pre-fills
 * bid and buy-now in the quick list panel.
 *
 * Hooks (installed in `run()`):
 * - `UTQuickListPanelViewController.prototype._onList`: records the listing values BEFORE calling
 *   the original.
 * - `UTQuickListPanelViewController.prototype.renderView` (original first): sets buy-now and bid
 *   from the remembered values, else from `getCachedLowestMarketPrice` with the bid one price
 *   step lower (`decreasePriceByOneStep`).
 *
 * Invariants:
 * - Values live in a closure map for the session only (not persisted); the cached-price fallback
 *   is stored in the map too, so later cache updates are ignored for that definitionId.
 * - The remembered `duration` is read but never applied.
 * - The definition also carries a top-level `menu`; boot only uses `settings`.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { getCachedLowestMarketPrice } from "../../market/lowest-price-cache.js";
import { decreasePriceByOneStep } from "../../market/prices.js";
import { appendToggle } from "../../ui/settings-controls.js";

let keepPlayerSellValuesPluginDefinition;

const keepPlayerSellValuesSettings = configuration.plugins.keepPlayerSellValues;

function createKeepPlayerSellValuesSettingsMenu() {
  const container = document.createElement("div");
  appendToggle(container, "enabled", keepPlayerSellValuesSettings.enabled, (isEnabled) => {
    keepPlayerSellValuesSettings.enabled = isEnabled;
    persistConfiguration();
  });
  return container;
}

keepPlayerSellValuesPluginDefinition = {
  run: function () {
    const sellValuesByDefinitionId = {};
    const originalOnList = UTQuickListPanelViewController.prototype._onList;
    UTQuickListPanelViewController.prototype._onList = function (sender, eventType, listingValues) {
      if (keepPlayerSellValuesSettings.enabled) {
        sellValuesByDefinitionId[this.item.definitionId] = listingValues;
      }
      originalOnList.call(this, sender, eventType, listingValues);
    };
    const originalRenderView = UTQuickListPanelViewController.prototype.renderView;
    UTQuickListPanelViewController.prototype.renderView = function () {
      originalRenderView.call(this);
      if (keepPlayerSellValuesSettings.enabled) {
        if (!sellValuesByDefinitionId[this.item.definitionId]) {
          const cachedPrice = getCachedLowestMarketPrice(this.item.definitionId);
          if (!cachedPrice) {
            return;
          }
          sellValuesByDefinitionId[this.item.definitionId] = {
            bidAmount: decreasePriceByOneStep(cachedPrice),
            buyAmount: cachedPrice,
          };
        }
        const {
          bidAmount: bidAmount,
          buyAmount: buyAmount,
          duration: duration,
        } = sellValuesByDefinitionId[this.item.definitionId];
        this.getView().setBuyNowValue(buyAmount);
        this.getView().setBidValue(bidAmount);
      }
    };
  },
  order: 6,
  menu: createKeepPlayerSellValuesSettingsMenu,
  settings: {
    name: "keep-player-sell-values",
    title: "plugins.keepPlayerSellValues.settings.title",
    menu: createKeepPlayerSellValuesSettingsMenu,
  },
};

export const keepPlayerSellValuesPlugin = keepPlayerSellValuesPluginDefinition;
