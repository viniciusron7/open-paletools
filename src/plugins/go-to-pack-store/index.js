/**
 * Go to pack store plugin `goToPackStorePlugin` (order 10), installed by the plugin list in
 * src/bootstrap/boot.js: navigation that would show the store hub goes to the pack store
 * (`UTStorePackViewController`) instead.
 *
 * Hooks (installed in `run()`, originals captured once):
 * - `UTNavigationController.prototype.pushViewController`: pushing a `UTStoreHubViewController`
 *   pushes a new, initialized pack store controller instead (the return value is dropped).
 * - `UTNavigationController.prototype.popViewController`: if the pop lands on the store hub, pops
 *   again and pushes the pack store; returns the first pop's result.
 * - `UTTabBarController.prototype._eTabSelected` (original first): when the selected tab's root
 *   is the store hub (`getChildViewControllers(this)[args[2].index]`), pushes the pack store.
 *
 * Known issues (kept as-is):
 * - The pop redirect checks no flag (active even when disabled) and the push redirect ignores
 *   `configuration.enabled`; only the tab hook checks both flags.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { getChildViewControllers } from "../../webapp/navigation.js";

let goToPackStorePluginDefinition;

const goToPackStoreSettings = configuration.plugins.goToPackStore;

goToPackStorePluginDefinition = {
  run: function () {
    const originalPushViewController = UTNavigationController.prototype.pushViewController;
    UTNavigationController.prototype.pushViewController = function (...args) {
      const viewController = args[0];
      if (goToPackStoreSettings.enabled && viewController instanceof UTStoreHubViewController) {
        const storePackController = new UTStorePackViewController();
        storePackController.init();
        return void originalPushViewController.call(this, storePackController);
      }
      originalPushViewController.call(this, ...args);
    };
    const originalPopViewController = UTNavigationController.prototype.popViewController;
    UTNavigationController.prototype.popViewController = function (...args) {
      const popResult = originalPopViewController.call(this, ...args);
      if (this.getCurrentController() instanceof UTStoreHubViewController) {
        originalPopViewController.call(this);
        const storePackController = new UTStorePackViewController();
        storePackController.init();
        originalPushViewController.call(this, storePackController);
        return popResult;
      }
      return popResult;
    };
    const originalETabSelected = UTTabBarController.prototype._eTabSelected;
    UTTabBarController.prototype._eTabSelected = function (...args) {
      originalETabSelected.call(this, ...args);
      if (!goToPackStoreSettings.enabled || !configuration.enabled) {
        return;
      }
      const tabNavigationController = getChildViewControllers(this)[args[2].index];
      if (!(tabNavigationController.getRootController() instanceof UTStoreHubViewController)) {
        return;
      }
      const storePackController = new UTStorePackViewController();
      storePackController.init();
      tabNavigationController.pushViewController(storePackController);
    };
  },
  order: 10,
  settings: {
    name: "goToPackStore",
    title: "plugins.goToPackStore.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", goToPackStoreSettings.enabled, (isEnabled) => {
        goToPackStoreSettings.enabled = isEnabled;
        persistConfiguration();
      });
      return container;
    },
  },
};

export const goToPackStorePlugin = goToPackStorePluginDefinition;
