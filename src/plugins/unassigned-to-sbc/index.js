/**
 * "Use unassigned players" SBC button plugin (order 3), installed by the plugin list in
 * src/bootstrap/boot.js and built on `registerSbcUsePlayersButton`
 * (src/sbc/use-players-button.js); twin of duplicated-to-sbc.
 *
 * Invariants:
 * - Loads the unassigned pile; `prepareItems` moves the unassigned non-duplicate players to the
 *   club, then the fill uses the club copies of every loaded unassigned player.
 * - Button name `useUnnasignedPlayers` (sic; DOM id `_useUnnasignedPlayersButton`), label
 *   `plugins.unassignedToSbc.button.text`; shortcut key in
 *   `configuration.plugins.snipe.buttons.sbc.useUnassigned`; settings
 *   `plugins.unassignedToSbc.{enabled, behavior}`, settings page `unassigned-to-sbc`.
 */
import { configuration } from "../../config/configuration.js";
import {
  createSbcUsePlayersSettingsMenu,
  registerSbcUsePlayersButton,
} from "../../sbc/use-players-button.js";
import { fetchUnassignedItems, moveItemsToClub } from "../../webapp/item-piles.js";

let unassignedToSbcPluginDefinition;

const unassignedToSbcSettings = configuration.plugins.unassignedToSbc;

unassignedToSbcPluginDefinition = {
  run: function () {
    registerSbcUsePlayersButton(
      unassignedToSbcSettings,
      "useUnnasignedPlayers",
      "plugins.unassignedToSbc.button.text",
      0,
      fetchUnassignedItems,
      async (unassignedItems) =>
        await moveItemsToClub(
          unassignedItems.filter((item) => !item.isDuplicate() && item.isPlayer()),
        ),
      {
        get: () => configuration.plugins.snipe.buttons.sbc.useUnassigned,
        set: (keyCode) => (configuration.plugins.snipe.buttons.sbc.useUnassigned = keyCode),
      },
    );
  },
  order: 3,
  settings: {
    name: "unassigned-to-sbc",
    title: "plugins.unassignedToSbc.settings.title",
    menu: createSbcUsePlayersSettingsMenu(unassignedToSbcSettings),
  },
};

export const unassignedToSbcPlugin = unassignedToSbcPluginDefinition;
