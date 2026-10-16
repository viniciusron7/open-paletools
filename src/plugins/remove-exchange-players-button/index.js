/**
 * Remove Exchange Players Button plugin (`removeExchangePlayersButtonPlugin`, order 128),
 * installed by the plugin list in src/bootstrap/boot.js: hides the exchange-players button of
 * the SBC squad detail panel.
 *
 * Hooks:
 * - `run()` wraps `UTSBCSquadDetailPanelView.prototype._generate` (after original) and hides
 *   `this._btnExchange`. Several other plugins wrap the same method; the chain follows the plugin
 *   run order.
 *
 * Invariants:
 * - Checked at panel generation only and independent of the global `configuration.enabled`;
 *   setting `plugins.removeExchangePlayersButton.enabled` (default off).
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { hideElements } from "../../ui/visibility.js";

let removeExchangePlayersButtonPluginDefinition;

const removeExchangePlayersButtonSettings = configuration.plugins.removeExchangePlayersButton;

removeExchangePlayersButtonPluginDefinition = {
  run: function () {
    const originalGenerate = UTSBCSquadDetailPanelView.prototype._generate;
    UTSBCSquadDetailPanelView.prototype._generate = function (...args) {
      originalGenerate.call(this, ...args);
      if (removeExchangePlayersButtonSettings.enabled) {
        hideElements(this._btnExchange);
      }
    };
  },
  order: 128,
  settings: {
    name: "remove-exchange-players-button",
    title: "plugins.removeExchangePlayersButton.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(
        container,
        "enabled",
        removeExchangePlayersButtonSettings.enabled,
        (isEnabled) => {
          removeExchangePlayersButtonSettings.enabled = isEnabled;
          persistConfiguration();
        },
      );
      return container;
    },
  },
};

export const removeExchangePlayersButtonPlugin = removeExchangePlayersButtonPluginDefinition;
