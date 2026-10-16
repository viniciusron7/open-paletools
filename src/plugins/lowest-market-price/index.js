/**
 * Lowest market price plugin (`lowestMarketPricePlugin`, order 11, installed by the plugin list
 * in src/bootstrap/boot.js): a lowest-BIN value on item rows and a 'find lowest market price'
 * button on the transfer list (available section), club search results and pack reveal list.
 *
 * Hooks:
 * - In `run()`, direct overrides, only when Paletools and the plugin are enabled at startup
 *   (otherwise none until reload): `UTItemTableCellView._generate`,
 *   `UTTransferListView.renderSection`, `UTClubSearchResultsView.setItems`,
 *   `UTStoreRevealModalListView.setupFooter` (no enabled re-check).
 *
 * Invariants:
 * - Each cell gets `__lowestMarketPrice` (`addItemValue` from patches.js); every row given to the
 *   button needs it.
 * - The button is rebuilt on each render (`container.findLowestMarketPriceButton`); it searches
 *   once per definitionId with `findLowestMarketPrices(id, type, 1)`, spaced by
 *   `waitForDelay(1000, 2000)`, and stops when a row is hidden.
 * - Cached prices (shared 300 s cache) are shown at render via `.value`. Enabling needs the
 *   `plugins.dangerous` confirmation.
 *
 * Known issues (kept as-is):
 * - The APP_ENABLED/APP_DISABLED listeners call `addStyles()`/`removeStyles()`, declared by no
 *   module; each button build adds two more such listeners.
 * - A definitionId without offers makes `lowestPrice.value` throw; the error notification ends
 *   the remaining lookups.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { waitForDelay } from "../../core/async.js";
import {
  addClasses,
  appendElements,
  createElement,
  isElementHidden,
  removeFromParentNode,
  setStyles,
} from "../../core/dom.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { translate } from "../../i18n/translations.js";
import { getCachedLowestMarketPrice } from "../../market/lowest-price-cache.js";
import { findLowestMarketPrices } from "../../market/lowest-price-search.js";
import { showErrorNotification } from "../../ui/notifications.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import { removeLoadingProgressIndicator } from "../../webapp/loading-shield.js";

let lowestMarketPricePluginDefinition;

const lowestMarketPriceSettings = configuration.plugins.lowestMarketPrice;

function addFindLowestMarketPriceButton(listRows, buttonContainer, buttonStyles) {
  if (buttonContainer.findLowestMarketPriceButton) {
    buttonContainer.findLowestMarketPriceButton.setInteractionState(listRows.length > 0);
    removeFromParentNode(buttonContainer.findLowestMarketPriceButton);
  }
  const findLowestMarketPriceButton = new UTStandardButtonControl();
  if (buttonStyles) {
    setStyles(findLowestMarketPriceButton, buttonStyles);
  }
  addClasses(
    findLowestMarketPriceButton,
    "find-lowest-market-price",
    "section-header-btn",
    "mini",
    "primary",
  );
  findLowestMarketPriceButton.init();
  findLowestMarketPriceButton.setInteractionState(false);
  findLowestMarketPriceButton.setText(translate("plugins.lowestMarketPrice.button.text"));
  findLowestMarketPriceButton.setInteractionState(listRows.length > 0);
  findLowestMarketPriceButton.addTarget(
    this,
    async () => {
      const rowsByDefinitionId = {};
      for (let row of listRows) {
        const item = row.data;
        if (!rowsByDefinitionId[item.definitionId]) {
          rowsByDefinitionId[item.definitionId] = [];
        }
        rowsByDefinitionId[item.definitionId].push(row);
      }
      let hasHiddenRow = false;
      for (let definitionId in rowsByDefinitionId) {
        for (let row of rowsByDefinitionId[definitionId]) {
          if (isElementHidden(row)) {
            hasHiddenRow = true;
            break;
          }
          appendElements(
            row,
            createElement("div", {
              className: "loading-progress",
            }),
          );
        }
        if (hasHiddenRow) {
          break;
        }
        try {
          const lowestPrice = await findLowestMarketPrices(
            definitionId,
            rowsByDefinitionId[definitionId][0].data.type,
            1,
          );
          for (let row of rowsByDefinitionId[definitionId]) {
            row.__lowestMarketPrice.setValue(lowestPrice.value);
            showElements(row.__lowestMarketPrice);
            removeLoadingProgressIndicator(row);
          }
          await waitForDelay(1000, 2000);
        } catch (error) {
          return void showErrorNotification(error);
        }
      }
    },
    EventType.TAP,
  );
  appendElements(buttonContainer, findLowestMarketPriceButton);
  buttonContainer.findLowestMarketPriceButton = findLowestMarketPriceButton;
  listenForEvent(paletoolsEvents.APP_ENABLED, () => {
    addStyles();
    showElements(findLowestMarketPriceButton);
  });
  listenForEvent(paletoolsEvents.APP_DISABLED, () => {
    removeStyles();
    hideElements(findLowestMarketPriceButton);
  });
}

function showCachedLowestMarketPrices(listRows) {
  for (let row of listRows) {
    const cachedPrice = getCachedLowestMarketPrice(row.data.definitionId);
    if (cachedPrice) {
      row.__lowestMarketPrice.setValue(cachedPrice.value);
      showElements(row.__lowestMarketPrice);
      removeLoadingProgressIndicator(row);
    }
  }
}

lowestMarketPricePluginDefinition = {
  run: function () {
    if (!configuration.enabled || !lowestMarketPriceSettings.enabled) {
      return;
    }
    const originalGenerate = UTItemTableCellView.prototype._generate;
    UTItemTableCellView.prototype._generate = function () {
      originalGenerate.call(this);
      if (configuration.enabled && lowestMarketPriceSettings.enabled) {
        this.__lowestMarketPrice = this.addItemValue(0, "lowest-market-price-container");
        hideElements(this.__lowestMarketPrice);
        listenForEvent(paletoolsEvents.APP_DISABLED, () => hideElements(this.__lowestMarketPrice));
        listenForEvent(paletoolsEvents.APP_ENABLED, () => showElements(this.__lowestMarketPrice));
      }
    };
    const originalRenderSection = UTTransferListView.prototype.renderSection;
    UTTransferListView.prototype.renderSection = function (
      sectionItems,
      section,
      renderSectionArgument3,
    ) {
      if (
        section !== UTTransferSectionListViewModel.SECTION.AVAILABLE ||
        !configuration.enabled ||
        !lowestMarketPriceSettings.enabled
      ) {
        return originalRenderSection.call(this, sectionItems, section, renderSectionArgument3);
      }
      const sectionView = originalRenderSection.call(
        this,
        sectionItems,
        section,
        renderSectionArgument3,
      );
      addFindLowestMarketPriceButton(sectionView.listRows, sectionView._header);
      showCachedLowestMarketPrices(sectionView.listRows);
      return sectionView;
    };
    const originalSetItems = UTClubSearchResultsView.prototype.setItems;
    UTClubSearchResultsView.prototype.setItems = function (...args) {
      originalSetItems.call(this, ...args);
      if (configuration.enabled && lowestMarketPriceSettings.enabled && this.header) {
        addFindLowestMarketPriceButton(this._list.listRows, this.header);
        showCachedLowestMarketPrices(this._list.listRows);
      }
    };
    const originalSetupFooter = UTStoreRevealModalListView.prototype.setupFooter;
    UTStoreRevealModalListView.prototype.setupFooter = function (...args) {
      originalSetupFooter.call(this, ...args);
      addFindLowestMarketPriceButton(this.listRows, this.__actionContainer);
      showCachedLowestMarketPrices(this.listRows);
    };
  },
  order: 11,
  settings: {
    name: "lowest-market-price",
    title: "plugins.lowestMarketPrice.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", lowestMarketPriceSettings.enabled, (isEnabled) => {
        if (isEnabled) {
          if (confirm(translate("plugins.dangerous"))) {
            lowestMarketPriceSettings.enabled = isEnabled;
            persistConfiguration();
          }
        } else {
          lowestMarketPriceSettings.enabled = false;
          persistConfiguration();
        }
      });
      return container;
    },
  },
};

export const lowestMarketPricePlugin = lowestMarketPricePluginDefinition;
