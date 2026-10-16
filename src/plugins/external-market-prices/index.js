/**
 * External market prices plugin (`externalMarketPricesPlugin`, order 10, installed by the plugin
 * list in src/bootstrap/boot.js): prices from the active provider of src/market/external-prices
 * on item rows, large items and squad slots, with squad and list totals.
 *
 * Hooks:
 * - In `run()`, `hookPrototypeMethod` after-hooks: `_generate` of UTItemTableCellView,
 *   UTLargePlayerItemView, UTSquadSlotView, UTSquadOverviewView and UTSectionedItemListView;
 *   `setSquad`/`updateSlot` of UTSquadOverviewView and UTSBCSquadOverviewView;
 *   `UTPaginatedItemListView._renderItems`; `UTSectionedItemListView.render`/`setActionHeader`;
 *   `UTStoreRevealModalListView.addItems`; `UTLargePlayerItemView.renderItem`.
 *
 * Invariants:
 * - Stylesheet `paletools-external-market-prices` is injected at module evaluation, only when
 *   Paletools and the plugin are enabled then (not in `run()`); the provider is initialized with
 *   `getGamePlatform()` before hooking.
 * - Needs patches.js first: `addItemValue` (`__externalPrice`, class `external-market-price`) and
 *   `__squadValuesContainer` for the squad totals.
 * - Labels: `extinct`, `objectives.popup.section.title` (without ' %1'), `nav.label.sbc`;
 *   otherwise a price > 0 or hidden; price only on large items in the SBC hub. Squad totals:
 *   slots 0-10 pitch, 11-17 bench, others reserves.
 * - `UTSectionedItemListView.prototype.displayTotalPrices` (false) is opt-in, set by
 *   src/plugins/sbc-auto-solver/preview-view.js: the header title gets a
 *   `.section-list-prices-sum` span, removed by `setActionHeader`.
 *
 * Known issues (kept as-is):
 * - `canAccessExternalHosts()` is async and not awaited; its Promise is truthy, so the hooks are
 *   always installed.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { appendElements, createElement, queryElement } from "../../core/dom.js";
import { canAccessExternalHosts } from "../../core/http.js";
import { hookPrototypeMethod } from "../../core/prototype-override.js";
import { formatNumber, translate } from "../../i18n/translations.js";
import {
  getActivePriceProvider,
  requestExternalPrices,
} from "../../market/external-prices/index.js";
import { ItemValueDisplay } from "../../ui/components/item-value-display.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import { getActiveController } from "../../webapp/navigation.js";
import { getGamePlatform } from "../../webapp/user.js";
import externalMarketPricesCss from "./external-market-prices.css";

let externalMarketPricesPluginDefinition;

const externalMarketPricesSettings = configuration.plugins.externalMarketPrices;

if (configuration.enabled && externalMarketPricesSettings.enabled) {
  upsertStylesheet("paletools-external-market-prices", externalMarketPricesCss);
}

externalMarketPricesPluginDefinition = {
  run: function () {
    function updateSquadPriceTotals(squadView) {
      let totalPrice = 0;
      let pitchPrice = 0;
      let benchPrice = 0;
      let reservePrice = 0;
      for (let slotView of squadView.slotViews) {
        const slotIndex = slotView.getIndex();
        const price = parseInt(slotView.__externalPrice.getValue());
        if (price) {
          totalPrice += price;
          if (slotIndex >= 0 && slotIndex <= 10) {
            pitchPrice += price;
          } else if (slotIndex >= 11 && slotIndex <= 17) {
            benchPrice += price;
          } else {
            reservePrice += price;
          }
        }
      }
      squadView.__externalPriceTotal.setValue(totalPrice);
      squadView.__externalPricePitch.setValue(pitchPrice);
      squadView.__externalPriceBench.setValue(benchPrice);
      squadView.__externalPriceReserve.setValue(reservePrice);
      showElements(squadView.__pricesContainer);
    }
    async function renderExternalPrices(
      getViews,
      getItem,
      onTotalCalculated,
      showPriceOnly = false,
    ) {
      const pricesByDefinitionId = await requestExternalPrices(
        getViews().map((view) => getItem(view)),
      );
      let total = 0;
      for (let view of getViews()) {
        const priceInfo = pricesByDefinitionId[getItem(view).definitionId];
        if (priceInfo) {
          if (priceInfo.isExtinct && !showPriceOnly) {
            view.__externalPrice.setValue(translate("extinct"));
            showElements(view.__externalPrice);
          } else if (priceInfo.isObjective && !showPriceOnly) {
            view.__externalPrice.setValue(
              translate("objectives.popup.section.title").replace(" %1", ""),
            );
            showElements(view.__externalPrice);
          } else if (priceInfo.isSbc && !showPriceOnly) {
            view.__externalPrice.setValue(translate("nav.label.sbc"));
            showElements(view.__externalPrice);
          } else if (priceInfo.price && priceInfo.price > 0) {
            total += priceInfo.price;
            view.__externalPrice.setValue(priceInfo.price);
            showElements(view.__externalPrice);
          } else {
            hideElements(view.__externalPrice);
          }
        } else {
          hideElements(view.__externalPrice);
        }
      }
      if (onTotalCalculated) {
        onTotalCalculated(total);
      }
    }
    if (canAccessExternalHosts()) {
      getActivePriceProvider().init(getGamePlatform());
      hookPrototypeMethod(
        [UTItemTableCellView, UTLargePlayerItemView, UTSquadSlotView],
        "_generate",
        null,
        function () {
          if (configuration.enabled && externalMarketPricesSettings.enabled) {
            this.__externalPrice = this.addItemValue(0, "external-market-price");
            hideElements(this.__externalPrice);
          }
        },
      );
      hookPrototypeMethod(UTSquadOverviewView, "_generate", null, function (...args) {
        if (configuration.enabled && externalMarketPricesSettings.enabled) {
          this.__pricesContainer = createElement("div", {
            className: "item-values-container squad-value squad-price",
          });
          appendElements(this.__squadValuesContainer, this.__pricesContainer);
          this.__externalPricePitch = new ItemValueDisplay(0, "external-market-price pitch");
          this.__externalPricePitch.setCaption(translate("pitch"));
          this.__externalPriceBench = new ItemValueDisplay(0, "external-market-price bench");
          this.__externalPriceBench.setCaption(translate("dock.label.substitutes"));
          this.__externalPriceReserve = new ItemValueDisplay(0, "external-market-price reserve");
          this.__externalPriceReserve.setCaption(translate("dock.label.reserves"));
          this.__externalPriceTotal = new ItemValueDisplay(0, "external-market-price total");
          this.__externalPriceTotal.setCaption(translate("extendedPlayerInfo.total"));
          appendElements(
            this.__pricesContainer,
            this.__externalPricePitch,
            this.__externalPriceBench,
            this.__externalPriceReserve,
            this.__externalPriceTotal,
          );
          hideElements(this.__pricesContainer);
        }
      });
      hookPrototypeMethod(
        [UTSquadOverviewView, UTSBCSquadOverviewView],
        "setSquad",
        null,
        function (...args) {
          if (configuration.enabled && externalMarketPricesSettings.enabled) {
            renderExternalPrices(
              () => this.slotViews,
              (slotView) => args[0].getSlot(slotView.getIndex()).getItem(),
              (total) => {
                updateSquadPriceTotals(this);
              },
            );
          }
        },
      );
      hookPrototypeMethod(
        [UTSquadOverviewView, UTSBCSquadOverviewView],
        "updateSlot",
        null,
        function (...args) {
          if (!configuration.enabled || !externalMarketPricesSettings.enabled) {
            return;
          }
          const slot = args[0];
          if (!slot._isManager) {
            renderExternalPrices(
              () => [this.getSlotByIndex(slot.getIndex())],
              (slotView) => slot.getItem(),
              (total) => {
                updateSquadPriceTotals(this);
              },
            );
          }
        },
      );
      hookPrototypeMethod(
        UTPaginatedItemListView,
        "_renderItems",
        null,
        function (unusedArgument1) {
          if (configuration.enabled && externalMarketPricesSettings.enabled) {
            renderExternalPrices(
              () => this.listRows,
              (row) => row.data,
              (total) => {
                if (this.onPricesTotalUpdated) {
                  this.onPricesTotalUpdated(total);
                }
              },
            );
          }
        },
      );
      hookPrototypeMethod(UTSectionedItemListView, "render", null, function () {
        if (configuration.enabled && externalMarketPricesSettings.enabled) {
          renderExternalPrices(
            () => this.listRows,
            (row) => row.data,
            (total) => {
              if (this.onPricesTotalUpdated) {
                this.onPricesTotalUpdated(total);
              }
            },
          );
        }
      });
      hookPrototypeMethod(UTSectionedItemListView, "_generate", null, function () {
        if (this.displayTotalPrices) {
          this.onPricesTotalUpdated = (total) => {
            if (typeof total !== "number" || total === 0) {
              return;
            }
            const titleElement = queryElement(".ut-section-header-view .title", this);
            if (!titleElement) {
              return;
            }
            let sumElement = queryElement(".section-list-prices-sum", titleElement);
            if (!sumElement) {
              sumElement = createElement("span", {
                className: "section-list-prices-sum currency-coins",
              });
              sumElement.style.marginInlineStart = "8px";
              appendElements(titleElement, sumElement);
            }
            sumElement.textContent = formatNumber(total);
          };
        }
      });
      UTSectionedItemListView.prototype.displayTotalPrices = false;
      hookPrototypeMethod(UTSectionedItemListView, "setActionHeader", null, function () {
        if (this.displayTotalPrices) {
          queryElement(".section-list-prices-sum", this)?.remove();
        }
      });
      hookPrototypeMethod(UTStoreRevealModalListView, "addItems", null, function () {
        if (configuration.enabled && externalMarketPricesSettings.enabled) {
          renderExternalPrices(
            () => this.listRows,
            (row) => row.data,
            (total) => {
              if (this.onPricesTotalUpdated) {
                this.onPricesTotalUpdated(total);
              }
            },
          );
        }
      });
      hookPrototypeMethod(UTLargePlayerItemView, "renderItem", null, function (...args) {
        if (configuration.enabled && externalMarketPricesSettings.enabled) {
          renderExternalPrices(
            () => [this],
            (view) => args[0],
            null,
            getActiveController() instanceof UTSBCHubViewController,
          );
        }
      });
    }
  },
  order: 10,
  settings: {
    name: "external-market-prices",
    title: "plugins.externalMarketPrices.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", externalMarketPricesSettings.enabled, (isEnabled) => {
        externalMarketPricesSettings.enabled = isEnabled;
        persistConfiguration();
      });
      return container;
    },
  },
};

export const externalMarketPricesPlugin = externalMarketPricesPluginDefinition;
