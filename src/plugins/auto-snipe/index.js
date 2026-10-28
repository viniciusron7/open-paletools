/**
 * Auto Snipe plugin (`autoSnipePlugin`, order 10003, settings `autoSnipe`, added in 27.2.1;
 * installed by the plugin list in src/bootstrap/boot.js): an "Auto Snipe" tile on the Transfers
 * hub that opens the Auto Snipe screen (src/plugins/auto-snipe/controller.js), which repeatedly
 * searches the transfer market and buys matching offers. It makes real purchases.
 *
 * Hooks (`hookPrototypeMethod`): `UTTransfersHubView._generate` (after) and
 * `destroyGeneratedElements` (before).
 *
 * Invariants:
 * - The tile (`_paletoolsAutoSnipeTile`, a `UTGraphicalInfoTileView` with classes `col-1-2` and
 *   `ut-tile-auto-snipe`) is created after the Transfer Targets tile the first time the hub is
 *   generated with Paletools and Auto Snipe enabled, shown while both are enabled and hidden
 *   otherwise; `destroyGeneratedElements` removes its target and destroys it.
 * - Tapping it pushes a new `AutoSnipeViewController` on the active navigation controller, only
 *   while Paletools and Auto Snipe are enabled.
 * - Settings: one `enabled` toggle. Switching it on asks `plugins.dangerous` and is saved only if
 *   confirmed (the toggle stays on even if it is not); switching it off saves and stops the
 *   running Auto Snipe.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { addClasses, insertAfter } from "../../core/dom.js";
import { hookPrototypeMethod } from "../../core/prototype-override.js";
import { translate } from "../../i18n/translations.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import { getActiveNavigationController } from "../../webapp/navigation.js";
import { activeAutoSnipeRunner, AutoSnipeViewController } from "./controller.js";

let autoSnipePluginDefinition;

const autoSnipeSettings = configuration.plugins.autoSnipe;

function openAutoSnipe() {
  if (!configuration.enabled || !configuration.plugins.autoSnipe.enabled) {
    return;
  }
  const controller = new AutoSnipeViewController();
  controller.init();
  getActiveNavigationController().pushViewController(controller);
}

autoSnipePluginDefinition = {
  run: function () {
    hookPrototypeMethod(UTTransfersHubView, "_generate", null, function () {
      if (configuration.enabled && autoSnipeSettings.enabled) {
        if (!this._paletoolsAutoSnipeTile) {
          const autoSnipeTile = new UTGraphicalInfoTileView();
          autoSnipeTile.init();
          autoSnipeTile.title = translate("plugins.autoSnipe.settings.title");
          autoSnipeTile.addTarget(this, openAutoSnipe, EventType.TAP);
          addClasses(autoSnipeTile, "col-1-2", "ut-tile-auto-snipe");
          insertAfter(autoSnipeTile, this._transferTargetsTile);
          this._paletoolsAutoSnipeTile = autoSnipeTile;
        }
        showElements(this._paletoolsAutoSnipeTile);
      } else if (this._paletoolsAutoSnipeTile) {
        hideElements(this._paletoolsAutoSnipeTile);
      }
    });
    hookPrototypeMethod(UTTransfersHubView, "destroyGeneratedElements", function () {
      const autoSnipeTile = this._paletoolsAutoSnipeTile;
      if (autoSnipeTile) {
        autoSnipeTile.removeTarget(this, openAutoSnipe, EventType.TAP);
        autoSnipeTile.destroy();
        this._paletoolsAutoSnipeTile = null;
      }
    });
  },
  order: 10003,
  settings: {
    name: "autoSnipe",
    title: "plugins.autoSnipe.settings.title",
    menu: function () {
      const menuContainer = document.createElement("div");
      appendToggle(menuContainer, "enabled", autoSnipeSettings.enabled, (isEnabled) => {
        if (isEnabled) {
          if (confirm(translate("plugins.dangerous"))) {
            autoSnipeSettings.enabled = true;
            persistConfiguration();
          }
        } else {
          autoSnipeSettings.enabled = false;
          persistConfiguration();
        }
        if (!isEnabled) {
          activeAutoSnipeRunner?.stop();
        }
      });
      return menuContainer;
    },
  },
};

export const autoSnipePlugin = autoSnipePluginDefinition;
