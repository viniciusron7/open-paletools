/**
 * Settings plugin (`settingsPlugin`): adds the Paletools settings tab. It is not in the sorted
 * plugin list: src/bootstrap/boot.js calls `settingsPlugin.run(pluginSettings)` after all other
 * plugins, with the `settings` objects (`{name, title, menu}`) they expose.
 *
 * Hooks:
 * - `run()` wraps `UTGameTabBarController.prototype.initWithViewControllers`: pushes a
 *   `UTGameFlowNavigationController` rooted at `SettingsViewController` (./settings-view.js)
 *   BEFORE calling the original.
 *
 * Invariants:
 * - Tab bar item tag 6, text `plugins.settings.title`, logo image and class `paletools-icon`;
 *   stylesheet id `paletools-settings`.
 * - Installed last, this wrapper is the outermost one on that method, so its tab is pushed before
 *   those added by inner wrappers (club analyzer, price tracker).
 */
import { createElement, prependElements } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { SettingsViewController } from "./settings-view.js";
import { paletoolsImages } from "../../ui/images.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import settingsCss from "./settings.css";

let settingsPluginDefinition;

settingsPluginDefinition = {
  run: (pluginSettings) => {
    (function (menus) {
      const originalInitWithViewControllers =
        UTGameTabBarController.prototype.initWithViewControllers;
      UTGameTabBarController.prototype.initWithViewControllers = function (viewControllers) {
        const settingsNavigationController = new UTGameFlowNavigationController();
        settingsNavigationController.initWithRootController(new SettingsViewController(menus));
        settingsNavigationController.tabBarItem = (function () {
          const tabBarItem = new UTTabBarItemView();
          tabBarItem.init();
          tabBarItem.setTag(6);
          tabBarItem.setText(translate("plugins.settings.title"));
          prependElements(
            tabBarItem,
            createElement("img", {
              src: paletoolsImages.logosvg,
            }),
          );
          tabBarItem.getRootElement().classList.add("paletools-icon");
          return tabBarItem;
        })();
        viewControllers.push(settingsNavigationController);
        originalInitWithViewControllers.call(this, viewControllers);
      };
      upsertStylesheet("paletools-settings", settingsCss);
    })(pluginSettings);
  },
};

export const settingsPlugin = settingsPluginDefinition;
