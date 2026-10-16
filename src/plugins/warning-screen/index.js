/**
 * Warning Screen plugin (`warningScreenPlugin`), installed by the plugin list in
 * src/bootstrap/boot.js: shows the usage disclaimer dialog once. Installs no hooks.
 *
 * Invariants:
 * - `run()` shows the dialog (`plugins.warningScreen.title` / `.disclaimer`) only while
 *   `plugins.warningScreen.enabled`; closing it sets the flag to false and persists, so it never
 *   shows again (there is no settings tile to re-enable it).
 * - It has no `order`, so its position in the boot sort is not well-defined and depends on the
 *   JS engine.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { translate } from "../../i18n/translations.js";
import { showDialog } from "../../ui/dialog.js";

const warningScreenSettings = configuration.plugins.warningScreen;

export const warningScreenPlugin = {
  run: function () {
    if (warningScreenSettings.enabled) {
      showDialog(
        [
          {
            labelEnum: enums.UIDialogOptions.OK,
          },
        ],
        translate("plugins.warningScreen.title"),
        "<p>" + translate("plugins.warningScreen.disclaimer") + "</p>\n    ",
        async () => {
          warningScreenSettings.enabled = false;
          persistConfiguration();
        },
      );
    }
  },
};
