/**
 * SBC template builder plugin (order 128), installed by the plugin list in src/bootstrap/boot.js:
 * per-challenge templates of squad-builder steps run one after another through the EA squad
 * builder; "edit template" (`#edit-template`) and "use template" (`#use-template`) buttons and
 * shortcuts on the SBC squad detail panel, and a global templates button on the SBC hub.
 *
 * Hooks (installed in `run()`):
 * - `UTSBCSquadDetailPanelViewController.getView`: once per controller (`templateBuilderHandled`)
 *   wires buttons and shortcuts and enables "use" only when the stored template has steps; new
 *   `_eTemplateBuilderSelected` and `_eUseTemplateSelected`.
 * - `UTSquadBuilderViewController.dismissSquadBuilder` (after the original: hides the loading
 *   shield, continues the run) and `onClubSearchComplete` (replaced while a run has steps left
 *   and the search returned no items).
 * - `UTSBCSquadDetailPanelView._generate`/`destroyGeneratedElements` and new getters;
 *   `UTSBCHubView.populateNavigation` adds the global templates button once per view (not gated
 *   by `enabled`).
 *
 * Invariants:
 * - A run (`sbcTemplateData` = `{set, challenge, filters, exclusions, navigationController}`)
 *   shifts one step at a time into a new `UTSquadBuilderViewController` with `viewModelOverrides`
 *   (criteria plus step settings), `sbcTemplateData`, `ignorePosition` (from `ignorePlayerPos`)
 *   and `dontShowNoPlayersFoundWarning = true`, pushes it and calls `eBuildSelected()`. It relies
 *   on the sbc-builder-enhancer `init`/`eBuildSelected` overrides honoring those fields.
 * - The run stops when the steps are exhausted or, with `stopOnRequirementsMet`, when
 *   `challenge.meetsRequirements()`; on phone the last dismiss pushes a new
 *   `UTSBCSquadOverviewViewController`. Empty results skip to the next step with the
 *   `popup.title.noSquadBuilderResults` notification.
 * - Shortcuts `buildUsingTemplate` and `editTemplate` (keys `snipe.buttons.sbc.useTemplate` /
 *   `editTemplate`); configuration `plugins.sbcTemplateBuilder.{enabled, stopOnRequirementsMet}`.
 *
 * Known issues (kept as-is):
 * - `getView` wires the template buttons when only the plugin flag holds, but `_generate` creates
 *   them only when Paletools is enabled too; with Paletools disabled `.addTarget` throws.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import {
  accessAttribute,
  addClasses,
  appendElements,
  insertAfter,
  insertBefore,
  queryElement,
  setStyles,
} from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { GlobalSbcTemplatesViewController } from "./global-templates-view-controller.js";
import { SbcTemplateFilter } from "./models.js";
import { loadSbcChallengeTemplate } from "./storage.js";
import { SbcTemplateEditorViewController } from "./template-editor-view-controller.js";
import {
  isSearchFilterDropdownOpen,
  registerKeyboardShortcut,
} from "../../ui/keyboard-shortcuts.js";
import { showNeutralNotification } from "../../ui/notifications.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { hideLoadingShield, showLoadingShield } from "../../webapp/loading-shield.js";
import { getActiveNavigationController } from "../../webapp/navigation.js";

let sbcTemplateBuilderPluginDefinition;

const sbcTemplateBuilderSettings = configuration.plugins.sbcTemplateBuilder;

sbcTemplateBuilderPluginDefinition = {
  run: function () {
    let useTemplateShortcutAction = null;
    let editTemplateShortcutAction = null;
    registerKeyboardShortcut(
      "buildUsingTemplate",
      () => configuration.plugins.snipe.buttons.sbc.useTemplate,
      (keyCode) => (configuration.plugins.snipe.buttons.sbc.useTemplate = keyCode),
      "plugins.sbcTemplateBuilder.buttons.use",
      () => useTemplateShortcutAction && useTemplateShortcutAction(),
      "#use-template",
    );
    registerKeyboardShortcut(
      "editTemplate",
      () => configuration.plugins.snipe.buttons.sbc.editTemplate,
      (keyCode) => (configuration.plugins.snipe.buttons.sbc.editTemplate = keyCode),
      "plugins.sbcTemplateBuilder.buttons.edit",
      () => editTemplateShortcutAction && editTemplateShortcutAction(),
      "#edit-template",
    );
    const originalGetView = UTSBCSquadDetailPanelViewController.prototype.getView;
    function runNextSbcTemplateFilter(sbcTemplateData) {
      hideLoadingShield();
      if (
        !sbcTemplateData ||
        sbcTemplateData.filters.length === 0 ||
        (sbcTemplateBuilderSettings.stopOnRequirementsMet &&
          sbcTemplateData.challenge.meetsRequirements())
      ) {
        return;
      }
      showLoadingShield();
      let nextFilter = sbcTemplateData.filters.shift();
      nextFilter = new SbcTemplateFilter(nextFilter.searchCriteria, nextFilter.searchSettings);
      const squadBuilderController = new UTSquadBuilderViewController();
      squadBuilderController.viewModelOverrides = new UTItemSearchViewModel();
      squadBuilderController.viewModelOverrides.searchCriteria.update(nextFilter.searchCriteria);
      squadBuilderController.viewModelOverrides.searchSettings = nextFilter.searchSettings;
      squadBuilderController.sbcTemplateData = sbcTemplateData;
      squadBuilderController.ignorePosition = nextFilter.searchSettings.ignorePlayerPos;
      squadBuilderController.initWithChallenge(sbcTemplateData.challenge);
      if (nextFilter.searchCriteria.untradeables === SearchUntradeables.ONLY) {
        squadBuilderController
          .getView()
          ._searchOptions.toggleById(enums.UISortOptionType.UNTRADEABLE);
      }
      sbcTemplateData.navigationController.pushViewController(squadBuilderController, true);
      squadBuilderController.dontShowNoPlayersFoundWarning = true;
      squadBuilderController.eBuildSelected();
      hideLoadingShield();
    }
    UTSBCSquadDetailPanelViewController.prototype.getView = function (...args) {
      const squadDetailPanelView = originalGetView.call(this, ...args);
      if (sbcTemplateBuilderSettings.enabled) {
        if (!this.templateBuilderHandled) {
          useTemplateShortcutAction = () =>
            squadDetailPanelView &&
            squadDetailPanelView.getRootElement() &&
            !isSearchFilterDropdownOpen() &&
            this._eUseTemplateSelected();
          editTemplateShortcutAction = () =>
            squadDetailPanelView &&
            squadDetailPanelView.getRootElement() &&
            !isSearchFilterDropdownOpen() &&
            this._eTemplateBuilderSelected();
          squadDetailPanelView
            .getTemplateBuilderButton()
            .addTarget(this, this._eTemplateBuilderSelected, EventType.TAP);
          squadDetailPanelView
            .getUseTemplateButton()
            .addTarget(this, this._eUseTemplateSelected, EventType.TAP);
          this.templateBuilderHandled = true;
          loadSbcChallengeTemplate(this._set, this._challenge).then((storedTemplate) => {
            squadDetailPanelView
              .getUseTemplateButton()
              .setInteractionState(
                storedTemplate && storedTemplate.steps && storedTemplate.steps.length > 0,
              );
          });
        }
        return squadDetailPanelView;
      } else {
        return squadDetailPanelView;
      }
    };
    UTSBCSquadDetailPanelViewController.prototype._eTemplateBuilderSelected = function (...args) {
      loadSbcChallengeTemplate(this._set, this._challenge).then((storedTemplate) => {
        const templateEditorController = new SbcTemplateEditorViewController(
          this._set,
          this._challenge,
          storedTemplate && storedTemplate.globalTemplateId,
        );
        templateEditorController.init();
        getActiveNavigationController().pushViewController(templateEditorController);
      });
    };
    UTSBCSquadDetailPanelViewController.prototype._eUseTemplateSelected = function (...args) {
      loadSbcChallengeTemplate(this._set, this._challenge).then((storedTemplate) => {
        if (storedTemplate != null) {
          runNextSbcTemplateFilter({
            set: this._set,
            challenge: this._challenge,
            filters: storedTemplate.steps,
            exclusions: storedTemplate.exclusions,
            navigationController: this.getNavigationController(),
          });
        }
      });
    };
    const originalDismissSquadBuilder = UTSquadBuilderViewController.prototype.dismissSquadBuilder;
    UTSquadBuilderViewController.prototype.dismissSquadBuilder = function (...args) {
      originalDismissSquadBuilder.call(this, ...args);
      hideLoadingShield();
      if (this.sbcTemplateData) {
        if (this.sbcTemplateData.set && this.sbcTemplateData.filters.length === 0 && isPhone()) {
          const squadOverviewController = new UTSBCSquadOverviewViewController();
          squadOverviewController.initWithSBCSet(
            this.sbcTemplateData.set,
            this.sbcTemplateData.challenge.id,
          );
          return void getActiveNavigationController().pushViewController(squadOverviewController);
        }
        runNextSbcTemplateFilter(this.sbcTemplateData);
      }
    };
    const originalOnClubSearchComplete =
      UTSquadBuilderViewController.prototype.onClubSearchComplete;
    UTSquadBuilderViewController.prototype.onClubSearchComplete = function (...args) {
      const searchResponse = args[1];
      if (
        this.sbcTemplateData &&
        this.sbcTemplateData.filters.length > 0 &&
        searchResponse.success &&
        searchResponse.response.items &&
        searchResponse.response.items.length === 0
      ) {
        this.sbcTemplateData.navigationController.popViewController();
        runNextSbcTemplateFilter(this.sbcTemplateData);
        showNeutralNotification(translate("popup.title.noSquadBuilderResults"));
      } else {
        originalOnClubSearchComplete.call(this, ...args);
      }
    };
    const originalGenerate = UTSBCSquadDetailPanelView.prototype._generate;
    UTSBCSquadDetailPanelView.prototype._generate = function () {
      originalGenerate.call(this);
      if (
        configuration.enabled &&
        sbcTemplateBuilderSettings.enabled &&
        !this._templateBuilderCalled
      ) {
        this._templateBuilderButton = new UTStandardButtonControl();
        this._templateBuilderButton.init();
        this._templateBuilderButton.setText(translate("plugins.sbcTemplateBuilder.buttons.edit"));
        accessAttribute(this._templateBuilderButton, "id", "edit-template");
        this._useTemplateButton = new UTStandardButtonControl();
        this._useTemplateButton.init();
        this._useTemplateButton.setText(translate("plugins.sbcTemplateBuilder.buttons.use"));
        this._useTemplateButton.setInteractionState(false);
        accessAttribute(this._useTemplateButton, "id", "use-template");
        insertAfter(this._useTemplateButton, this._btnSquadBuilder);
        appendElements(
          queryElement(".sbc-button-container", this.__content),
          this._templateBuilderButton,
        );
        this._templateBuilderCalled = true;
      }
    };
    UTSBCSquadDetailPanelView.prototype.getTemplateBuilderButton = function () {
      return this._templateBuilderButton;
    };
    UTSBCSquadDetailPanelView.prototype.getUseTemplateButton = function () {
      return this._useTemplateButton;
    };
    const originalDestroyGeneratedElements =
      UTSBCSquadDetailPanelView.prototype.destroyGeneratedElements;
    UTSBCSquadDetailPanelView.prototype.destroyGeneratedElements = function () {
      originalDestroyGeneratedElements.call(this);
      useTemplateShortcutAction = editTemplateShortcutAction = null;
      if (this._templateBuilderButton) {
        this._templateBuilderButton.destroy();
      }
      if (this._useTemplateButton) {
        this._useTemplateButton.destroy();
      }
    };
    const originalPopulateNavigation = UTSBCHubView.prototype.populateNavigation;
    UTSBCHubView.prototype.populateNavigation = function (...args) {
      originalPopulateNavigation.call(this, ...args);
      if (this._templatesButton) {
        return;
      }
      const templatesButton = new UTStandardButtonControl();
      templatesButton.init();
      templatesButton.setText(translate("plugins.sbcTemplateBuilder.buttons.global"));
      addClasses(templatesButton, "primary", "mini");
      setStyles(templatesButton, {
        marginRight: "16px",
        display: "inline-block",
      });
      templatesButton.addTarget(
        this,
        () => {
          const globalTemplatesController = new GlobalSbcTemplatesViewController();
          globalTemplatesController.init();
          getActiveNavigationController().pushViewController(globalTemplatesController);
        },
        EventType.TAP,
      );
      insertBefore(templatesButton, this._SBCCategoriesTM.items[0]);
      this._templatesButton = templatesButton;
    };
  },
  order: 128,
  settings: {
    name: "sbc-template-builder",
    title: "plugins.sbcTemplateBuilder.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", sbcTemplateBuilderSettings.enabled, (isEnabled) => {
        sbcTemplateBuilderSettings.enabled = isEnabled;
        persistConfiguration();
      });
      appendToggle(
        container,
        "plugins.sbcTemplateBuilder.settings.stopOnRequirementsMet",
        sbcTemplateBuilderSettings.stopOnRequirementsMet,
        (stopOnRequirementsMet) => {
          sbcTemplateBuilderSettings.stopOnRequirementsMet = stopOnRequirementsMet;
          persistConfiguration();
        },
      );
      return container;
    },
  },
};

export const sbcTemplateBuilderPlugin = sbcTemplateBuilderPluginDefinition;
