/**
 * Player action module for the quick-list panel: percentage buttons (10-30 % over
 * `lastSalePrice`, custom value above 5 %) and a market button using the current lowest price;
 * each sets bid (one step lower) and buy-now, or lists directly with `listForProfitAutoPublish`.
 *
 * Invariants:
 * - Prices go through `roundToValidPrice`, bid = `decreasePriceByOneStep(buy)`; auto-publish
 *   triggers `enums.UIItemActionEvent.LIST_ON_MARKET` with `{ bidAmount, buyAmount, duration }`
 *   from `_durationPicker`.
 * - `inject` wraps `renderView` of the panel prototype to set `_item` and show
 *   `_listForProfitContainer` only when the item has `lastSalePrice`.
 * - Settings listForProfit, listForProfitDisplayPercentageButtons, listForProfitAutoPublish;
 *   buttons stored as `panel._listForProfit<percent>`; per-panel APP_ENABLED/APP_DISABLED
 *   listeners are never removed.
 *
 * Known issues (kept as-is):
 * - The `renderView` wrapper is installed on `UTQuickListPanelView.prototype` (a view) but uses
 *   controller members (`this.item`, `this.getView()`).
 * - `destroyGeneratedElements` destroys only the percentage buttons, not the custom and market
 *   controls.
 */
import { configuration } from "../../config/configuration.js";
import { addClasses, appendElements, createElement } from "../../core/dom.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { translate } from "../../i18n/translations.js";
import { findLowestMarketPrices } from "../../market/lowest-price-search.js";
import { decreasePriceByOneStep, roundToValidPrice } from "../../market/prices.js";
import { hideElements, showElements } from "../../ui/visibility.js";

const listForProfitActionSettings = configuration.plugins.playerActions;

const listForProfitPercentages = [10, 15, 20, 25, 30];

export const listForProfitActionModule = {
  canRun: (panelViewType) => panelViewType === UTQuickListPanelView,
  inject: (panelPrototype) => {
    const originalRenderView = panelPrototype.renderView;
    panelPrototype.renderView = function () {
      originalRenderView.call(this);
      if (listForProfitActionSettings.listForProfit) {
        if (this.item) {
          this.getView()._item = this.item;
          if (this.item.lastSalePrice) {
            showElements(this.getView()._listForProfitContainer);
          } else {
            hideElements(this.getView()._listForProfitContainer);
          }
        } else {
          this.getView()._itemBuyNowPrice = null;
          hideElements(this.getView()._listForProfitContainer);
        }
      }
    };
  },
  generate: (panelView, getActionsContainer) => {
    function applyListPrice(price) {
      if (!price) {
        return;
      }
      const buyAmount = roundToValidPrice(price);
      const bidAmount = decreasePriceByOneStep(buyAmount);
      if (listForProfitActionSettings.listForProfitAutoPublish) {
        panelView._triggerActions(enums.UIItemActionEvent.LIST_ON_MARKET, {
          bidAmount: bidAmount,
          buyAmount: buyAmount,
          duration: parseInt(panelView._durationPicker.value, 10),
        });
      } else {
        panelView.setBidValue(bidAmount);
        panelView.setBuyNowValue(buyAmount);
      }
    }
    function applyProfitPercentage(percentage) {
      const item = panelView.item || panelView._item;
      if (!(!item || !item.lastSalePrice || percentage <= 5)) {
        applyListPrice(item.lastSalePrice * (percentage / 100 + 1));
      }
    }
    if (!listForProfitActionSettings.listForProfit) {
      return;
    }
    const listForProfitContainer = createElement("div", {
      className: "list-for-profit",
    });
    const percentageButtonsContainer = createElement("div", {
      className: "list-for-profit-buttons",
    });
    const customPercentageContainer = createElement("div", {
      className: "list-for-profit-custom",
    });
    const marketPriceContainer = createElement("div", {
      className: "list-for-profit-market",
    });
    if (listForProfitActionSettings.listForProfitDisplayPercentageButtons) {
      for (let percentage of listForProfitPercentages) {
        const percentageButton = new UTStandardButtonControl();
        percentageButton.init();
        percentageButton.setText(percentage + "%");
        percentageButton.addTarget(
          panelView,
          () => applyProfitPercentage(percentage),
          EventType.TAP,
        );
        addClasses(percentageButton, "primary", "mini");
        percentageButton.onListForProfit = new EAObservable();
        panelView["_listForProfit" + percentage] = percentageButton;
        appendElements(percentageButtonsContainer, percentageButton.getRootElement());
      }
      const customPercentageInput = new UTNumberInputControl();
      customPercentageInput.init();
      customPercentageInput.setInputPlaceholder("%");
      const customPercentageButton = new UTStandardButtonControl();
      customPercentageButton.init();
      customPercentageButton.setText(translate("plugins.playerActions.listForProfit.button.set"));
      customPercentageButton.addTarget(
        panelView,
        () => applyProfitPercentage(customPercentageInput.getValue()),
        EventType.TAP,
      );
      addClasses(customPercentageButton, "primary", "mini");
      appendElements(customPercentageContainer, customPercentageInput, customPercentageButton);
      appendElements(listForProfitContainer, percentageButtonsContainer, customPercentageContainer);
    }
    const marketPriceButton = new UTStandardButtonControl();
    marketPriceButton.init();
    marketPriceButton.setText(translate("plugins.playerActions.listForProfit.button.market"));
    marketPriceButton.addTarget(
      panelView,
      async () => {
        marketPriceButton.setInteractionState(false);
        try {
          const item = panelView.item || panelView._item;
          applyListPrice((await findLowestMarketPrices(item.definitionId, item.type, 1)).value);
        } catch {}
        marketPriceButton.setInteractionState(true);
      },
      EventType.TAP,
    );
    addClasses(marketPriceButton, "primary", "mini");
    appendElements(marketPriceContainer, marketPriceButton);
    appendElements(getActionsContainer(panelView), listForProfitContainer, marketPriceContainer);
    listenForEvent(paletoolsEvents.APP_ENABLED, () => showElements(listForProfitContainer));
    listenForEvent(paletoolsEvents.APP_DISABLED, () => hideElements(listForProfitContainer));
    panelView._listForProfitContainer = listForProfitContainer;
  },
  destroyGeneratedElements: (panelView) => {
    for (let percentage of listForProfitPercentages) {
      const percentageButton = panelView["_listForProfit" + percentage];
      if (percentageButton) {
        percentageButton.destroy();
      }
    }
  },
};
