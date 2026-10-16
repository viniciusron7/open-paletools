/**
 * Select Cheapest plugin (`selectCheapestPlugin`, order 100), installed by the plugin list in
 * src/bootstrap/boot.js: when market search results load, selects the item with the lowest
 * buy-now price and names it in a banner.
 *
 * Hooks (installed in `run()`):
 * - `UTMarketSearchResultsSplitViewController.prototype._eListDataChanged` (after original):
 *   takes the first item with the lowest `buyNowPrice > 0` and calls
 *   `selectMarketSearchResultAt(index)`.
 * - `UTMarketSearchFiltersViewController.prototype.getNavigationTitle` (before original): clears
 *   the banner with `setBannerMessage("")`.
 *
 * Invariants:
 * - Banner text `plugins.selectCheapest.banner.text` with `{name}` and `{minBuyNow}` (formatted
 *   by `formatNumber`).
 * - Requires `configuration.enabled` and `plugins.selectCheapest.enabled` (default off).
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { formatNumber, translate } from "../../i18n/translations.js";
import { selectMarketSearchResultAt } from "../../market/search-results.js";
import { setBannerMessage } from "../../ui/banner.js";
import { appendToggle } from "../../ui/settings-controls.js";

let selectCheapestPluginDefinition;

const selectCheapestSettings = configuration.plugins.selectCheapest;

selectCheapestPluginDefinition = {
  run: function () {
    const originalEListDataChanged =
      UTMarketSearchResultsSplitViewController.prototype._eListDataChanged;
    UTMarketSearchResultsSplitViewController.prototype._eListDataChanged = function (
      observable,
      listData,
    ) {
      originalEListDataChanged.call(this, observable, listData);
      if (!configuration.enabled || !selectCheapestSettings.enabled) {
        return;
      }
      const cheapest = (function (listItems) {
        if (listItems.length === 0) {
          return;
        }
        let minBuyNow = Number.MAX_VALUE;
        let cheapestIndex = -1;
        let cheapestItem = null;
        for (let index = 0; index < listItems.length; index++) {
          let item = listItems[index];
          const auctionData = item.getAuctionData();
          if (auctionData.buyNowPrice > 0 && auctionData.buyNowPrice < minBuyNow) {
            minBuyNow = auctionData.buyNowPrice;
            cheapestIndex = index;
            cheapestItem = item;
          }
        }
        return -1 === cheapestIndex
          ? null
          : {
              item: cheapestItem,
              index: cheapestIndex,
              minBuyNow: minBuyNow,
            };
      })(listData.items);
      if (cheapest) {
        setBannerMessage(
          translate("plugins.selectCheapest.banner.text")
            .replace("{name}", cheapest.item.getStaticData().name)
            .replace("{minBuyNow}", formatNumber(cheapest.minBuyNow)),
        );
        selectMarketSearchResultAt(cheapest.index);
      }
    };
    const originalGetNavigationTitle =
      UTMarketSearchFiltersViewController.prototype.getNavigationTitle;
    UTMarketSearchFiltersViewController.prototype.getNavigationTitle = function () {
      setBannerMessage("");
      return originalGetNavigationTitle.call(this);
    };
  },
  order: 100,
  settings: {
    name: "select-cheapest",
    title: "plugins.selectCheapest.settings.title",
    menu: function () {
      const menuContainer = document.createElement("div");
      appendToggle(menuContainer, "enabled", selectCheapestSettings.enabled, (isEnabled) => {
        selectCheapestSettings.enabled = isEnabled;
        persistConfiguration();
      });
      return menuContainer;
    },
  },
};

export const selectCheapestPlugin = selectCheapestPluginDefinition;
