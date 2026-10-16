/**
 * SBC challenges view plugin (order 128), installed by the plugin list in src/bootstrap/boot.js:
 * grid layout for a set's challenge list, hiding completed challenges and marking challenges that
 * require TOTW players.
 *
 * Hooks (installed in `run()`):
 * - `UTSBCChallengesView._generate` (after the original): adds `grid-mode` to `__challenges` when
 *   `gridMode` is set (also while the plugin is disabled; the stylesheet is then absent).
 * - `UTSBCChallengeTableRowView.render` (after the original, when enabled): hides completed rows
 *   with `hideCompleted`; with `displayTOTW`, calls `toggleClass("requires-totw")` when a
 *   requirement's PLAYER_RARITY values contain `rarityIdByName.TOTW`.
 *
 * Invariants:
 * - Stylesheet `paletools-sbc-challenges-view` is injected at `run()` only when enabled; the
 *   enabled toggle adds or removes it.
 * - Configuration `plugins.sbcChallengesView.{enabled, gridMode, hideCompleted, displayTOTW}`;
 *   labels `plugins.sbcChallengesView.settings.*`.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { addClasses } from "../../core/dom.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { removeStylesheet, upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements } from "../../ui/visibility.js";
import { rarityIdByName } from "../../webapp/rarities.js";
import sbcChallengesViewStyles from "./sbc-challenges-view.css";

let sbcChallengesViewPluginDefinition;

const sbcChallengesViewSettings = configuration.plugins.sbcChallengesView;

const sbcChallengesViewStylesheetId = "paletools-sbc-challenges-view";

sbcChallengesViewPluginDefinition = {
  run: function () {
    if (sbcChallengesViewSettings.enabled) {
      upsertStylesheet(sbcChallengesViewStylesheetId, sbcChallengesViewStyles);
    }
    const originalGenerate = UTSBCChallengesView.prototype._generate;
    UTSBCChallengesView.prototype._generate = function (...args) {
      originalGenerate.call(this, ...args);
      if (sbcChallengesViewSettings.gridMode) {
        addClasses(this.__challenges, "grid-mode");
      }
    };
    const originalRender = UTSBCChallengeTableRowView.prototype.render;
    UTSBCChallengeTableRowView.prototype.render = function (...args) {
      originalRender.call(this, ...args);
      if (sbcChallengesViewSettings.enabled) {
        if (args[0].isCompleted() && sbcChallengesViewSettings.hideCompleted) {
          hideElements(this);
        }
        if (
          sbcChallengesViewSettings.displayTOTW &&
          (function (challenge) {
            for (let requirement of challenge.eligibilityRequirements) {
              if (
                requirement.getValue(SBCEligibilityKey.PLAYER_RARITY).indexOf(rarityIdByName.TOTW) >
                -1
              ) {
                return true;
              }
            }
            return false;
          })(args[0])
        ) {
          this.toggleClass("requires-totw");
        }
      }
    };
  },
  order: 128,
  settings: {
    name: "sbc-challenges-view",
    title: "plugins.sbcChallengesView.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", sbcChallengesViewSettings.enabled, (isEnabled) => {
        sbcChallengesViewSettings.enabled = isEnabled;
        if (isEnabled) {
          upsertStylesheet(sbcChallengesViewStylesheetId, sbcChallengesViewStyles);
        } else {
          removeStylesheet(sbcChallengesViewStylesheetId);
        }
        persistConfiguration();
      });
      appendToggle(
        container,
        "plugins.sbcChallengesView.settings.gridMode",
        sbcChallengesViewSettings.gridMode,
        (gridMode) => {
          sbcChallengesViewSettings.gridMode = gridMode;
          persistConfiguration();
        },
      );
      appendToggle(
        container,
        "plugins.sbcChallengesView.settings.hideCompleted",
        sbcChallengesViewSettings.hideCompleted,
        (hideCompleted) => {
          sbcChallengesViewSettings.hideCompleted = hideCompleted;
          persistConfiguration();
        },
      );
      appendToggle(
        container,
        "plugins.sbcChallengesView.settings.displayTOTW",
        sbcChallengesViewSettings.displayTOTW,
        (displayTOTW) => {
          sbcChallengesViewSettings.displayTOTW = displayTOTW;
          persistConfiguration();
        },
      );
      return container;
    },
  },
};

export const sbcChallengesViewPlugin = sbcChallengesViewPluginDefinition;
