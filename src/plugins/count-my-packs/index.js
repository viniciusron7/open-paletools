/**
 * Count My Packs plugin `countMyPacksPlugin` (order 10), installed by the plugin list in
 * src/bootstrap/boot.js: appends the number of owned packs to the store's My Packs tab label.
 *
 * Hooks:
 * - `UTStoreViewController.prototype.setCategory`, wrapped in `run()` (original first).
 *
 * Invariants:
 * - Returns early when disabled, while `this.packLoadObservable` is pending, when
 *   `viewmodel.hasMyPacks` is false or when no navigation item has id `mypacks`.
 * - Label: `translate("store.group.mypacks") + " (" + myPacks.length + ")"`; APP_DISABLED
 *   restores the plain label and APP_ENABLED re-applies the count.
 *
 * Known issues (kept as-is):
 * - Every qualifying `setCategory` call adds APP_ENABLED/APP_DISABLED listeners that are never
 *   removed.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { translate } from "../../i18n/translations.js";
import { appendToggle } from "../../ui/settings-controls.js";

let countMyPacksPluginDefinition;

const countMyPacksSettings = configuration.plugins.countMyPacks;

countMyPacksPluginDefinition = {
  run: function () {
    const originalSetCategory = UTStoreViewController.prototype.setCategory;
    UTStoreViewController.prototype.setCategory = function (category) {
      originalSetCategory.call(this, category);
      if (!countMyPacksSettings.enabled) {
        return;
      }
      if (this.packLoadObservable) {
        return;
      }
      if (!this.viewmodel.hasMyPacks) {
        return;
      }
      const myPacksNavigationItem = this.getView()._navigation.items.find(
        (navigationItem) => navigationItem.id === "mypacks",
      );
      if (!myPacksNavigationItem) {
        return;
      }
      const myPacksTabElement = myPacksNavigationItem.getRootElement();
      const showMyPacksCount = () =>
        (myPacksTabElement.textContent =
          translate("store.group.mypacks") + " (" + this.viewmodel.myPacks.length + ")");
      showMyPacksCount();
      listenForEvent(paletoolsEvents.APP_DISABLED, () => {
        myPacksTabElement.textContent = translate("store.group.mypacks");
      });
      listenForEvent(paletoolsEvents.APP_ENABLED, () => {
        showMyPacksCount();
      });
    };
  },
  order: 10,
  settings: {
    name: "countMyPacks",
    title: "plugins.countMyPacks.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", countMyPacksSettings.enabled, (enabled) => {
        countMyPacksSettings.enabled = enabled;
        persistConfiguration();
      });
      return container;
    },
  },
};

export const countMyPacksPlugin = countMyPacksPluginDefinition;
