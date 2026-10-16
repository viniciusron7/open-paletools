/**
 * Settings-only plugin `importantLeaguesAndNationsPlugin` (order 10000, empty `run()`), installed
 * by the plugin list in src/bootstrap/boot.js: its menu edits the important league ids (with a
 * highlight color) and important nation ids read through src/webapp/leagues-and-nations.js (e.g.
 * by improved-filters).
 *
 * Invariants:
 * - `configuration.plugins.importantLeagues.leagueIds` and
 *   `configuration.plugins.importantNations.nationIds` are edited in place by
 *   `DataProviderMultiSelectControl` (persisted on change); `importantLeagues.color` is set by the
 *   color input on change and set to null by the clear icon (both persist).
 *
 * Known issues (kept as-is):
 * - The color input is initialized and reset with `transparent`, which is not a valid
 *   `<input type="color">` value (the browser shows black).
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { appendElements, createElement } from "../../core/dom.js";
import { listenForEvent } from "../../core/events.js";
import { translate } from "../../i18n/translations.js";
import { dataProviderType } from "../../ui/data-provider-dropdown.js";
import { DataProviderMultiSelectControl } from "../../ui/data-provider-multi-select-control.js";

function createImportantLeaguesAndNationsSelector(
  ids,
  type,
  placeholder,
  hasColorPicker,
  colorSettings,
) {
  const selector = new DataProviderMultiSelectControl({
    type: type,
    ids: ids,
    placeholder: placeholder,
    onChange: persistConfiguration,
  });
  if (hasColorPicker) {
    const colorInput = createElement("input", {
      type: "color",
      value: colorSettings.color || "transparent",
    });
    listenForEvent(colorInput, "change", (event) => {
      colorSettings.color = event.target.value;
      persistConfiguration();
    });
    const clearColorButton = document.createElement("i");
    clearColorButton.classList.add("fut_icon");
    clearColorButton.classList.add("icon_close");
    clearColorButton.addEventListener("click", () => {
      colorInput.value = "transparent";
      colorSettings.color = null;
      persistConfiguration();
    });
    appendElements(selector, colorInput, clearColorButton);
  }
  return selector;
}

let importantLeaguesAndNationsPluginDefinition;

importantLeaguesAndNationsPluginDefinition = {
  run: function () {},
  order: 10000,
  settings: {
    name: "important-leagues",
    title: "plugins.importantLeaguesAndNations.settings.title",
    menu: function () {
      const container = createElement("div");
      appendElements(
        container,
        createImportantLeaguesAndNationsSelector(
          configuration.plugins.importantLeagues.leagueIds,
          dataProviderType.League,
          translate("extendedPlayerInfo.general.league"),
          true,
          configuration.plugins.importantLeagues,
        ),
        createImportantLeaguesAndNationsSelector(
          configuration.plugins.importantNations.nationIds,
          dataProviderType.Nation,
          translate("extendedPlayerInfo.general.nation"),
        ),
      );
      return container;
    },
  },
};

export const importantLeaguesAndNationsPlugin = importantLeaguesAndNationsPluginDefinition;
