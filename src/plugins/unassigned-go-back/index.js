/**
 * Unassigned Go Back plugin (`unassignedGoBackPlugin`, order 100), installed by the plugin list in
 * src/bootstrap/boot.js: when the unassigned items list is empty, navigates back instead of
 * rendering it.
 *
 * Hooks (installed in `run()`):
 * - `UTItemDetailsViewController.prototype.onRedeem` (before original): redeeming a player-pick
 *   item clears `isAutoGoBackAllowed`, so the next empty render stays on the page.
 * - `UTUnassignedItemsViewController.prototype.renderView`: calls `navigateBack()` instead of the
 *   original when enabled, `this.viewmodel.length === 0` and going back is allowed; otherwise
 *   re-arms the flag and renders.
 *
 * Invariants:
 * - `isAutoGoBackAllowed` is closure state of `run()`, shared by all controllers.
 * - Setting `plugins.unassignedGoBack.enabled` (default off); `configuration.enabled` is not
 *   checked.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { navigateBack } from "../../webapp/navigation.js";

let unassignedGoBackPluginDefinition;

const unassignedGoBackSettings = configuration.plugins.unassignedGoBack;

unassignedGoBackPluginDefinition = {
  run: function () {
    let isAutoGoBackAllowed = true;
    const originalOnRedeem = UTItemDetailsViewController.prototype.onRedeem;
    UTItemDetailsViewController.prototype.onRedeem = function (...args) {
      if (
        this.viewmodel &&
        this.viewmodel.current() &&
        this.viewmodel.current().isPlayerPickItem()
      ) {
        isAutoGoBackAllowed = false;
      }
      originalOnRedeem.call(this, ...args);
    };
    const originalRenderView = UTUnassignedItemsViewController.prototype.renderView;
    UTUnassignedItemsViewController.prototype.renderView = function (...args) {
      if (
        unassignedGoBackSettings.enabled &&
        this.viewmodel &&
        this.viewmodel.length === 0 &&
        isAutoGoBackAllowed
      ) {
        navigateBack();
      } else {
        isAutoGoBackAllowed = true;
        originalRenderView.call(this, ...args);
      }
    };
  },
  order: 100,
  settings: {
    name: "unassigned-goback",
    title: "plugins.unassignedGoBack.settings.title",
    menu: function () {
      const menuContainer = document.createElement("div");
      appendToggle(menuContainer, "enabled", unassignedGoBackSettings.enabled, (isEnabled) => {
        unassignedGoBackSettings.enabled = isEnabled;
        persistConfiguration();
      });
      return menuContainer;
    },
  },
};

export const unassignedGoBackPlugin = unassignedGoBackPluginDefinition;
