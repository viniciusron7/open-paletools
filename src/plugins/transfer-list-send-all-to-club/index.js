/**
 * Transfer List Send All To Club plugin (`transferListSendAllToClubPlugin`, order 11), installed
 * by the plugin list in src/bootstrap/boot.js: adds a "send all to club" button to transfer list
 * section headers.
 *
 * Hooks:
 * - `run()` wraps `UTTransferListView.prototype.renderSection` (after original): for every
 *   section with items whose `duplicateId === 0` and trade state is not
 *   `AuctionTradeStateEnum.ACTIVE`, appends the button to `sectionView._header`. Other plugins
 *   wrap the same method; the header-button order follows the plugin run order.
 *
 * Invariants:
 * - The button moves the items captured at render time with
 *   `services.Item.move(items, ItemPile.CLUB)` and then calls `refreshList()` on the active
 *   `UTTransferListViewController` (or the left controller of the split view), whatever the
 *   response.
 * - The button is always created and only hidden while
 *   `plugins.transferListSendAllToClub.enabled` is off; the settings name
 *   `transer-list-send-all-to-club` (misspelled) is part of the settings DOM ids.
 *
 * Known issues (kept as-is):
 * - `APP_ENABLED` shows the button even when the plugin is disabled, and the
 *   `APP_ENABLED`/`APP_DISABLED` listeners are added again on every section render.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { addClasses } from "../../core/dom.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { translate } from "../../i18n/translations.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import { getActiveController, getLeftController } from "../../webapp/navigation.js";

let transferListSendAllToClubPluginDefinition;

const transferListSendAllToClubSettings = configuration.plugins.transferListSendAllToClub;

transferListSendAllToClubPluginDefinition = {
  run: function () {
    const originalRenderSection = UTTransferListView.prototype.renderSection;
    UTTransferListView.prototype.renderSection = function (
      sectionItems,
      sectionType,
      renderSectionArgument3,
    ) {
      const sectionView = originalRenderSection.call(
        this,
        sectionItems,
        sectionType,
        renderSectionArgument3,
      );
      const sendableItems = sectionItems.filter(
        (item) =>
          item.duplicateId === 0 &&
          item.getAuctionData()._tradeState !== AuctionTradeStateEnum.ACTIVE,
      );
      if (sendableItems.length > 0) {
        const sendAllButton = new UTStandardButtonControl();
        sendAllButton.getRootElement().style.marginLeft = "8px";
        addClasses(sendAllButton, "send-all-to-club", "section-header-btn", "mini", "primary");
        sendAllButton.init();
        sendAllButton.setText(translate("plugins.transferListSendAllToClub.button.text"));
        sendAllButton.addTarget(
          this,
          () => {
            const currentController = getActiveController();
            services.Item.move(sendableItems, ItemPile.CLUB).observe(
              this,
              (observable, response) => {
                if (currentController instanceof UTTransferListViewController) {
                  currentController.refreshList();
                } else {
                  getLeftController(currentController).refreshList();
                }
              },
            );
          },
          EventType.TAP,
        );
        sectionView._header.getRootElement().appendChild(sendAllButton.getRootElement());
        listenForEvent(paletoolsEvents.APP_ENABLED, () => showElements(sendAllButton));
        listenForEvent(paletoolsEvents.APP_DISABLED, () => hideElements(sendAllButton));
        if (!transferListSendAllToClubSettings.enabled) {
          hideElements(sendAllButton);
        }
      }
      return sectionView;
    };
  },
  order: 11,
  settings: {
    name: "transer-list-send-all-to-club",
    title: "plugins.transferListSendAllToClub.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", transferListSendAllToClubSettings.enabled, (enabled) => {
        transferListSendAllToClubSettings.enabled = enabled;
        persistConfiguration();
      });
      return container;
    },
  },
};

export const transferListSendAllToClubPlugin = transferListSendAllToClubPluginDefinition;
