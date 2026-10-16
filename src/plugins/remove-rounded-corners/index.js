/**
 * Remove Rounded Corners plugin (`removeRoundedCornersPlugin`, order 3), installed by the plugin
 * list in src/bootstrap/boot.js: injects a stylesheet (remove-rounded-corners.css) that removes
 * the Web App's rounded corners. Installs no hooks.
 *
 * Invariants:
 * - Stylesheet id `paletools-remove-corners`: injected in `run()` when enabled, and added or
 *   removed immediately by the settings toggle (`plugins.removeRoundedCorners.enabled`, default
 *   on).
 * - Independent of the global `configuration.enabled` (no `APP_ENABLED`/`APP_DISABLED`
 *   handling).
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { removeStylesheet, upsertStylesheet } from "../../ui/stylesheets.js";
import removeRoundedCornersStyles from "./remove-rounded-corners.css";

let removeRoundedCornersPluginDefinition;

const removeRoundedCornersSettings = configuration.plugins.removeRoundedCorners;

const removeRoundedCornersStylesheetId = "paletools-remove-corners";

removeRoundedCornersPluginDefinition = {
  run: function () {
    if (removeRoundedCornersSettings.enabled) {
      upsertStylesheet(removeRoundedCornersStylesheetId, removeRoundedCornersStyles);
    }
  },
  order: 3,
  settings: {
    name: "remove-rounded-corners",
    title: "plugins.removeRoundedCorners.settings.title",
    menu: function () {
      const menuContainer = document.createElement("div");
      appendToggle(menuContainer, "enabled", removeRoundedCornersSettings.enabled, (isEnabled) => {
        removeRoundedCornersSettings.enabled = isEnabled;
        if (removeRoundedCornersSettings.enabled) {
          upsertStylesheet(removeRoundedCornersStylesheetId, removeRoundedCornersStyles);
        } else {
          removeStylesheet(removeRoundedCornersStylesheetId);
        }
        persistConfiguration();
      });
      return menuContainer;
    },
  },
};

export const removeRoundedCornersPlugin = removeRoundedCornersPluginDefinition;
