/**
 * SBC smart builder plugin (order 128), installed by the plugin list in src/bootstrap/boot.js:
 * "smart builder" and "edit" buttons (and shortcut `sbcSmartBuilder`) on the SBC squad detail
 * panel that fill the challenge with `buildSmartBuilderSquad` (src/sbc/smart-builder-solver.js),
 * plus the settings form used by the settings page and the per-challenge edit dialog.
 *
 * Hooks (installed in `run()`):
 * - `UTSBCSquadDetailPanelViewController.getView`: once per controller (`smartBuildHandled`)
 *   loads `this.config`, wires both buttons and sets the shortcut action (calls the original
 *   twice that time); new `_eEditSmartBuilderSelected` and `_eSmartBuilderSelected`.
 * - `UTSBCSquadDetailPanelView._generate` (after the original; when Paletools and the plugin are
 *   enabled, once via `_smartBuilderCalled`) inserts `.smart-builder-container` after
 *   `_btnSquadBuilder`, hidden until the club index is ready; new getters;
 *   `destroyGeneratedElements` clears the shortcut and destroys the buttons.
 *
 * Invariants:
 * - Per-challenge configs live in `paletoolsStorage` key `smartBuilderConfigs` (localStorage,
 *   keyed by challenge id) and are merged over a `structuredClone` of `plugins.sbcSmartBuilder`;
 *   the dialog edits that copy without persisting the global configuration.
 * - Solving empties and saves a non-empty squad first, then places the solution in non-brick slot
 *   order and saves again, under the loading shield; a failure shows `solution.reason`.
 * - CLUB_INDEX_LOADED shows every `.smart-builder-container`; enabling the plugin dispatches
 *   SMART_BUILDER_ENABLED, on which the club-index plugin enables the club index.
 * - In the form `useStorage` cannot be switched off while `storageOnly` is on and `storageOnly`
 *   forces `useStorage`; the OVR range is stored as `ovrMin`/`ovrMax`.
 * - `new UTItemSearchViewModel()` runs at module evaluation and is discarded (kept as in the
 *   original), so that EA class must exist when the bundle is evaluated.
 *
 * Known issues (kept as-is):
 * - `getView` wires the buttons when only `sbcSmartBuilder.enabled` holds, but `_generate`
 *   creates them only when Paletools is enabled too; with Paletools disabled `.addTarget` throws.
 * - `_eSmartBuilderSelected` has no try/finally: if the solver throws (e.g.
 *   `fetchActiveSquadDefinitionIds`), the loading shield stays up and the squad stays emptied.
 * - The shortcut-hint selector `#sbc-smart-builder` matches no element (the buttons get no id).
 * - The configuration defaults define `minOvr`/`maxOvr`, but the form and solver use
 *   `ovrMin`/`ovrMax`.
 */
import { isClubIndexReady } from "../../club/club-index.js";
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { addClasses, appendElements, createElement, insertAfter } from "../../core/dom.js";
import { dispatchPaletoolsEvent, listenForEvent, paletoolsEvents } from "../../core/events.js";
import { paletoolsStorage } from "../../core/storage.js";
import { translate } from "../../i18n/translations.js";
import { buildSmartBuilderSquad } from "../../sbc/smart-builder-solver.js";
import { showDialog } from "../../ui/dialog.js";
import { registerKeyboardShortcut } from "../../ui/keyboard-shortcuts.js";
import { showErrorNotification } from "../../ui/notifications.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import { hideLoadingShield, showLoadingShield } from "../../webapp/loading-shield.js";
import { observableToPromise } from "../../webapp/observable.js";
import { maxOvr, minOvr } from "../../webapp/search-criteria-limits.js";
import sbcSmartBuilderCss from "./sbc-smart-builder.css";

let sbcSmartBuilderPluginDefinition;

new UTItemSearchViewModel();

const sbcSmartBuilderSettings = configuration.plugins.sbcSmartBuilder;

function createSbcSmartBuilderSettingsMenu(builderConfig, isChallengeConfig) {
  const container = document.createElement("div");
  [
    "enabled",
    "useStorage",
    "preferStorage",
    "storageOnly",
    "allowSpecialCards",
    "ignoreEvolutions",
    "ignoreSingleRevisionPlayers",
    "ignoreImportantLeagues",
    "ignoreImportantNations",
    "untradeablesOnly",
  ].forEach((settingKey) => {
    let labelKey = "";
    switch (settingKey) {
      case "enabled":
        labelKey = settingKey;
        break;
      case "untradeablesOnly":
        labelKey = "search.sort.header";
        break;
      default:
        labelKey = "plugins.sbcSmartBuilder.settings." + settingKey;
    }
    appendToggle(container, labelKey, builderConfig[settingKey], (isChecked) => {
      if (settingKey === "useStorage" && !isChecked && builderConfig.storageOnly) {
        return false;
      }
      builderConfig[settingKey] = isChecked;
      if (settingKey === "enabled" && isChecked) {
        dispatchPaletoolsEvent(paletoolsEvents.SMART_BUILDER_ENABLED);
      }
      if (settingKey === "storageOnly" && isChecked) {
        builderConfig.useStorage = true;
      }
      if (!isChallengeConfig) {
        persistConfiguration();
      }
    });
  });
  const searchView = new UTItemSearchView();
  const searchViewModel = new UTItemSearchViewModel();
  searchView.init();
  searchView.togglePlayerNameRow(false);
  searchView.toggleEvolutionStatusFilter(false);
  searchView.togglePileFilter(false);
  searchView.toggleOvrRange(SearchType.PLAYER, ItemSearchFeature.ANY);
  if (builderConfig.ovrMin) {
    searchViewModel.searchCriteria.ovrMin = builderConfig.ovrMin;
  }
  if (builderConfig.ovrMax) {
    searchViewModel.searchCriteria.ovrMax = builderConfig.ovrMax;
  }
  searchView.setFilters(searchViewModel);
  searchView.filters.forEach((filter) => filter.hide());
  searchView.onFilterChange.observe(this, (sender, filterType, filterValue) => {
    if (filterType === enums.UISearchFilters.OVR_MIN) {
      builderConfig.ovrMin = filterValue;
    } else if (filterType === enums.UISearchFilters.OVR_MAX) {
      builderConfig.ovrMax = filterValue;
    }
    if (!builderConfig.ovrMin) {
      builderConfig.ovrMin = minOvr;
    }
    if (!builderConfig.ovrMax) {
      builderConfig.ovrMax = maxOvr;
    }
    if (!isChallengeConfig) {
      persistConfiguration();
    }
  });
  appendElements(container, searchView);
  return container;
}

sbcSmartBuilderPluginDefinition = {
  run: function () {
    let triggerSmartBuilder = null;
    listenForEvent(paletoolsEvents.CLUB_INDEX_LOADED, () => {
      document.querySelectorAll(".smart-builder-container").forEach((container) => {
        showElements(container);
      });
    });
    registerKeyboardShortcut(
      "sbcSmartBuilder",
      () => configuration.plugins.snipe.buttons.sbc.sbcSmartBuilder,
      (keyCode) => (configuration.plugins.snipe.buttons.sbc.sbcSmartBuilder = keyCode),
      "plugins.sbcSmartBuilder.settings.title",
      () => triggerSmartBuilder && triggerSmartBuilder(),
      "#sbc-smart-builder",
    );
    const originalGetView = UTSBCSquadDetailPanelViewController.prototype.getView;
    UTSBCSquadDetailPanelViewController.prototype.getView = function (...args) {
      if (sbcSmartBuilderSettings.enabled && !this.smartBuildHandled) {
        const view = originalGetView.call(this, ...args);
        this.config = (function (sbcChallengeId) {
          let savedConfigs = paletoolsStorage.get("smartBuilderConfigs") || {};
          return savedConfigs[sbcChallengeId]
            ? {
                ...structuredClone(sbcSmartBuilderSettings),
                ...savedConfigs[sbcChallengeId],
              }
            : structuredClone(sbcSmartBuilderSettings);
        })(this._challenge.id);
        view.getSmartBuilderButton().addTarget(this, this._eSmartBuilderSelected, EventType.TAP);
        view
          .getEditSmartBuilderButton()
          .addTarget(this, this._eEditSmartBuilderSelected, EventType.TAP);
        triggerSmartBuilder = () => this._eSmartBuilderSelected();
        this.smartBuildHandled = true;
      }
      return originalGetView.call(this, ...args);
    };
    UTSBCSquadDetailPanelViewController.prototype._eEditSmartBuilderSelected = function () {
      const dialog = showDialog(
        [
          {
            labelEnum: enums.UIDialogOptions.OK,
          },
          {
            labelEnum: enums.UIDialogOptions.CANCEL,
          },
        ],
        "",
        "",
        (selectedOption) => {
          if (selectedOption !== enums.UIDialogOptions.CANCEL) {
            (function (sbcChallengeId, challengeConfig) {
              let savedConfigs = paletoolsStorage.get("smartBuilderConfigs") || {};
              savedConfigs[sbcChallengeId] = challengeConfig;
              paletoolsStorage.set("smartBuilderConfigs", savedConfigs, true);
            })(this._challenge.id, this.config);
          }
        },
      );
      const settingsMenu = createSbcSmartBuilderSettingsMenu(this.config, true);
      addClasses(settingsMenu, "sbc-smart-builder-dialog");
      appendElements(dialog.getView().getContent(), settingsMenu);
    };
    UTSBCSquadDetailPanelViewController.prototype._eSmartBuilderSelected = async function (
      ...args
    ) {
      showLoadingShield();
      const squadPlayers = new Array(UTSquadEntity.TOTAL_PLAYERS);
      const saveChallenge = async () => {
        await observableToPromise(services.SBC.saveChallenge(this._challenge));
      };
      const challenge = this._challenge;
      if (!challenge.squad.isSquadEmpty()) {
        challenge.squad.removeAllItems();
        await saveChallenge();
      }
      const solution = await buildSmartBuilderSquad(challenge, this.config);
      if (solution.success) {
        const nonBrickSlots = challenge.squad.getNonBrickSlots();
        for (const player of solution.players) {
          squadPlayers[nonBrickSlots.shift().index] = player;
          if (nonBrickSlots.length === 0) {
            break;
          }
        }
        challenge.squad.setPlayers(squadPlayers);
        await saveChallenge();
      } else {
        showErrorNotification(solution.reason);
      }
      hideLoadingShield();
    };
    const originalGenerate = UTSBCSquadDetailPanelView.prototype._generate;
    UTSBCSquadDetailPanelView.prototype._generate = function () {
      originalGenerate.call(this);
      if (configuration.enabled && sbcSmartBuilderSettings.enabled && !this._smartBuilderCalled) {
        upsertStylesheet("paletools-sbc-smart-builder", sbcSmartBuilderCss);
        const container = createElement("div", {
          className: "smart-builder-container",
        });
        this._smartBuilderButton = new UTStandardButtonControl();
        this._smartBuilderButton.init();
        this._smartBuilderButton.setText(translate("plugins.sbcSmartBuilder.settings.title"));
        addClasses(this._smartBuilderButton, "primary");
        this._editSmartBuilderButton = new UTStandardButtonControl();
        this._editSmartBuilderButton.init();
        this._editSmartBuilderButton.setText(translate("edit"));
        appendElements(container, this._smartBuilderButton, this._editSmartBuilderButton);
        insertAfter(container, this._btnSquadBuilder);
        if (!isClubIndexReady()) {
          hideElements(container);
        }
        listenForEvent(paletoolsEvents.CLUB_INDEX_LOADED, () => {
          showElements(container);
        });
        this._smartBuilderCalled = true;
      }
    };
    UTSBCSquadDetailPanelView.prototype.getSmartBuilderButton = function () {
      return this._smartBuilderButton;
    };
    UTSBCSquadDetailPanelView.prototype.getEditSmartBuilderButton = function () {
      return this._editSmartBuilderButton;
    };
    const originalDestroyGeneratedElements =
      UTSBCSquadDetailPanelView.prototype.destroyGeneratedElements;
    UTSBCSquadDetailPanelView.prototype.destroyGeneratedElements = function () {
      originalDestroyGeneratedElements.call(this);
      triggerSmartBuilder = null;
      if (this._smartBuilderButton) {
        this._smartBuilderButton.destroy();
      }
      if (this._editSmartBuilderButton) {
        this._editSmartBuilderButton.destroy();
      }
    };
  },
  order: 128,
  settings: {
    name: "sbc-smart-builder",
    title: "plugins.sbcSmartBuilder.settings.title",
    menu: function () {
      return createSbcSmartBuilderSettingsMenu(sbcSmartBuilderSettings);
    },
  },
};

export const sbcSmartBuilderPlugin = sbcSmartBuilderPluginDefinition;
