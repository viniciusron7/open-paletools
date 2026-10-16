/**
 * "Use transfer list players" SBC button plugin (order 127), installed by the plugin list in
 * src/bootstrap/boot.js and built on `registerSbcUsePlayersButton`
 * (src/sbc/use-players-button.js).
 *
 * Invariants:
 * - Loads the unlisted transfer-list items (`fetchUnlistedTransferListItems`) and moves nothing;
 *   like the other buttons, the fill resolves them to matching club players.
 * - Button name `useTransferListPlayers` (DOM id `_useTransferListPlayersButton`), label
 *   `plugins.transferListToSbc.button.text`; shortcut key in
 *   `configuration.plugins.snipe.buttons.sbc.useTransferList`; settings
 *   `plugins.transferListToSbc.{enabled, behavior}`, settings page `transfer-list-to-sbc`.
 */
import { configuration } from "../../config/configuration.js";
import {
  createSbcUsePlayersSettingsMenu,
  registerSbcUsePlayersButton,
} from "../../sbc/use-players-button.js";
import { fetchUnlistedTransferListItems } from "../../webapp/item-piles.js";

let transferListToSbcPluginDefinition;

const transferListToSbcSettings = configuration.plugins.transferListToSbc;

transferListToSbcPluginDefinition = {
  run: function () {
    registerSbcUsePlayersButton(
      transferListToSbcSettings,
      "useTransferListPlayers",
      "plugins.transferListToSbc.button.text",
      0,
      fetchUnlistedTransferListItems,
      null,
      {
        get: () => configuration.plugins.snipe.buttons.sbc.useTransferList,
        set: (useTransferList) =>
          (configuration.plugins.snipe.buttons.sbc.useTransferList = useTransferList),
      },
    );
  },
  order: 127,
  settings: {
    name: "transfer-list-to-sbc",
    title: "plugins.transferListToSbc.settings.title",
    menu: createSbcUsePlayersSettingsMenu(transferListToSbcSettings),
  },
};

export const transferListToSbcPlugin = transferListToSbcPluginDefinition;
