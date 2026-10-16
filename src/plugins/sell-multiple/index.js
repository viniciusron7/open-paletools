/**
 * Sell Multiple plugin (`sellMultiplePlugin`, order 11), installed by the plugin list in
 * src/bootstrap/boot.js: adds row checkboxes and "list" / "quick sell" header buttons to the
 * transfer list's available section and the watch list's won section, to list (start and buy-now
 * price) or discard up to 25 selected items at once.
 *
 * Hooks (installed in `run()`, after original, only while `plugins.sellMultiple.enabled`):
 * - `UTTransferListView.prototype.renderSection` for
 *   `UTTransferSectionListViewModel.SECTION.AVAILABLE` and
 *   `UTWatchListView.prototype.renderSection` for `UTWatchSectionListViewModel.SECTION.WON`, both
 *   through `sellMultipleAttachSelectionControls`. Other plugins wrap the same transfer-list
 *   method; the header-button order follows the plugin run order.
 *
 * Invariants:
 * - `sellMultipleLastListedAt` (module state shared by all sections) enforces a 60 s cooldown
 *   between bulk listings; it is set in `finally`, even after a failed listing.
 * - Items are listed one by one with `listItemOnTransferMarket(item, buyNow, start)` and a 3-5 s
 *   random pause; start and buy-now must be non-zero integers with start <= buy-now.
 * - Quick sell confirms with `utils.PopupManager` `CONFIRM_DISCARD`/`CONFIRM_DISCARD_ALL` (summed
 *   `discardValue`), then calls `services.Item.discard`.
 * - The listing dialog result is compared with the literal `2` (the OK option); input ids
 *   `sell-multiple-start-price`/`sell-multiple-buy-now-price`, checkbox class
 *   `sell-multiple-checkbox`, stylesheet id `paletools-sell-multiple`.
 * - Enabling requires `confirm(translate("plugins.sellMultiple.warning"))` (default off); the
 *   hooks ignore `configuration.enabled`.
 *
 * Known issues (kept as-is):
 * - `updateSelection` receives the checkbox element instead of `checked`, so unchecking a row
 *   counts as another selection.
 * - The phone swipe handler assigns `checked = checked` (no toggle) and always selects the row.
 * - `APP_ENABLED`/`APP_DISABLED` listeners are added on every section render and only toggle the
 *   list button, not the quick-sell button.
 * - Declining the enable confirmation leaves the settings toggle shown as on.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { waitForDelay } from "../../core/async.js";
import { addClasses, appendElements, queryElement, setStyles } from "../../core/dom.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { formatNumber, translate } from "../../i18n/translations.js";
import { listItemOnTransferMarket } from "../../market/listing.js";
import { showDialog } from "../../ui/dialog.js";
import { showErrorNotification } from "../../ui/notifications.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { SwipeGestureDetector } from "../../ui/swipe-gesture-detector.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import { hideLoadingShield, showLoadingShield } from "../../webapp/loading-shield.js";
import { observableToPromise } from "../../webapp/observable.js";
import sellMultipleCss from "./sell-multiple.css";

let sellMultiplePluginDefinition;

const sellMultipleSettings = configuration.plugins.sellMultiple;

let sellMultipleLastListedAt = null;

function sellMultipleAttachSelectionControls(section) {
  section.selectedCardsCount = 0;
  let selectedItemsById = {};
  const listButton = new UTStandardButtonControl();
  addClasses(listButton.getRootElement(), "sell-multiple", "section-header-btn", "mini", "primary");
  listButton.init();
  listButton.setInteractionState(false);
  listButton.setText(translate("plugins.sellMultiple.button.text"));
  const quickSellButton = new UTStandardButtonControl();
  quickSellButton.init();
  quickSellButton.setInteractionState(false);
  quickSellButton.setText(translate("plugins.sellMultiple.button.quickSellText"));
  setStyles(quickSellButton, {
    marginLeft: "8px",
  });
  addClasses(quickSellButton, "sell-multiple", "section-header-btn", "mini", "primary");
  const checkboxClassName = "sell-multiple-checkbox";
  function updateSelection(isSelected, row) {
    if (isSelected) {
      section.selectedCardsCount++;
      selectedItemsById[row.data.id] = row.data;
    } else {
      section.selectedCardsCount--;
      delete selectedItemsById[row.data.id];
    }
    const hasSelection = Object.keys(selectedItemsById).length > 0;
    listButton.setInteractionState(hasSelection);
    quickSellButton.setInteractionState(hasSelection);
  }
  for (let row of section.listRows) {
    var checkbox = document.createElement("input");
    checkbox.classList.add(checkboxClassName);
    checkbox.type = "checkbox";
    checkbox.addEventListener("change", (event) => {
      if (event.target.checked && section.selectedCardsCount === 25) {
        event.target.checked = false;
        event.stopPropagation();
        showErrorNotification(
          translate("plugins.sellMultiple.notifications.maxPlayersReached").replace(
            "{players}",
            25,
          ),
        );
        return false;
      }
      updateSelection(event.target, row);
      event.stopPropagation();
    });
    appendElements(queryElement(".item", row.getRootElement()), checkbox);
    if (isPhone()) {
      new SwipeGestureDetector(row.getRootElement()).on("SWIPE_LEFT", () => {
        const rowCheckbox = queryElement("." + checkboxClassName, row.getRootElement());
        rowCheckbox.checked = rowCheckbox.checked;
        updateSelection(rowCheckbox, row);
      });
    }
  }
  quickSellButton.addTarget(
    this,
    () => {
      const selectedItems = Object.values(selectedItemsById);
      if (selectedItems.length === 0) {
        return;
      }
      const totalDiscardValue = selectedItems.reduce((total, item) => total + item.discardValue, 0);
      utils.PopupManager.showConfirmation(
        selectedItems.length > 1
          ? utils.PopupManager.Confirmations.CONFIRM_DISCARD_ALL
          : utils.PopupManager.Confirmations.CONFIRM_DISCARD,
        [formatNumber(totalDiscardValue)],
        async () => {
          await observableToPromise(services.Item.discard(selectedItems));
          selectedItemsById = {};
          section.selectedCardsCount = 0;
          listButton.setInteractionState(false);
          quickSellButton.setInteractionState(false);
        },
      );
    },
    EventType.TAP,
  );
  listButton.addTarget(
    this,
    () => {
      if (Object.keys(selectedItemsById).length !== 0) {
        if (sellMultipleLastListedAt) {
          let elapsedMs = new Date() - sellMultipleLastListedAt;
          if (elapsedMs < 60000) {
            return void showErrorNotification(
              translate("plugins.sellMultiple.notifications.wait").replace(
                "{seconds}",
                Math.round((60000 - elapsedMs) / 1000),
              ),
            );
          }
        }
        showDialog(
          [
            {
              labelEnum: enums.UIDialogOptions.OK,
            },
            {
              labelEnum: enums.UIDialogOptions.CANCEL,
            },
          ],
          translate("infopanel.label.listitem"),
          "<label>" +
            translate("auctioninfo.startprice") +
            '</label>\n                <input id="sell-multiple-start-price" type="number" class="ut-text-input-control fut-bin-buy" placeholder="' +
            translate("auctioninfo.startprice") +
            '" />\n                <label>' +
            translate("auctioninfo.buynowprice") +
            '</label>\n                <input id="sell-multiple-buy-now-price" type="number" class="ut-text-input-control fut-bin-buy" placeholder="' +
            translate("auctioninfo.buynowprice") +
            '" />\n            <br/>\n            <br/>\n            <label>' +
            translate("plugins.sellMultiple.label.ignoredCards") +
            "</label>\n            ",
          async (selectedOption) => {
            const startPrice = parseInt(queryElement("#sell-multiple-start-price").value);
            const buyNowPrice = parseInt(queryElement("#sell-multiple-buy-now-price").value);
            if (selectedOption === 2) {
              if (!isNaN(startPrice) && startPrice) {
                if (!isNaN(buyNowPrice) && buyNowPrice) {
                  if (startPrice > buyNowPrice) {
                    showErrorNotification(
                      translate("auctioninfo.startprice") +
                        " > " +
                        translate("auctioninfo.buynowprice"),
                    );
                  } else {
                    showLoadingShield();
                    try {
                      const selectedItemIds = Object.keys(selectedItemsById);
                      for (let itemId of selectedItemIds) {
                        await listItemOnTransferMarket(
                          selectedItemsById[itemId],
                          buyNowPrice,
                          startPrice,
                        );
                        section.selectedCardsCount--;
                        await waitForDelay(3000, 5000);
                        delete selectedItemsById[itemId];
                      }
                      if (section.selectedCardsCount < 0) {
                        section.selectedCardsCount = 0;
                      }
                      selectedItemsById = {};
                    } catch (error) {
                      showErrorNotification(error);
                    } finally {
                      hideLoadingShield();
                      sellMultipleLastListedAt = new Date();
                    }
                  }
                } else {
                  showErrorNotification(
                    translate("auctioninfo.buynowprice") + " - " + translate("invalid"),
                  );
                }
              } else {
                showErrorNotification(
                  translate("auctioninfo.startprice") + " - " + translate("invalid"),
                );
              }
            }
          },
        );
      }
    },
    EventType.TAP,
  );
  section._header.getRootElement().appendChild(listButton.getRootElement());
  section._header.getRootElement().appendChild(quickSellButton.getRootElement());
  listenForEvent(paletoolsEvents.APP_ENABLED, () => showElements(listButton));
  listenForEvent(paletoolsEvents.APP_DISABLED, () => hideElements(listButton));
}

sellMultiplePluginDefinition = {
  run: function () {
    upsertStylesheet("paletools-sell-multiple", sellMultipleCss);
    const originalTransferListRenderSection = UTTransferListView.prototype.renderSection;
    UTTransferListView.prototype.renderSection = function (
      items,
      sectionType,
      renderSectionArgument3,
    ) {
      if (
        sectionType !== UTTransferSectionListViewModel.SECTION.AVAILABLE ||
        !sellMultipleSettings.enabled
      ) {
        return originalTransferListRenderSection.call(
          this,
          items,
          sectionType,
          renderSectionArgument3,
        );
      }
      const sectionView = originalTransferListRenderSection.call(
        this,
        items,
        sectionType,
        renderSectionArgument3,
      );
      sellMultipleAttachSelectionControls(sectionView);
      return sectionView;
    };
    const originalWatchListRenderSection = UTWatchListView.prototype.renderSection;
    UTWatchListView.prototype.renderSection = function (
      items,
      sectionType,
      renderSectionArgument3,
    ) {
      if (
        sectionType !== UTWatchSectionListViewModel.SECTION.WON ||
        !sellMultipleSettings.enabled
      ) {
        return originalWatchListRenderSection.call(
          this,
          items,
          sectionType,
          renderSectionArgument3,
        );
      }
      const sectionView = originalWatchListRenderSection.call(
        this,
        items,
        sectionType,
        renderSectionArgument3,
      );
      sellMultipleAttachSelectionControls(sectionView);
      return sectionView;
    };
  },
  order: 11,
  settings: {
    name: "sell-multiple",
    title: "plugins.sellMultiple.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", sellMultipleSettings.enabled, (isEnabled) => {
        if (isEnabled) {
          if (confirm(translate("plugins.sellMultiple.warning"))) {
            sellMultipleSettings.enabled = isEnabled;
            persistConfiguration();
          }
        } else {
          sellMultipleSettings.enabled = false;
          persistConfiguration();
        }
      });
      return container;
    },
  },
};

export const sellMultiplePlugin = sellMultiplePluginDefinition;
