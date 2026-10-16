/**
 * Repeat SBC plugin (order 128), installed by the plugin list in src/bootstrap/boot.js: a "repeat
 * SBC" button (`#repeat-sbc`) and shortcut `repeatSbc` on the SBC squad detail panel that rebuild
 * the squad with the squad-builder view model captured from the challenge's last search.
 *
 * Hooks (installed in `run()`):
 * - `UTSBCSquadDetailPanelViewController.getView`: once per controller (`repeatSbcButtonHandled`)
 *   wires the button and sets the shortcut action (calls the original twice that time); new
 *   `_eRepeatSbcSelected`.
 * - `UTSBCSquadDetailPanelView._generate` (after the original; when Paletools and the plugin are
 *   enabled, once via `_repeatSbcCalled`) adds the button to `.sbc-button-container`; new
 *   `getRepeatSbcButton`; `destroyGeneratedElements` clears the shortcut and destroys the button.
 * - `UTSquadBuilderViewController.onClubSearchComplete` (after the original): stores
 *   `this.viewModel` (with `ignorePosition`) per challenge id.
 *
 * Invariants:
 * - `repeatSbcViewModelsByChallengeId` is in memory only: repeating does nothing until a squad
 *   builder search for that challenge has completed in this page session.
 * - Repeating pushes a new `UTSquadBuilderViewController`, swaps in the stored view model, copies
 *   `ignorePosition` and calls `eBuildSelected` inside the loading shield.
 * - Configuration `plugins.repeatSbc.enabled`; settings page `repeat-sbc`.
 *
 * Known issues (kept as-is):
 * - `_eRepeatSbcSelected` reads `this._challenge.id` before testing `this._challenge`, so the
 *   `init()` fallback is unreachable.
 * - `getView` wires `getRepeatSbcButton()` when only `repeatSbc.enabled` holds, but the button is
 *   created only when Paletools is enabled too; with Paletools disabled `.addTarget` throws.
 * - The shortcut key is read from `snipe.buttons.repeatSbc`, while the default lives in
 *   `snipe.buttons.sbc.repeatSbc`, so the shortcut starts unassigned.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { accessAttribute, appendElements, queryElement } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import {
  isSearchFilterDropdownOpen,
  registerKeyboardShortcut,
} from "../../ui/keyboard-shortcuts.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { getControllerView } from "../../webapp/game-view.js";
import { hideLoadingShield, showLoadingShield } from "../../webapp/loading-shield.js";

let repeatSbcPluginDefinition;

const repeatSbcSettings = configuration.plugins.repeatSbc;

const repeatSbcViewModelsByChallengeId = {};

repeatSbcPluginDefinition = {
  run: function () {
    let repeatSbcShortcutAction = null;
    registerKeyboardShortcut(
      "repeatSbc",
      () => configuration.plugins.snipe.buttons.repeatSbc,
      (keyCode) => (configuration.plugins.snipe.buttons.repeatSbc = keyCode),
      "plugins.repeatSbc.button.text",
      () => repeatSbcShortcutAction && repeatSbcShortcutAction(),
      "#repeat-sbc",
    );
    const originalGetView = UTSBCSquadDetailPanelViewController.prototype.getView;
    UTSBCSquadDetailPanelViewController.prototype.getView = function (...args) {
      if (repeatSbcSettings.enabled && !this.repeatSbcButtonHandled) {
        repeatSbcShortcutAction = () =>
          getControllerView(this) &&
          getControllerView(this).getRootElement() &&
          !isSearchFilterDropdownOpen() &&
          this._eRepeatSbcSelected();
        originalGetView
          .call(this, ...args)
          .getRepeatSbcButton()
          .addTarget(this, this._eRepeatSbcSelected, EventType.TAP);
        this.repeatSbcButtonHandled = true;
      }
      return originalGetView.call(this, ...args);
    };
    UTSBCSquadDetailPanelViewController.prototype._eRepeatSbcSelected = function (...args) {
      if (!repeatSbcViewModelsByChallengeId[this._challenge.id]) {
        return;
      }
      showLoadingShield();
      const squadBuilderController = new UTSquadBuilderViewController();
      if (this._challenge) {
        squadBuilderController.initWithChallenge(this._challenge);
      } else {
        squadBuilderController.init();
      }
      this.getNavigationController().pushViewController(squadBuilderController, true);
      squadBuilderController.viewModel = repeatSbcViewModelsByChallengeId[this._challenge.id];
      squadBuilderController.ignorePosition = squadBuilderController.viewModel.ignorePosition;
      squadBuilderController.eBuildSelected(...args);
      hideLoadingShield();
    };
    const originalGenerate = UTSBCSquadDetailPanelView.prototype._generate;
    UTSBCSquadDetailPanelView.prototype._generate = function () {
      originalGenerate.call(this);
      if (configuration.enabled && repeatSbcSettings.enabled && !this._repeatSbcCalled) {
        this._repeatSbcButton = new UTStandardButtonControl();
        this._repeatSbcButton.init();
        this._repeatSbcButton.setText(translate("plugins.repeatSbc.button.text"));
        accessAttribute(this._repeatSbcButton, "id", "repeat-sbc");
        appendElements(
          queryElement(".sbc-button-container", this.__content),
          this._repeatSbcButton,
        );
        this._repeatSbcCalled = true;
      }
    };
    UTSBCSquadDetailPanelView.prototype.getRepeatSbcButton = function () {
      return this._repeatSbcButton;
    };
    const originalDestroyGeneratedElements =
      UTSBCSquadDetailPanelView.prototype.destroyGeneratedElements;
    UTSBCSquadDetailPanelView.prototype.destroyGeneratedElements = function () {
      originalDestroyGeneratedElements.call(this);
      repeatSbcShortcutAction = null;
      if (this._repeatSbcButton) {
        this._repeatSbcButton.destroy();
      }
    };
    const originalOnClubSearchComplete =
      UTSquadBuilderViewController.prototype.onClubSearchComplete;
    UTSquadBuilderViewController.prototype.onClubSearchComplete = function (...args) {
      originalOnClubSearchComplete.call(this, ...args);
      if (repeatSbcSettings.enabled && this.challenge) {
        this.viewModel.ignorePosition = this.ignorePosition;
        repeatSbcViewModelsByChallengeId[this.challenge.id] = this.viewModel;
      }
    };
  },
  order: 128,
  settings: {
    name: "repeat-sbc",
    title: "plugins.repeatSbc.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", repeatSbcSettings.enabled, (isEnabled) => {
        repeatSbcSettings.enabled = isEnabled;
        persistConfiguration();
      });
      return container;
    },
  },
};

export const repeatSbcPlugin = repeatSbcPluginDefinition;
