/**
 * Unassigned Organize plugin (`unassignedOrganizePlugin`, order 3), installed by the plugin list
 * in src/bootstrap/boot.js: an "organize" button on the unassigned items view runs a step
 * machine: untradeable duplicates to the club (`SWAP_DUPLICATES`), movable items to the club,
 * storables and tradeable duplicates to the transfer list, untradeable duplicates to SBC storage.
 *
 * Hooks (installed in `run()`):
 * - `UTUnassignedItemsView.prototype.renderSection` (after original): prepends a new organize
 *   button on each call when there are sections and, on desktop, `displayButton` is on.
 * - `UTUnassignedItemsViewController.prototype.onMoveToClubComplete` /
 *   `onMoveToTransferListComplete` (after original): call `next()` while `this.organizing`.
 * - Defines (overwrites) `UTUnassignedItemsViewController.prototype.organize`, `next`,
 *   `sendStorablesToTransferListWithoutConfirmation` and
 *   `sendDuplicatesToTransferListWithoutConfirmation`.
 *
 * Invariants:
 * - `unassignedOrganizeSteps` values 0-4 are kept in `this.currentOrganizationStep`; each step
 *   either starts a move whose completion callback calls `next()`, or calls `next()` directly.
 *   Only the last step (or an error, swallowed by `catch {}`) clears `organizing`, waits
 *   50-150 ms and calls `this.getUnassignedItems()`.
 * - Transfer-list steps skip (`next()`) when `getPileSize(ItemPile.TRANSFER)` cannot hold the
 *   items plus the current transfer list; otherwise they disable the view and track a
 *   `TelemetryManager` button-press event before moving.
 * - `organize()` requires `plugins.unassignedOrganize.enabled` and a non-empty view model; the
 *   button is shown regardless. Settings `enabled` and `displayButton`.
 *
 * Known issues (kept as-is):
 * - The storables step checks for tradeable non-duplicate items but moves the whole
 *   `getRegularItemsSection()`.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { waitForDelay } from "../../core/async.js";
import { addClasses, prependElements, setStyles } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { fetchTransferListItems, moveItemsToSbcStorage } from "../../webapp/item-piles.js";
import { getActiveController } from "../../webapp/navigation.js";

let unassignedOrganizePluginDefinition;

const unassignedOrganizeSettings = configuration.plugins.unassignedOrganize;

const unassignedOrganizeSteps = Object.freeze({
  SWAP_DUPLICATES: 0,
  SEND_TO_CLUB: 1,
  STORABLES_TO_TL: 2,
  DUPLICATES_TO_TL: 3,
  SBC_STORAGE: 4,
});

unassignedOrganizePluginDefinition = {
  run: function () {
    const originalRenderSection = UTUnassignedItemsView.prototype.renderSection;
    UTUnassignedItemsView.prototype.renderSection = function (...args) {
      const renderResult = originalRenderSection.call(this, ...args);
      if (this.sections.length === 0) {
        return renderResult;
      }
      if (!isPhone() && !unassignedOrganizeSettings.displayButton) {
        return renderResult;
      }
      const organizeButton = new UTStandardButtonControl();
      organizeButton.init();
      organizeButton.setText(translate("plugins.unassignedOrganize.settings.title"));
      prependElements(this, organizeButton);
      addClasses(organizeButton, "primary", "mini");
      setStyles(organizeButton, {
        marginLeft: "auto",
        marginBottom: "2px",
      });
      organizeButton.addTarget(
        this,
        () => {
          let controller = getActiveController();
          if (controller && controller instanceof UTUnassignedItemsSplitViewController) {
            controller = controller.listViewController;
          }
          if (controller && controller instanceof UTUnassignedItemsViewController) {
            controller.organize();
          }
        },
        EventType.TAP,
      );
      return renderResult;
    };
    UTUnassignedItemsViewController.prototype.next = function () {
      if (this.currentOrganizationStep === unassignedOrganizeSteps.SWAP_DUPLICATES) {
        this.organize(unassignedOrganizeSteps.SEND_TO_CLUB);
      } else if (this.currentOrganizationStep === unassignedOrganizeSteps.SEND_TO_CLUB) {
        this.organize(unassignedOrganizeSteps.STORABLES_TO_TL);
      } else if (this.currentOrganizationStep === unassignedOrganizeSteps.STORABLES_TO_TL) {
        this.organize(unassignedOrganizeSteps.DUPLICATES_TO_TL);
      } else if (this.currentOrganizationStep === unassignedOrganizeSteps.DUPLICATES_TO_TL) {
        this.organize(unassignedOrganizeSteps.SBC_STORAGE);
      }
    };
    const originalOnMoveToClubComplete =
      UTUnassignedItemsViewController.prototype.onMoveToClubComplete;
    UTUnassignedItemsViewController.prototype.onMoveToClubComplete = function (...args) {
      originalOnMoveToClubComplete.call(this, ...args);
      if (this.organizing) {
        this.next();
      }
    };
    const originalOnMoveToTransferListComplete =
      UTUnassignedItemsViewController.prototype.onMoveToTransferListComplete;
    async function sendItemsToTransferListWithoutConfirmation(controller, items, telemetryLabel) {
      if (controller.viewmodel) {
        const transferListItems = await fetchTransferListItems();
        if (
          repositories.Item.getPileSize(ItemPile.TRANSFER) <
          items.length + transferListItems.length
        ) {
          return void controller.next();
        }
        TelemetryManager.trackEvent(
          TelemetryManager.Sections.MISC,
          TelemetryManager.Categories.BUTTON_PRESS,
          "Unassigned - Send " + telemetryLabel + " To Transfer List",
        );
        controller.getView().setInteractionState(false);
        services.Item.move(items, ItemPile.TRANSFER).observe(
          controller,
          controller.onMoveToTransferListComplete,
        );
      }
    }
    UTUnassignedItemsViewController.prototype.onMoveToTransferListComplete = function (...args) {
      originalOnMoveToTransferListComplete.call(this, ...args);
      if (this.organizing) {
        this.next();
      }
    };
    UTUnassignedItemsViewController.prototype.sendStorablesToTransferListWithoutConfirmation =
      function () {
        sendItemsToTransferListWithoutConfirmation(
          this,
          this.viewmodel.getRegularItemsSection(),
          "Storables",
        );
      };
    UTUnassignedItemsViewController.prototype.sendDuplicatesToTransferListWithoutConfirmation =
      function () {
        sendItemsToTransferListWithoutConfirmation(
          this,
          this.viewmodel.getTradeableDuplicates(),
          "Duplicates",
        );
      };
    UTUnassignedItemsViewController.prototype.organize = async function (step) {
      if (unassignedOrganizeSettings.enabled && this.viewmodel && this.viewmodel.length !== 0) {
        this.organizing = true;
        this.currentOrganizationStep = step || unassignedOrganizeSteps.SWAP_DUPLICATES;
        try {
          switch (this.currentOrganizationStep) {
            case unassignedOrganizeSteps.SWAP_DUPLICATES:
              const untradeableDuplicates = this.viewmodel.getUntradeableDuplicates();
              return void (untradeableDuplicates.length > 0
                ? services.Item.move(untradeableDuplicates, ItemPile.CLUB, true).observe(
                    this,
                    this.onMoveToClubComplete,
                  )
                : this.next());
            case unassignedOrganizeSteps.SEND_TO_CLUB:
              return void (this.viewmodel.getMovableItems().length > 0
                ? this.storeInClub()
                : this.next());
            case unassignedOrganizeSteps.STORABLES_TO_TL:
              return void (this.viewmodel
                .getRegularItemsSection()
                .filter((item) => item.isTradeable() && !item.isDuplicate()).length > 0
                ? this.sendStorablesToTransferListWithoutConfirmation()
                : this.next());
            case unassignedOrganizeSteps.DUPLICATES_TO_TL:
              return void (this.viewmodel.getTradeableDuplicates().length > 0
                ? this.sendDuplicatesToTransferListWithoutConfirmation()
                : this.next());
            case unassignedOrganizeSteps.SBC_STORAGE:
              const entities = this.viewmodel.getDiscardableInfo().untradeableDuplicates.entities;
              if (entities.length > 0) {
                await moveItemsToSbcStorage(entities);
              }
          }
        } catch {}
        this.organizing = false;
        this.currentOrganizationStep = null;
        await waitForDelay(50, 150);
        this.getUnassignedItems();
      }
    };
  },
  order: 3,
  settings: {
    name: "unassigned-organize",
    title: "plugins.unassignedOrganize.settings.title",
    menu: function () {
      const menuContainer = document.createElement("div");
      appendToggle(menuContainer, "enabled", unassignedOrganizeSettings.enabled, (isEnabled) => {
        unassignedOrganizeSettings.enabled = isEnabled;
        persistConfiguration();
      });
      appendToggle(
        menuContainer,
        "plugins.unassignedOrganize.settings.displayButton",
        unassignedOrganizeSettings.displayButton,
        (displayButton) => {
          unassignedOrganizeSettings.displayButton = displayButton;
          persistConfiguration();
        },
      );
      return menuContainer;
    },
  },
};

export const unassignedOrganizePlugin = unassignedOrganizePluginDefinition;
