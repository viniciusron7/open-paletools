/**
 * Shared implementation of the "use <pile> players" SBC buttons. `registerSbcUsePlayersButton` is
 * called from `run()` of the duplicated-to-sbc, unassigned-to-sbc and transfer-list-to-sbc
 * plugins; `createSbcUsePlayersSettingsMenu` builds their settings menu (enabled toggle and
 * `behavior` dropdown).
 *
 * Hooks:
 * - Registers a keyboard shortcut and pushes generate/destroy handlers into
 *   src/sbc/squad-detail-panel-hooks.js, which the `UTSBCSquadDetailPanelView` wrappers of
 *   src/webapp/patches.js run.
 *
 * Invariants:
 * - The button is stored on the panel as `_<buttonName>Button`, which is also its DOM id and the
 *   shortcut-hint selector (`#_<buttonName>Button`); `<buttonName>Called` marks the panel. Button
 *   names (including the misspelt `useUnnasignedPlayers`) must stay identical.
 * - The button is added only when the plugin is enabled and a shortcut accessor was passed.
 * - The single shortcut action targets the last generated panel; any panel destroy clears it.
 * - On tap: `loadItems()`, optional `prepareItems(items)`, then the loaded players, resolved to
 *   their club copies, fill the current challenge (the active controller's, or, when it has a
 *   challenge details controller, that controller's current controller) by `behavior`:
 *   `position`, `lowToHigh` or `highToLow` (configuration
 *   values; labels `toSbc.behavior.*`). Position mode saves the challenge and resets the
 *   unassigned/transfer repository expiry like `fillSbcSquadByRating`.
 * - On phone the view navigates back afterwards.
 *
 * Known issues (kept as-is):
 * - The fill functions are started but not awaited, so the `finally` block restores the button
 *   (and navigates back on phone) before the squad is filled and saved.
 */
import { persistConfiguration } from "../config/configuration.js";
import { accessAttribute, appendElements, queryElement } from "../core/dom.js";
import { translate } from "../i18n/translations.js";
import {
  sbcSquadDetailPanelDestroyHandlers,
  sbcSquadDetailPanelGenerateHandlers,
} from "./squad-detail-panel-hooks.js";
import {
  fillSbcSquadByPosition,
  fillSbcSquadByRating,
  findClubPlayersMatchingItems,
} from "./squad-fill.js";
import { isSearchFilterDropdownOpen, registerKeyboardShortcut } from "../ui/keyboard-shortcuts.js";
import { appendDropdown, appendToggle } from "../ui/settings-controls.js";
import { getActiveController, navigateBack } from "../webapp/navigation.js";

export function createSbcUsePlayersSettingsMenu(pluginSettings) {
  return function () {
    const menuContainer = document.createElement("div");
    appendToggle(menuContainer, "enabled", pluginSettings.enabled, (isEnabled) => {
      pluginSettings.enabled = isEnabled;
      persistConfiguration();
    });
    appendDropdown(
      menuContainer,
      "toSbc.behavior",
      [
        {
          label: translate("toSbc.behavior.position"),
          value: "position",
        },
        {
          label: translate("toSbc.behavior.lowToHigh"),
          value: "lowToHigh",
        },
        {
          label: translate("toSbc.behavior.highToLow"),
          value: "highToLow",
        },
      ],
      pluginSettings.behavior,
      (behavior) => {
        pluginSettings.behavior = behavior;
        persistConfiguration();
      },
    );
    return menuContainer;
  };
}

export function registerSbcUsePlayersButton(
  pluginSettings,
  buttonName,
  buttonLocaleKey,
  unusedArgument4,
  loadItems,
  prepareItems,
  shortcutKeyAccessor,
) {
  (function (
    pluginSettings,
    buttonName,
    buttonLocaleKey,
    unusedArgument4,
    onButtonTap,
    shortcutKeyAccessor,
  ) {
    const generatedFlagKey = buttonName + "Called";
    const buttonPropertyName = "_" + buttonName + "Button";
    let shortcutAction = null;
    var addButtonToPanel;
    if (shortcutKeyAccessor) {
      registerKeyboardShortcut(
        buttonName,
        shortcutKeyAccessor.get,
        (keyCode) => shortcutKeyAccessor.set(keyCode),
        buttonLocaleKey,
        () => shortcutAction && shortcutAction(),
        "#" + buttonPropertyName,
      );
    }
    addButtonToPanel = (panelView) => {
      if (pluginSettings.enabled && !panelView[generatedFlagKey] && shortcutKeyAccessor) {
        shortcutAction = () => {
          if (!isSearchFilterDropdownOpen()) {
            if (panelView && panelView.getRootElement()) {
              onButtonTap(panelView[buttonPropertyName]);
            }
          }
        };
        panelView[buttonPropertyName] = new UTStandardButtonControl();
        panelView[buttonPropertyName].init();
        accessAttribute(panelView[buttonPropertyName], "id", buttonPropertyName);
        panelView[buttonPropertyName].setText(translate(buttonLocaleKey));
        panelView[buttonPropertyName].addTarget(
          panelView,
          () => onButtonTap(panelView[buttonPropertyName]),
          EventType.TAP,
        );
        appendElements(
          queryElement(".sbc-button-container", panelView.__content),
          panelView[buttonPropertyName],
        );
        panelView[generatedFlagKey] = true;
      }
    };
    sbcSquadDetailPanelGenerateHandlers.push(addButtonToPanel);
    sbcSquadDetailPanelDestroyHandlers.push((panelView) => {
      shortcutAction = null;
      if (panelView[buttonPropertyName]) {
        panelView[buttonPropertyName].destroy();
      }
    });
  })(
    pluginSettings,
    buttonName,
    buttonLocaleKey,
    0,
    async (button) => {
      try {
        const loadedItems = await loadItems();
        if (prepareItems) {
          await prepareItems(loadedItems);
        }
        await (function (challenge, players, unusedArgument3, behavior) {
          switch (behavior) {
            case "position":
              (async function (challenge, players, unusedArgument3) {
                if (!challenge) {
                  return;
                }
                let matchingPlayers = await findClubPlayersMatchingItems(players);
                matchingPlayers = matchingPlayers.slice(0, 23);
                fillSbcSquadByPosition(challenge, matchingPlayers);
                services.SBC.saveChallenge(challenge);
                repositories.Item.unassigned.expiryTimestamp = 0;
                repositories.Item.transfer.expiryTimestamp = 0;
              })(challenge, players);
              break;
            case "lowToHigh":
              fillSbcSquadByRating(challenge, players, 0, true);
              break;
            case "highToLow":
              fillSbcSquadByRating(challenge, players, 0, false);
          }
        })(
          (controller = controller || getActiveController())._challengeDetailsController ||
            controller.challengeDetailsController
            ? (controller = getActiveController(
                controller._challengeDetailsController || controller.challengeDetailsController,
              ))._challenge || controller.challenge
            : controller._challenge || controller.challenge,
          loadedItems.filter((item) => item.isPlayer()),
          0,
          pluginSettings.behavior,
        );
      } finally {
        button.setInteractionState(true);
        button.setText(translate(buttonLocaleKey));
        if (isPhone()) {
          navigateBack();
        }
      }
      var controller;
    },
    shortcutKeyAccessor,
  );
}
