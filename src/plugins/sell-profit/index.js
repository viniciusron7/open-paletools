/**
 * Sell Profit plugin (`sellProfitPlugin`, order 100), installed by the plugin list in
 * src/bootstrap/boot.js: shows the expected profit after the 5 % EA tax in the quick-list panel,
 * and the expected or real profit on selling/sold item table cells.
 *
 * Hooks (installed in `run()`):
 * - `UTQuickListPanelViewController.prototype.setItem` (stores the item on the view BEFORE the
 *   original); `UTQuickListPanelView.prototype.setBuyNowValue` and `_generate` (after original);
 *   defines `UTQuickListPanelView.prototype._setExpectedProfit`.
 * - `UTItemTableCellView.prototype._generate` and `_renderAuctionState` (after original).
 *
 * Invariants:
 * - Profit = round2(sell - 5 % of sell - buy), shown with its percentage of the sell price;
 *   negative values get class `profit-loss`.
 * - The buy price is `item.lastSalePrice`, else the bought transaction from
 *   `paletoolsDatabase.transactions.getBuyByItemId` (the transaction history); it is cached on
 *   the EA item as `lastSalePrice`/`hasBuyInfo`, and other modules also read `lastSalePrice`.
 * - Panel elements are created once per view (`_paletoolsGenerated`) after `__boughtPrice` and
 *   recomputed on toggle tap and buy-now stepper change.
 * - Class `sell-profit` (shown/hidden by `APP_ENABLED`/`APP_DISABLED`), stylesheet id
 *   `paletools-sell-profit`, setting `plugins.sellProfit.enabled`.
 *
 * Known issues (kept as-is):
 * - Neither `_setExpectedProfit` nor `_renderAuctionState` checks that the profit elements exist:
 *   while disabled each `setBuyNowValue` ends in a rejected `renderSellProfit` promise, and cells
 *   generated while disabled throw in `_renderAuctionState` once the plugin is enabled again.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import {
  addClasses,
  appendElements,
  createElement,
  insertAfter,
  queryElements,
  removeClasses,
} from "../../core/dom.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { paletoolsDatabase } from "../../db/database.js";
import { formatNumber, translate } from "../../i18n/translations.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { removeStylesheet, upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import sellProfitCss from "./sell-profit.css";

let sellProfitPluginDefinition;

const sellProfitSettings = configuration.plugins.sellProfit;

function injectSellProfitStyles() {
  upsertStylesheet("paletools-sell-profit", sellProfitCss);
}

sellProfitPluginDefinition = {
  run: function () {
    async function renderSellProfit(profitElement, item, sellPrice) {
      const [profit, profitPercent] = await (function (item, sellPrice) {
        return new Promise((resolve) => {
          const resolveWithBuyPrice = (buyPrice) => {
            if (!sellPrice) {
              const auctionData = item.getAuctionData();
              sellPrice =
                auctionData.isSold() || auctionData.currentBid > 0
                  ? auctionData.currentBid
                  : auctionData.buyNowPrice;
            }
            resolve(
              (function (buyPrice, sellPrice) {
                const netProfit =
                  Math.round(100 * ((grossPrice = sellPrice) - (5 * grossPrice) / 100 - buyPrice)) /
                  100;
                var grossPrice;
                return [netProfit, Math.round((netProfit / sellPrice) * 10000) / 100];
              })(buyPrice, sellPrice),
            );
          };
          if (item.lastSalePrice > 0 || item.hasOwnProperty("hasBuyInfo")) {
            resolveWithBuyPrice(item.lastSalePrice);
          } else {
            paletoolsDatabase.transactions.getBuyByItemId(item.id).then((buyTransaction) => {
              if (buyTransaction && buyTransaction.price) {
                item.hasBuyInfo = true;
                item.lastSalePrice = buyTransaction.price;
                resolveWithBuyPrice(buyTransaction.price);
              } else {
                item.hasBuyInfo = false;
                resolveWithBuyPrice(0);
              }
            });
          }
        });
      })(item, sellPrice);
      profitElement.textContent = formatNumber(profit) + " (" + formatNumber(profitPercent) + "%)";
      if (profit < 0) {
        addClasses(profitElement, "profit-loss");
      } else {
        removeClasses(profitElement, "profit-loss");
      }
      return profit;
    }
    const originalSetItem = UTQuickListPanelViewController.prototype.setItem;
    UTQuickListPanelViewController.prototype.setItem = function (item) {
      this.getView().item = item;
      originalSetItem.call(this, item);
    };
    UTQuickListPanelView.prototype._setExpectedProfit = function () {
      if (!this.item) {
        return;
      }
      let buyNowPrice = parseInt(this._buyNowNumericStepper.getValue());
      renderSellProfit(this.__profitPriceValue, this.item, buyNowPrice);
      showElements(this.__profitPrice);
    };
    const originalSetBuyNowValue = UTQuickListPanelView.prototype.setBuyNowValue;
    UTQuickListPanelView.prototype.setBuyNowValue = function (buyNowPrice) {
      originalSetBuyNowValue.call(this, buyNowPrice);
      this._setExpectedProfit();
    };
    const originalQuickListPanelGenerate = UTQuickListPanelView.prototype._generate;
    UTQuickListPanelView.prototype._generate = function () {
      originalQuickListPanelGenerate.call(this);
      if (configuration.enabled && sellProfitSettings.enabled) {
        if (!this._paletoolsGenerated) {
          this.__profitPrice = createElement("div", {
            className: "boughtPrice panelActionRow sell-profit",
          });
          appendElements(
            this.__profitPrice,
            createElement(
              "span",
              {
                className: "boughtPriceLabel",
              },
              translate("plugins.sellProfit.expectedProfit.text"),
            ),
          );
          this.__profitPriceValue = createElement("span", {
            className: "boughtPriceValue currency-coins sell-profit-value",
          });
          appendElements(this.__profitPrice, this.__profitPriceValue);
          insertAfter(this.__profitPrice, this.__boughtPrice);
          this._btnToggle.addTarget(this, () => this._setExpectedProfit(), EventType.TAP);
          this._buyNowNumericStepper
            .getInput()
            .addTarget(this, () => this._setExpectedProfit(), EventType.CHANGE);
          showElements(this.__profitPrice);
          this._paletoolsGenerated = true;
        }
      }
    };
    const originalItemTableCellGenerate = UTItemTableCellView.prototype._generate;
    UTItemTableCellView.prototype._generate = function () {
      originalItemTableCellGenerate.call(this);
      if (configuration.enabled && sellProfitSettings.enabled) {
        this.__profitContainer = createElement("div", {
          className: "sell-profit auctionValue",
        });
        this.__profitLabelContainer = createElement("span", {
          className: "sell-profit-text label",
        });
        this.__profitValueContainer = createElement("span", {
          className: "sell-profit-value currency-coins value",
        });
        this.profit = 0;
        appendElements(
          this.__profitContainer,
          this.__profitLabelContainer,
          this.__profitValueContainer,
        );
        appendElements(this.__auction, this.__profitContainer);
        hideElements(this.__profitContainer);
      }
    };
    const originalRenderAuctionState = UTItemTableCellView.prototype._renderAuctionState;
    UTItemTableCellView.prototype._renderAuctionState = function () {
      originalRenderAuctionState.call(this);
      if (!configuration.enabled || !sellProfitSettings.enabled) {
        return;
      }
      const auctionData = this.data.getAuctionData();
      if (auctionData && (auctionData.isSold() || auctionData.isSelling())) {
        showElements(this.__profitContainer);
        this.__profitLabelContainer.textContent = auctionData.isSold()
          ? translate("plugins.sellProfit.realProfit.text")
          : translate("plugins.sellProfit.expectedProfit.text");
        renderSellProfit(this.__profitValueContainer, this.data);
      } else {
        hideElements(this.__profitContainer);
      }
    };
    listenForEvent(paletoolsEvents.APP_DISABLED, () => {
      hideElements(queryElements(".sell-profit"));
      removeStylesheet("paletools-sell-profit");
    });
    listenForEvent(paletoolsEvents.APP_ENABLED, () => {
      showElements(queryElements(".sell-profit"));
      injectSellProfitStyles();
    });
    injectSellProfitStyles();
  },
  order: 100,
  settings: {
    name: "sell-profit",
    title: "plugins.sellProfit.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", sellProfitSettings.enabled, (isEnabled) => {
        sellProfitSettings.enabled = isEnabled;
        persistConfiguration();
      });
      return container;
    },
  },
};

export const sellProfitPlugin = sellProfitPluginDefinition;
