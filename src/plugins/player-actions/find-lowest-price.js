/**
 * Player action module (default, slot and auction panels): a 'find lowest price' button and the
 * `findLowestPrice` shortcut; runs `findLowestMarketPrices` for the current item and lists 'price
 * xcount' in the button subtext.
 *
 * Invariants:
 * - Shortcut `findLowestPrice` (key in
 *   `configuration.plugins.snipe.buttons.customActions.findLowestPrice`, hint
 *   `.find-lowest-price > .btn-text`) acts through `panel._onFindLowestPrice`; one search at a
 *   time per panel.
 * - Progress uses the page-window events `findLowestPriceAction:searchstart` and
 *   `findLowestPriceAction:searchend` (detail: price list or 'ERROR'); every generated panel
 *   listens, so all buttons show the latest search; listeners are never removed (guarded by
 *   `runIgnoringErrors`).
 * - `configuration.plugins.playerActions;` at the top is a no-op kept in place.
 *
 * Known issues (kept as-is):
 * - The not-found text is unreachable: with 3 results `findLowestMarketPrices` always returns an
 *   array, so no offers render an empty list.
 */
import { configuration } from "../../config/configuration.js";
import { appendElements } from "../../core/dom.js";
import { dispatchPaletoolsEvent, listenForEvent } from "../../core/events.js";
import { translate } from "../../i18n/translations.js";
import { findLowestMarketPrices } from "../../market/lowest-price-search.js";
import { getCurrentItemDetailsPanelView, runIgnoringErrors } from "./helpers.js";
import { registerKeyboardShortcut } from "../../ui/keyboard-shortcuts.js";

configuration.plugins.playerActions;

const findLowestPriceActionSettings = configuration.plugins.playerActions;

export const findLowestPriceActionModule = {
  canRun: (panelViewType) =>
    panelViewType === UTDefaultActionPanelView ||
    panelViewType === UTSlotActionPanelView ||
    panelViewType === UTAuctionActionPanelView,
  inject: (panelPrototype) => {
    registerKeyboardShortcut(
      "findLowestPrice",
      () => configuration.plugins.snipe.buttons.customActions.findLowestPrice,
      (findLowestPrice) =>
        (configuration.plugins.snipe.buttons.customActions.findLowestPrice = findLowestPrice),
      "plugins.playerActions.findLowestPrice.button",
      () => {
        const panelView = getCurrentItemDetailsPanelView();
        if (panelView && panelView._onFindLowestPrice) {
          panelView._onFindLowestPrice();
        }
      },
      ".find-lowest-price > .btn-text",
    );
  },
  generate: (panelView, getActionsContainer) => {
    if (!findLowestPriceActionSettings.findLowestPrice) {
      return;
    }
    let isSearching = false;
    panelView._onFindLowestPrice = async function () {
      if (!isSearching) {
        isSearching = true;
        dispatchPaletoolsEvent("findLowestPriceAction:searchstart");
        try {
          const item = this._currentItem;
          dispatchPaletoolsEvent(
            "findLowestPriceAction:searchend",
            (await findLowestMarketPrices(item.definitionId, item.type)) ||
              translate("plugins.playerActions.findLowestPrice.notFound"),
          );
        } catch {
          dispatchPaletoolsEvent("findLowestPriceAction:searchend", "ERROR");
        }
        isSearching = false;
      }
    };
    panelView._findLowestPriceButton = new UTGroupButtonControl();
    panelView._findLowestPriceButton.init();
    panelView._findLowestPriceButton.setText(
      translate("plugins.playerActions.findLowestPrice.button"),
    );
    panelView._findLowestPriceButton.addTarget(
      panelView,
      () => {
        panelView._onFindLowestPrice();
      },
      EventType.TAP,
    );
    panelView._findLowestPriceButton
      .getRootElement()
      .classList.add("paletools-element", "find-lowest-price");
    panelView._findLowestPriceButton.displayCurrencyIcon();
    appendElements(
      getActionsContainer(panelView),
      panelView._findLowestPriceButton.getRootElement(),
    );
    listenForEvent("findLowestPriceAction:searchstart", () => {
      runIgnoringErrors(() => {
        panelView._findLowestPriceButton.setText(
          translate("plugins.playerActions.findLowestPrice.searching"),
        );
        panelView._findLowestPriceButton.setSubtext("");
      });
    });
    listenForEvent("findLowestPriceAction:searchend", (event) => {
      runIgnoringErrors(() => {
        panelView._findLowestPriceButton.setText(
          translate("plugins.playerActions.findLowestPrice.button"),
        );
        if (event.detail === "ERROR") {
          panelView._findLowestPriceButton.setSubtext("ERROR");
        } else {
          let pricesHtml = "<ol>";
          for (let priceEntry of event.detail) {
            pricesHtml += "<li>" + priceEntry.value + " x" + priceEntry.count + "</li>";
          }
          pricesHtml += "</ol>";
          panelView._findLowestPriceButton.__subtext.innerHTML = pricesHtml;
        }
      });
    });
  },
  destroyGeneratedElements: (panelView) => {
    if (panelView._findLowestPriceButton) {
      panelView._findLowestPriceButton.destroy();
    }
  },
};
