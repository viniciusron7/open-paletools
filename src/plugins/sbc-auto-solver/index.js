/**
 * SBC auto solver plugin (order 130, disabled by default), installed by the plugin list in
 * src/bootstrap/boot.js: "auto solve" buttons on SBC set tiles and one-click SBC screens that
 * call `openSbcAutoSolverDialog` (dialog.js), the settings page and the settings migration.
 *
 * Hooks (installed in `run()` with `hookPrototypeMethod`, which wraps the implementation present
 * at that moment, i.e. after src/webapp/patches.js and the lower-order SBC plugins):
 * - `UTOneClickSBCWorkAreaViewController` / `UTOneClickSBCRequirementsViewController` (only if
 *   defined): after `viewDidAppear` adds a mini button to
 *   `.ut-one-click-sbc-work-area-view--toolbar-actions` / `footer`; before `dealloc` sets
 *   `_sbcAutoSolverDisposed` and destroys it.
 * - `UTOneClickSBCWorkAreaViewModel._buildCriteria`, after: sets `hideLocked = true` on the
 *   returned criteria (an after-hook's last argument is the result), even when disabled.
 * - `UTSBCSetsViewModel.resetCollections`, before: deletes per-set preferences of set ids missing
 *   from the first argument (assumed to be the full list of sets).
 * - `UTSBCSetTileView`: `_generate` after (button after `.sbc-status-container`, once via
 *   `_sbcAutoSolverGenerated`), `render` after (visibility), `destroyGeneratedElements` before
 *   (untrack) and after (destroy).
 *
 * Invariants:
 * - `run()` always migrates the stored settings and persists when something changed, whatever
 *   `enabled` says: it turns a stored `challengeOrderPreferences` into `reverseSolvePreferences`,
 *   deletes `challengeOrder`/`ovrMin`/`ovrMax` and normalizes `submitDelay`. The branches that
 *   create missing per-set maps, derive `reverseSolve` from `challengeOrder` and fill boolean
 *   defaults test for keys that src/config/defaults.js already defines, so (except for a stored
 *   null map) they never fire and a stored `challengeOrder` is only deleted, never converted.
 * - Buttons work only when Paletools and the plugin are enabled and `isClubIndexReady()`; tile
 *   buttons also need `challengesCount > 0` and an incomplete set. CLUB_INDEX_LOADED refreshes
 *   them.
 * - Enabling in the settings requires `confirm(translate("plugins.dangerous"))` and dispatches
 *   SBC_AUTO_SOLVER_ENABLED, on which the club-index plugin enables the club index.
 * - Stylesheet `paletools-sbc-auto-solver`; button text `plugins.sbcAutoSolver.button`.
 */
import { isClubIndexReady } from "../../club/club-index.js";
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { addClasses, appendElements, insertAfter, queryElement } from "../../core/dom.js";
import { dispatchPaletoolsEvent, listenForEvent, paletoolsEvents } from "../../core/events.js";
import { hookPrototypeMethod } from "../../core/prototype-override.js";
import { translate } from "../../i18n/translations.js";
import { openSbcAutoSolverDialog } from "./dialog.js";
import { isSbcAutoSolverEnabled } from "./one-click-solver.js";
import {
  getSbcAutoSolverSetKey,
  normalizeSbcAutoSolverSubmitDelay,
  sbcAutoSolverSettings,
  sbcAutoSolverSubmitDelayOptions,
} from "./settings.js";
import { appendDropdown, appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import sbcAutoSolverStyles from "./sbc-auto-solver.css";

let sbcAutoSolverPluginDefinition;

sbcAutoSolverPluginDefinition = {
  run: function () {
    upsertStylesheet("paletools-sbc-auto-solver", sbcAutoSolverStyles);
    (function () {
      let hasSettingsChanged = false;
      if (!sbcAutoSolverSettings.ratingRanges) {
        sbcAutoSolverSettings.ratingRanges = {};
        hasSettingsChanged = true;
      }
      if (!sbcAutoSolverSettings.storagePreferences) {
        sbcAutoSolverSettings.storagePreferences = {};
        hasSettingsChanged = true;
      }
      if (!sbcAutoSolverSettings.storageOnlyPreferences) {
        sbcAutoSolverSettings.storageOnlyPreferences = {};
        hasSettingsChanged = true;
      }
      if (!sbcAutoSolverSettings.allowSpecialCardsPreferences) {
        sbcAutoSolverSettings.allowSpecialCardsPreferences = {};
        hasSettingsChanged = true;
      }
      if (!sbcAutoSolverSettings.untradeablesOnlyPreferences) {
        sbcAutoSolverSettings.untradeablesOnlyPreferences = {};
        hasSettingsChanged = true;
      }
      if (!sbcAutoSolverSettings.reverseSolvePreferences) {
        sbcAutoSolverSettings.reverseSolvePreferences = {};
        hasSettingsChanged = true;
      }
      if (sbcAutoSolverSettings.reverseSolve === undefined) {
        sbcAutoSolverSettings.reverseSolve = sbcAutoSolverSettings.challengeOrder === "highToLow";
        hasSettingsChanged = true;
      }
      if (sbcAutoSolverSettings.challengeOrderPreferences) {
        for (const [setKey, challengeOrder] of Object.entries(
          sbcAutoSolverSettings.challengeOrderPreferences,
        )) {
          sbcAutoSolverSettings.reverseSolvePreferences[setKey] = challengeOrder === "highToLow";
        }
        delete sbcAutoSolverSettings.challengeOrderPreferences;
        hasSettingsChanged = true;
      }
      if (sbcAutoSolverSettings.challengeOrder !== undefined) {
        delete sbcAutoSolverSettings.challengeOrder;
        hasSettingsChanged = true;
      }
      if (!sbcAutoSolverSettings.submitDelayPreferences) {
        sbcAutoSolverSettings.submitDelayPreferences = {};
        hasSettingsChanged = true;
      }
      if (
        normalizeSbcAutoSolverSubmitDelay(sbcAutoSolverSettings.submitDelay) !==
        sbcAutoSolverSettings.submitDelay
      ) {
        sbcAutoSolverSettings.submitDelay = 1;
        hasSettingsChanged = true;
      }
      if (!sbcAutoSolverSettings.ignoreEvolutionsPreferences) {
        sbcAutoSolverSettings.ignoreEvolutionsPreferences = {};
        hasSettingsChanged = true;
      }
      if (!sbcAutoSolverSettings.ignoreSingleRevisionPreferences) {
        sbcAutoSolverSettings.ignoreSingleRevisionPreferences = {};
        hasSettingsChanged = true;
      }
      if (sbcAutoSolverSettings.storageOnly === undefined) {
        sbcAutoSolverSettings.storageOnly = false;
        hasSettingsChanged = true;
      }
      if (sbcAutoSolverSettings.allowSpecialCards === undefined) {
        sbcAutoSolverSettings.allowSpecialCards = true;
        hasSettingsChanged = true;
      }
      if (sbcAutoSolverSettings.untradeablesOnly === undefined) {
        sbcAutoSolverSettings.untradeablesOnly = false;
        hasSettingsChanged = true;
      }
      if (sbcAutoSolverSettings.ignoreEvolutions === undefined) {
        sbcAutoSolverSettings.ignoreEvolutions = true;
        hasSettingsChanged = true;
      }
      if (sbcAutoSolverSettings.ignoreSingleRevisionPlayers === undefined) {
        sbcAutoSolverSettings.ignoreSingleRevisionPlayers = false;
        hasSettingsChanged = true;
      }
      if (sbcAutoSolverSettings.ovrMin !== undefined) {
        delete sbcAutoSolverSettings.ovrMin;
        hasSettingsChanged = true;
      }
      if (sbcAutoSolverSettings.ovrMax !== undefined) {
        delete sbcAutoSolverSettings.ovrMax;
        hasSettingsChanged = true;
      }
      if (hasSettingsChanged) {
        persistConfiguration();
      }
    })();
    (function (openDialog) {
      const oneClickAutoSolveButtons = new Set();
      listenForEvent(paletoolsEvents.CLUB_INDEX_LOADED, () => {
        oneClickAutoSolveButtons.forEach((button) =>
          button.setInteractionState(isSbcAutoSolverEnabled() && isClubIndexReady()),
        );
      });
      const installOneClickAutoSolveButton = (
        controllerClass,
        getWorkAreaController,
        containerSelector,
      ) => {
        hookPrototypeMethod(controllerClass, "viewDidAppear", null, function () {
          const workAreaController = getWorkAreaController(this);
          const viewModel = workAreaController?.getViewModel();
          if (viewModel) {
            if (!this._sbcAutoSolveButton) {
              const buttonContainer = queryElement(containerSelector, this.getView());
              if (!buttonContainer) {
                return;
              }
              const sbcAutoSolveButton = new UTStandardButtonControl();
              sbcAutoSolveButton.init();
              sbcAutoSolveButton.setText(translate("plugins.sbcAutoSolver.button"));
              addClasses(sbcAutoSolveButton, "mini", "sbc-one-click-auto-solve-button");
              sbcAutoSolveButton.addTarget(
                this,
                () => {
                  if (!isSbcAutoSolverEnabled() || !isClubIndexReady()) {
                    return;
                  }
                  const currentWorkAreaController = getWorkAreaController(this);
                  const currentViewModel = currentWorkAreaController?.getViewModel();
                  if (currentViewModel && !currentViewModel.getChallenge().isCompleted()) {
                    openDialog(currentViewModel.getSet(), {
                      workArea: currentWorkAreaController,
                      challengeId: currentViewModel.getChallenge().id,
                    });
                  }
                },
                EventType.TAP,
              );
              appendElements(buttonContainer, sbcAutoSolveButton);
              this._sbcAutoSolveButton = sbcAutoSolveButton;
              oneClickAutoSolveButtons.add(sbcAutoSolveButton);
            }
            if (isSbcAutoSolverEnabled() && !viewModel.getChallenge().isCompleted()) {
              showElements(this._sbcAutoSolveButton);
              this._sbcAutoSolveButton.setInteractionState(isClubIndexReady());
            } else {
              hideElements(this._sbcAutoSolveButton);
            }
          }
        });
        hookPrototypeMethod(controllerClass, "dealloc", function () {
          this._sbcAutoSolverDisposed = true;
          oneClickAutoSolveButtons.delete(this._sbcAutoSolveButton);
          this._sbcAutoSolveButton?.destroy();
          this._sbcAutoSolveButton = null;
        });
      };
      if (typeof UTOneClickSBCWorkAreaViewController !== "undefined") {
        installOneClickAutoSolveButton(
          UTOneClickSBCWorkAreaViewController,
          (controller) => controller,
          ".ut-one-click-sbc-work-area-view--toolbar-actions",
        );
      }
      if (typeof UTOneClickSBCRequirementsViewController !== "undefined") {
        installOneClickAutoSolveButton(
          UTOneClickSBCRequirementsViewController,
          (controller) => controller.requirementsDelegate?.workAreaController,
          "footer",
        );
      }
      hookPrototypeMethod(
        UTOneClickSBCWorkAreaViewModel,
        "_buildCriteria",
        null,
        function (...args) {
          args[args.length - 1].hideLocked = true;
        },
      );
    })(openSbcAutoSolverDialog);
    const setTileViews = new Set();
    const updateSetTileAutoSolveButton = (tileView) => {
      if (!tileView._sbcAutoSolveButton) {
        return;
      }
      const sbcSet = tileView.data;
      if (
        configuration.enabled &&
        sbcAutoSolverSettings.enabled &&
        isClubIndexReady() &&
        sbcSet &&
        sbcSet.challengesCount > 0 &&
        !sbcSet.isComplete()
      ) {
        showElements(tileView._sbcAutoSolveButton);
      } else {
        hideElements(tileView._sbcAutoSolveButton);
      }
    };
    listenForEvent(paletoolsEvents.CLUB_INDEX_LOADED, () => {
      setTileViews.forEach(updateSetTileAutoSolveButton);
    });
    hookPrototypeMethod(UTSBCSetsViewModel, "resetCollections", function (sets) {
      (function (sets) {
        const currentSetKeys = new Set(sets.map((sbcSet) => getSbcAutoSolverSetKey(sbcSet)));
        let hasRemovedPreferences = false;
        [
          sbcAutoSolverSettings.ratingRanges,
          sbcAutoSolverSettings.storagePreferences,
          sbcAutoSolverSettings.storageOnlyPreferences,
          sbcAutoSolverSettings.allowSpecialCardsPreferences,
          sbcAutoSolverSettings.untradeablesOnlyPreferences,
          sbcAutoSolverSettings.reverseSolvePreferences,
          sbcAutoSolverSettings.submitDelayPreferences,
          sbcAutoSolverSettings.ignoreEvolutionsPreferences,
          sbcAutoSolverSettings.ignoreSingleRevisionPreferences,
        ].forEach((preferencesBySetKey) => {
          if (preferencesBySetKey) {
            for (const setKey of Object.keys(preferencesBySetKey)) {
              if (!currentSetKeys.has(setKey)) {
                delete preferencesBySetKey[setKey];
                hasRemovedPreferences = true;
              }
            }
          }
        });
        if (hasRemovedPreferences) {
          persistConfiguration();
        }
      })(sets || []);
    });
    hookPrototypeMethod(UTSBCSetTileView, "_generate", null, function () {
      if (
        !configuration.enabled ||
        !sbcAutoSolverSettings.enabled ||
        this._sbcAutoSolverGenerated
      ) {
        return;
      }
      const statusContainer = queryElement(".sbc-status-container", this);
      if (statusContainer) {
        this._sbcAutoSolveButton = new UTStandardButtonControl();
        this._sbcAutoSolveButton.init();
        this._sbcAutoSolveButton.setText(translate("plugins.sbcAutoSolver.button"));
        addClasses(this._sbcAutoSolveButton, "primary", "mini", "sbc-auto-solve-button");
        this._sbcAutoSolveButton.addTarget(
          this,
          () => {
            openSbcAutoSolverDialog(this.data);
          },
          EventType.TAP,
        );
        insertAfter(this._sbcAutoSolveButton, statusContainer);
        this._sbcAutoSolverGenerated = true;
        setTileViews.add(this);
        updateSetTileAutoSolveButton(this);
      }
    });
    hookPrototypeMethod(UTSBCSetTileView, "render", null, function () {
      updateSetTileAutoSolveButton(this);
    });
    hookPrototypeMethod(
      UTSBCSetTileView,
      "destroyGeneratedElements",
      function () {
        setTileViews.delete(this);
      },
      function () {
        if (this._sbcAutoSolveButton) {
          this._sbcAutoSolveButton.destroy();
        }
      },
    );
  },
  order: 130,
  settings: {
    name: "sbc-auto-solver",
    title: "plugins.sbcAutoSolver.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", sbcAutoSolverSettings.enabled, (isEnabled) => {
        if (isEnabled && !confirm(translate("plugins.dangerous"))) {
          return false;
        }
        sbcAutoSolverSettings.enabled = isEnabled;
        if (isEnabled) {
          dispatchPaletoolsEvent(paletoolsEvents.SBC_AUTO_SOLVER_ENABLED);
        }
        persistConfiguration();
      });
      appendToggle(
        container,
        "plugins.sbcAutoSolver.settings.preferStorage",
        sbcAutoSolverSettings.preferStorage,
        (preferStorage) => {
          sbcAutoSolverSettings.preferStorage = preferStorage;
          persistConfiguration();
        },
      );
      appendToggle(
        container,
        "plugins.sbcAutoSolver.settings.storageOnly",
        sbcAutoSolverSettings.storageOnly,
        (storageOnly) => {
          sbcAutoSolverSettings.storageOnly = storageOnly;
          persistConfiguration();
        },
      );
      appendToggle(
        container,
        "plugins.sbcAutoSolver.settings.allowSpecialCards",
        sbcAutoSolverSettings.allowSpecialCards !== false,
        (allowSpecialCards) => {
          sbcAutoSolverSettings.allowSpecialCards = allowSpecialCards;
          persistConfiguration();
        },
      );
      appendToggle(
        container,
        "plugins.sbcAutoSolver.settings.untradeablesOnly",
        sbcAutoSolverSettings.untradeablesOnly === true,
        (untradeablesOnly) => {
          sbcAutoSolverSettings.untradeablesOnly = untradeablesOnly;
          persistConfiguration();
        },
      );
      appendDropdown(
        container,
        "plugins.sbcAutoSolver.settings.submitDelay",
        sbcAutoSolverSubmitDelayOptions,
        normalizeSbcAutoSolverSubmitDelay(sbcAutoSolverSettings.submitDelay),
        (submitDelay) => {
          sbcAutoSolverSettings.submitDelay = normalizeSbcAutoSolverSubmitDelay(submitDelay);
          persistConfiguration();
        },
      );
      appendToggle(
        container,
        "plugins.sbcAutoSolver.settings.ignoreEvolutions",
        sbcAutoSolverSettings.ignoreEvolutions !== false,
        (ignoreEvolutions) => {
          sbcAutoSolverSettings.ignoreEvolutions = ignoreEvolutions;
          persistConfiguration();
        },
      );
      appendToggle(
        container,
        "plugins.sbcAutoSolver.settings.ignoreSingleRevisionPlayers",
        sbcAutoSolverSettings.ignoreSingleRevisionPlayers,
        (ignoreSingleRevisionPlayers) => {
          sbcAutoSolverSettings.ignoreSingleRevisionPlayers = ignoreSingleRevisionPlayers;
          persistConfiguration();
        },
      );
      appendToggle(
        container,
        "plugins.sbcAutoSolver.settings.reverseSolve",
        sbcAutoSolverSettings.reverseSolve === true,
        (reverseSolve) => {
          sbcAutoSolverSettings.reverseSolve = reverseSolve;
          persistConfiguration();
        },
      );
      return container;
    },
  },
};

export const sbcAutoSolverPlugin = sbcAutoSolverPluginDefinition;
