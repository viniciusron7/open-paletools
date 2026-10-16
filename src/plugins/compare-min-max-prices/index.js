/**
 * Compare-price plugin (`compareMinMaxPricesPlugin`, order 1, installed by the plugin list in
 * src/bootstrap/boot.js): while a compare item is pinned, market results show the min/max buy-now
 * prices seen, can be sorted, and the cheapest row is highlighted.
 *
 * Hooks:
 * - In `run()`, direct overrides: `UTMarketSearchView._generate` and `setItems`,
 *   `UTMarketSearchResultsViewController.setPinnedItem` (sets `view._hasCompareItem`),
 *   `UTItemTableCellView.render` (class `cheapest`).
 *
 * Invariants:
 * - `setItems` acts only with a pinned item; it sorts the incoming array IN PLACE (setting
 *   `order` 'asc'/'desc'; null or 'none' keeps server order) before the original;
 *   min/max/cheapest live on the view and accumulate across pages until it is regenerated; the
 *   cheapest entity gets `isCheapest = true`.
 * - The minimum is written to the shared lowest-price cache (`cacheLowestMarketPrice`).
 * - The `.min-max-prices.paletools-element` container is created only when enabled at `_generate`
 *   (once per view); its appEnabled/appDisabled listeners are never removed. Settings `enabled`,
 *   `order`; stylesheet `paletools-compare-min-max-prices`.
 *
 * Known issues (kept as-is):
 * - It caches a plain number while `findLowestMarketPrices` caches `{ value, count }`; readers
 *   using `.value` (patches.js quick list, lowest-market-price) get undefined.
 * - A view generated while disabled has no `_minPriceText`; enabling afterwards makes `setItems`
 *   with a pinned item and a non-empty result list throw.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { addClasses, appendElements, createElement, insertBefore } from "../../core/dom.js";
import { listenForEvent } from "../../core/events.js";
import { translate } from "../../i18n/translations.js";
import { cacheLowestMarketPrice } from "../../market/lowest-price-cache.js";
import { appendDropdown, appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import compareMinMaxPricesCss from "./compare-min-max-prices.css";

let compareMinMaxPricesPluginDefinition;

const compareMinMaxPricesSettings = configuration.plugins.compareMinMaxPrices;

compareMinMaxPricesPluginDefinition = {
  run: function () {
    const originalGenerate = UTMarketSearchView.prototype._generate;
    UTMarketSearchView.prototype._generate = function () {
      originalGenerate.call(this);
      if (!this._generateCompareMinMaxPrices) {
        if (configuration.enabled && compareMinMaxPricesSettings.enabled) {
          this._minMaxPriceContainer = document.createElement("div");
          this._minPriceText = document.createElement("span");
          this._minPriceText.classList.add("min-price-value");
          this._maxPriceText = document.createElement("span");
          this._maxPriceText.classList.add("max-price-value");
          const minPriceElement = document.createElement("span");
          minPriceElement.classList.add("min-price");
          appendElements(
            minPriceElement,
            createElement(
              "span",
              {
                className: "min-price-label",
              },
              translate("plugins.compareMinMaxPrices.minPriceLabel"),
            ),
            this._minPriceText,
          );
          const maxPriceElement = document.createElement("span");
          maxPriceElement.classList.add("max-price");
          appendElements(
            maxPriceElement,
            createElement(
              "span",
              {
                className: "max-price-label",
              },
              translate("plugins.compareMinMaxPrices.maxPriceLabel"),
            ),
            this._maxPriceText,
          );
          addClasses(this._minMaxPriceContainer, "min-max-prices", "paletools-element");
          hideElements(this._minMaxPriceContainer);
          appendElements(this._minMaxPriceContainer, minPriceElement, maxPriceElement);
          insertBefore(this._minMaxPriceContainer, this._list.getRootElement());
          this._minBuyNowPrice = Number.MAX_VALUE;
          this._maxBuyNowPrice = 0;
          this._cheapestItem = null;
          listenForEvent("appEnabled", () => showElements(this._minMaxPriceContainer));
          listenForEvent("appDisabled", () => hideElements(this._minMaxPriceContainer));
        }
        this._generateCompareMinMaxPrices = true;
      }
    };
    const originalSetPinnedItem = UTMarketSearchResultsViewController.prototype.setPinnedItem;
    UTMarketSearchResultsViewController.prototype.setPinnedItem = function (pinnedItem) {
      originalSetPinnedItem.call(this, pinnedItem);
      this.getView()._hasCompareItem = !!pinnedItem;
    };
    const originalSetItems = UTMarketSearchView.prototype.setItems;
    UTMarketSearchView.prototype.setItems = function (searchResultItems, setItemsArgument2) {
      if (configuration.enabled && compareMinMaxPricesSettings.enabled) {
        if (this._hasCompareItem) {
          let definitionId = null;
          if (searchResultItems.length > 0) {
            if (compareMinMaxPricesSettings.order && compareMinMaxPricesSettings.order !== "none") {
              searchResultItems.sort((left, right) =>
                compareMinMaxPricesSettings.order === "asc"
                  ? left.getAuctionData().buyNowPrice - right.getAuctionData().buyNowPrice
                  : right.getAuctionData().buyNowPrice - left.getAuctionData().buyNowPrice,
              );
            }
            if (!this._cheapestItem) {
              this._cheapestItem = searchResultItems[0];
            }
            for (let item of searchResultItems) {
              const auctionData = item.getAuctionData();
              if (auctionData.buyNowPrice > this._maxBuyNowPrice) {
                this._maxBuyNowPrice = auctionData.buyNowPrice;
              }
              if (auctionData.buyNowPrice <= this._minBuyNowPrice) {
                this._minBuyNowPrice = auctionData.buyNowPrice;
                this._cheapestItem = item;
              }
              definitionId ||= item.definitionId;
            }
            this._minPriceText.textContent = this._minBuyNowPrice;
            this._maxPriceText.textContent = this._maxBuyNowPrice;
            this._cheapestItem.isCheapest = true;
            cacheLowestMarketPrice(definitionId, this._minBuyNowPrice);
            showElements(this._minMaxPriceContainer);
          } else {
            hideElements(this._minMaxPriceContainer);
          }
        } else {
          hideElements(this._minMaxPriceContainer);
        }
      }
      originalSetItems.call(this, searchResultItems, setItemsArgument2);
    };
    const originalRender = UTItemTableCellView.prototype.render;
    UTItemTableCellView.prototype.render = function (item) {
      originalRender.call(this, item);
      if (configuration.enabled && compareMinMaxPricesSettings.enabled && this.data.isCheapest) {
        addClasses(this, "cheapest");
      }
    };
    upsertStylesheet("paletools-compare-min-max-prices", compareMinMaxPricesCss);
  },
  order: 1,
  settings: {
    name: "compare-min-max-prices",
    title: "plugins.compareMinMaxPrices.settings.title",
    menu: function () {
      const menuContainer = document.createElement("div");
      appendToggle(menuContainer, "enabled", compareMinMaxPricesSettings.enabled, (isEnabled) => {
        compareMinMaxPricesSettings.enabled = isEnabled;
        persistConfiguration();
      });
      appendDropdown(
        menuContainer,
        "search.sort.sortBy",
        [
          {
            value: "none",
            label: "",
          },
          {
            value: "asc",
            label: translate("academy.sort.ascending"),
          },
          {
            value: "desc",
            label: translate("academy.sort.descending"),
          },
        ],
        compareMinMaxPricesSettings.order || "none",
        (order) => {
          compareMinMaxPricesSettings.order = order;
          persistConfiguration();
        },
      );
      return menuContainer;
    },
  },
};

export const compareMinMaxPricesPlugin = compareMinMaxPricesPluginDefinition;
