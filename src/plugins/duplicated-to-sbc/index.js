/**
 * "Use duplicated players" SBC button plugin (order 3), installed by the plugin list in
 * src/bootstrap/boot.js and built on `registerSbcUsePlayersButton`
 * (src/sbc/use-players-button.js).
 *
 * Invariants:
 * - Loads the unassigned pile; `prepareItems` moves the unassigned duplicate players to the club,
 *   then the fill uses the club copies of every loaded unassigned player.
 * - Button name `useDuplicatedPlayers` (DOM id `_useDuplicatedPlayersButton`), label
 *   `plugins.duplicatedToSbc.button.text`; shortcut key in
 *   `configuration.plugins.snipe.buttons.sbc.useDuplicated`; settings
 *   `plugins.duplicatedToSbc.{enabled, behavior}`, settings page `duplicated-to-sbc`.
 */
import { configuration } from "../../config/configuration.js";
import {
  createSbcUsePlayersSettingsMenu,
  registerSbcUsePlayersButton,
} from "../../sbc/use-players-button.js";
import { fetchUnassignedItems, moveItemsToClub } from "../../webapp/item-piles.js";

let duplicatedToSbcPluginDefinition;

const duplicatedToSbcSettings = configuration.plugins.duplicatedToSbc;

duplicatedToSbcPluginDefinition = {
  run: function () {
    registerSbcUsePlayersButton(
      duplicatedToSbcSettings,
      "useDuplicatedPlayers",
      "plugins.duplicatedToSbc.button.text",
      0,
      fetchUnassignedItems,
      async (unassignedItems) =>
        await moveItemsToClub(
          unassignedItems.filter((item) => item.isDuplicate() && item.isPlayer()),
        ),
      {
        get: () => configuration.plugins.snipe.buttons.sbc.useDuplicated,
        set: (keyCode) => (configuration.plugins.snipe.buttons.sbc.useDuplicated = keyCode),
      },
    );
  },
  order: 3,
  settings: {
    name: "duplicated-to-sbc",
    title: "plugins.duplicatedToSbc.settings.title",
    menu: createSbcUsePlayersSettingsMenu(duplicatedToSbcSettings),
  },
};

export const duplicatedToSbcPlugin = duplicatedToSbcPluginDefinition;
