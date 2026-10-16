/**
 * SBC times-completed plugin (order 6), installed by the plugin list in src/bootstrap/boot.js:
 * shows "Completed N times" labels (hard-coded English) on SBC set tiles, on the set info of the
 * challenges list and on the SBC squad detail panel.
 *
 * Hooks (installed in `run()`):
 * - `_generate` of `UTSBCSetTileView`, `UTSBCSquadDetailPanelView` and `UTSBCSetInfoView` (after
 *   the original, when enabled): append a `UTSquadBuildingSetStatusLabelView` with class
 *   `timescompleted` to `.sbc-status-container`, stored as `_timesCompleted`.
 * - `UTSBCSetTileView.render` (hidden for NON_REPEATABLE sets; calls the previous implementation
 *   without arguments), `UTSBCSquadDetailPanelView.render` (hidden unless `repeatable`) and
 *   `UTSBCChallengesView.setSBCSet` (writes `this._setInfo._timesCompleted`) set the text.
 *
 * Invariants:
 * - The render/setSBCSet wrappers rely on the `_timesCompleted` labels created by the `_generate`
 *   wrappers, i.e. on the plugin having been enabled when the view was generated.
 * - Stylesheet `paletools-timescompleted` (injected at `run()` only when enabled); configuration
 *   `plugins.sbcTimesCompleted.enabled`.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { addClasses, appendElements, queryElement } from "../../core/dom.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements } from "../../ui/visibility.js";
import timescompletedCss from "./timescompleted.css";

let sbcTimesCompletedPluginDefinition;

const sbcTimesCompletedSettings = configuration.plugins.sbcTimesCompleted;

sbcTimesCompletedPluginDefinition = {
  run: function () {
    if (sbcTimesCompletedSettings.enabled) {
      upsertStylesheet("paletools-timescompleted", timescompletedCss);
    }
    const originalSetTileGenerate = UTSBCSetTileView.prototype._generate;
    UTSBCSetTileView.prototype._generate = function (...generateArguments) {
      originalSetTileGenerate.call(this, ...generateArguments);
      if (!sbcTimesCompletedSettings.enabled) {
        return;
      }
      const statusContainer = queryElement(".sbc-status-container", this);
      this._timesCompleted = new UTSquadBuildingSetStatusLabelView();
      addClasses(this._timesCompleted, "timescompleted");
      appendElements(statusContainer, this._timesCompleted);
    };
    const originalSetTileRender = UTSBCSetTileView.prototype.render;
    UTSBCSetTileView.prototype.render = function () {
      originalSetTileRender.call(this);
      if (sbcTimesCompletedSettings.enabled && this.data) {
        if (this.data.repeatabilityMode == SBCRepeatabilityMode.NON_REPEATABLE) {
          hideElements(this._timesCompleted);
        } else {
          this._timesCompleted.setText("Completed " + this.data.timesCompleted + " times");
        }
      }
    };
    const originalSquadDetailPanelGenerate = UTSBCSquadDetailPanelView.prototype._generate;
    UTSBCSquadDetailPanelView.prototype._generate = function () {
      originalSquadDetailPanelGenerate.call(this);
      if (!sbcTimesCompletedSettings.enabled) {
        return;
      }
      const statusContainer = queryElement(".sbc-status-container", this);
      this._timesCompleted = new UTSquadBuildingSetStatusLabelView();
      addClasses(this._timesCompleted, "timescompleted");
      appendElements(statusContainer, this._timesCompleted);
    };
    const originalSquadDetailPanelRender = UTSBCSquadDetailPanelView.prototype.render;
    UTSBCSquadDetailPanelView.prototype.render = function (...renderArguments) {
      originalSquadDetailPanelRender.call(this, ...renderArguments);
      const firstRenderArgument = renderArguments[0];
      if (sbcTimesCompletedSettings.enabled && firstRenderArgument) {
        if (firstRenderArgument.repeatable) {
          this._timesCompleted.setText(
            "Completed " + firstRenderArgument.timesCompleted + " times",
          );
        } else {
          hideElements(this._timesCompleted);
        }
      }
    };
    const originalSetSBCSet = UTSBCChallengesView.prototype.setSBCSet;
    UTSBCChallengesView.prototype.setSBCSet = function (...setSBCSetArguments) {
      originalSetSBCSet.call(this, ...setSBCSetArguments);
      if (sbcTimesCompletedSettings.enabled) {
        this._setInfo._timesCompleted.setText(
          "Completed " + setSBCSetArguments[0].timesCompleted + " times",
        );
      }
    };
    const originalSetInfoGenerate = UTSBCSetInfoView.prototype._generate;
    UTSBCSetInfoView.prototype._generate = function (...generateArguments) {
      originalSetInfoGenerate.call(this, ...generateArguments);
      if (!sbcTimesCompletedSettings.enabled) {
        return;
      }
      const statusContainer = queryElement(".sbc-status-container", this);
      this._timesCompleted = new UTSquadBuildingSetStatusLabelView();
      addClasses(this._timesCompleted, "timescompleted");
      appendElements(statusContainer, this._timesCompleted);
    };
  },
  order: 6,
  settings: {
    name: "sbc-times-completed",
    title: "plugins.sbcTimesCompleted.settings.title",
    menu: function () {
      const menuContainer = document.createElement("div");
      appendToggle(menuContainer, "enabled", sbcTimesCompletedSettings.enabled, (isEnabled) => {
        sbcTimesCompletedSettings.enabled = isEnabled;
        persistConfiguration();
      });
      return menuContainer;
    },
  },
};

export const sbcTimesCompletedPlugin = sbcTimesCompletedPluginDefinition;
