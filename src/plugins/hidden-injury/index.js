/**
 * Hidden injury plugin `hiddenInjuryPlugin` (order 10), installed by the plugin list in
 * src/bootstrap/boot.js: treats players with an injury type but 0 injury games as injured and
 * marks them on player item views.
 *
 * Hooks (installed in `run()`):
 * - REPLACES `UTItemEntity.prototype.isInjured` without calling the original:
 *   `isPlayer() && (injuryGames > 0 || (hiddenInjury.enabled && injuryType !== "none"))`; it
 *   backs every injury check of the Web App and is installed even when the plugin is disabled.
 * - Adds `UTItemEntity.prototype.isHiddenInjury` (`injuryGames === 0 && injuryType !== "none"`).
 * - `UTPlayerItemView.prototype.renderItem` (original first): adds `div.hidden-injury` to
 *   `__mainViewDiv` when enabled; stylesheet `paletools-hidden-injury`.
 *
 * Invariants:
 * - `configuration.enabled` is not consulted. lock-players (order 11) wraps `renderItem` after
 *   this plugin; player-card-info (order 100) wraps it before: with the inconsistent comparator
 *   of src/bootstrap/boot.js it runs 28th in V8, this plugin 55th.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { createElement, findOrCreateElement } from "../../core/dom.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import hiddenInjuryCss from "./hidden-injury.css";

let hiddenInjuryPluginDefinition;

const hiddenInjurySettings = configuration.plugins.hiddenInjury;

hiddenInjuryPluginDefinition = {
  run: function () {
    upsertStylesheet("paletools-hidden-injury", hiddenInjuryCss);
    UTItemEntity.prototype.isInjured = function () {
      return (
        this.isPlayer() &&
        (0 < this.injuryGames || (hiddenInjurySettings.enabled && this.injuryType !== "none"))
      );
    };
    UTItemEntity.prototype.isHiddenInjury = function () {
      return this.injuryGames === 0 && this.injuryType !== "none";
    };
    const originalRenderItem = UTPlayerItemView.prototype.renderItem;
    UTPlayerItemView.prototype.renderItem = function (...args) {
      const item = args[0];
      const renderResult = originalRenderItem.call(this, ...args);
      if (hiddenInjurySettings.enabled && item.isHiddenInjury()) {
        findOrCreateElement(".hidden-injury", this.__mainViewDiv, () =>
          createElement("div", {
            className: "hidden-injury",
          }),
        );
      }
      return renderResult;
    };
  },
  order: 10,
  settings: {
    name: "hidden-injury",
    title: "plugins.hiddenInjury.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", hiddenInjurySettings.enabled, (isEnabled) => {
        hiddenInjurySettings.enabled = isEnabled;
        persistConfiguration();
      });
      return container;
    },
  },
};

export const hiddenInjuryPlugin = hiddenInjuryPluginDefinition;
