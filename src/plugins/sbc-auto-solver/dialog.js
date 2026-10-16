/**
 * `openSbcAutoSolverDialog(sbcSet, {workArea, challengeId})`: options dialog and solve
 * orchestration of the SBC auto solver, opened by the buttons that index.js adds to SBC set tiles
 * and one-click screens.
 *
 * Invariants:
 * - Options come from the per-set preferences (`*Preferences[setKey]`, `ratingRanges`) with the
 *   global settings as fallback; each toggle persists its per-set value immediately (the map
 *   `ignoreSingleRevisionPreferences` keeps that exact name).
 * - One-click sets (`isOneClickSBC()`): challenges are loaded before the dialog; submit delay and
 *   reverse-solve are hidden. OK reloads the challenge (cache reset), initiates it if not
 *   started, solves it and pushes `OneClickSbcSplitViewController` with plan `{set, challenge,
 *   options, target, solutions, submittedScore, scoreRequirement, selectedIndex: null,
 *   invalidated: false}`. `isActive` = plugin enabled and the navigation controller still shows
 *   the controller that was current when the dialog opened.
 * - Repetition mode: first stores unassigned duplicates in SBC storage and moves the other
 *   unassigned items to the club (`moveUnassignedItemsToClub(null, true)`), loads the incomplete
 *   challenges (reversed with `reverseSolve`), solves repetitions x challenges with
 *   `buildSmartBuilderSquad` excluding used item keys and refusing concept players, then pushes
 *   `SbcAutoSolverPreviewViewController`. Multi-challenge sets skip failing challenges
 *   (`partialSolve`); single-challenge sets stop with a partial plan or an error. Nothing is
 *   submitted before the preview's confirm.
 * - Repetitions can be chosen only for repeatable, non one-click sets whose remaining count is
 *   not 1; "all" = `repeats - timesCompleted`, otherwise 1..999 or the remaining count.
 * - Translations under `plugins.sbcAutoSolver.dialog/errors/notifications`; root id
 *   `sbc-auto-solver-dialog`.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { toArray } from "../../core/collections.js";
import { appendElements, createElement } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import {
  assertSbcAutoSolverActive,
  findOneClickSbcScoreSolutions,
  getOneClickSbcRemainingScore,
  getOneClickSbcSubmitLimit,
  isSbcAutoSolverEnabled,
  loadOneClickSbcCandidatePlayers,
  loadOneClickSbcChallenges,
  throwOneClickSbcError,
} from "./one-click-solver.js";
import { OneClickSbcSplitViewController, showOneClickSbcError } from "./one-click-view.js";
import { SbcAutoSolverPreviewViewController } from "./preview-view.js";
import {
  buildSbcAutoSolvePlan,
  buildSbcRepetitionSolveOptions,
  getSbcChallengeTargetRating,
  isConceptPlayerItem,
  noRepetitionsWithoutConceptPlayersMessage,
  normalizeSbcRepetitionSubmitDelay,
} from "./repetition-solver.js";
import {
  getSbcAutoSolverSetKey,
  normalizeSbcAutoSolverOvrRange,
  normalizeSbcAutoSolverSubmitDelay,
  saveSbcAutoSolverRatingRange,
  sbcAutoSolverSettings,
  sbcAutoSolverSubmitDelayOptions,
} from "./settings.js";
import { buildSmartBuilderSquad, getSbcItemInstanceKey } from "../../sbc/smart-builder-solver.js";
import { DropdownControl } from "../../ui/controls/dropdown-control.js";
import { NumericSpinnerControl } from "../../ui/controls/numeric-spinner-control.js";
import { showDialog } from "../../ui/dialog.js";
import { createStaticNotification, showErrorNotification } from "../../ui/notifications.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import { moveUnassignedItemsToClub } from "../../webapp/item-piles.js";
import { hideLoadingShield, showLoadingShield } from "../../webapp/loading-shield.js";
import { getActiveNavigationController } from "../../webapp/navigation.js";
import { observableToPromise } from "../../webapp/observable.js";

export async function openSbcAutoSolverDialog(sbcSet, oneClickOptions = {}) {
  if (!configuration.enabled || !sbcAutoSolverSettings.enabled) {
    return;
  }
  const isOneClick = sbcSet.isOneClickSBC?.() === true;
  const navigationController = getActiveNavigationController();
  const currentController = navigationController.getCurrentController();
  const isDialogContextActive = () =>
    isSbcAutoSolverEnabled() && navigationController.getCurrentController() === currentController;
  let challengeDropDown;
  let oneClickChallenges = [];
  if (isOneClick) {
    showLoadingShield();
    try {
      const loadResult = await loadOneClickSbcChallenges(sbcSet, isDialogContextActive);
      sbcSet = loadResult.set;
      oneClickChallenges =
        oneClickOptions.challengeId == null
          ? loadResult.challenges
          : loadResult.challenges.filter(
              (challenge) => String(challenge.id) === String(oneClickOptions.challengeId),
            );
      if (!oneClickChallenges.length) {
        throw Object.assign(new Error("noChallenges"), {
          code: "noChallenges",
        });
      }
    } catch (error) {
      return void showOneClickSbcError(error);
    } finally {
      hideLoadingShield();
    }
  }
  const isNonRepeatable = sbcSet?.repeatabilityMode === SBCRepeatabilityMode.NON_REPEATABLE;
  const isUnlimited = sbcSet?.repeatabilityMode === SBCRepeatabilityMode.UNLIMITED;
  const remainingRepetitions = (function (sbcSet) {
    const maxRepeats = (function (sbcSet) {
      const repeats = sbcSet?.repeats;
      return typeof repeats === "number" && Number.isFinite(repeats) && repeats > 0
        ? repeats
        : null;
    })(sbcSet);
    return maxRepeats === null ? null : Math.max(0, maxRepeats - (sbcSet?.timesCompleted || 0));
  })(sbcSet);
  const canChooseRepetitions = !isOneClick && !isNonRepeatable && remainingRepetitions !== 1;
  let repetitionModeDropDown;
  let repetitionCountInput;
  let ovrRange = (function (sbcSet) {
    const savedRange = sbcAutoSolverSettings.ratingRanges?.[getSbcAutoSolverSetKey(sbcSet)];
    return normalizeSbcAutoSolverOvrRange(savedRange?.ovrMin, savedRange?.ovrMax);
  })(sbcSet);
  let preferStorage = (function (sbcSet) {
    const savedPreference =
      sbcAutoSolverSettings.storagePreferences?.[getSbcAutoSolverSetKey(sbcSet)];
    return typeof savedPreference === "boolean"
      ? savedPreference
      : sbcAutoSolverSettings.preferStorage === true;
  })(sbcSet);
  let storageOnly = (function (sbcSet) {
    const savedPreference =
      sbcAutoSolverSettings.storageOnlyPreferences?.[getSbcAutoSolverSetKey(sbcSet)];
    return typeof savedPreference === "boolean"
      ? savedPreference
      : sbcAutoSolverSettings.storageOnly === true;
  })(sbcSet);
  let allowSpecialCards = (function (sbcSet) {
    const savedPreference =
      sbcAutoSolverSettings.allowSpecialCardsPreferences?.[getSbcAutoSolverSetKey(sbcSet)];
    return typeof savedPreference === "boolean"
      ? savedPreference
      : sbcAutoSolverSettings.allowSpecialCards !== false;
  })(sbcSet);
  let untradeablesOnly = (function (sbcSet) {
    const savedPreference =
      sbcAutoSolverSettings.untradeablesOnlyPreferences?.[getSbcAutoSolverSetKey(sbcSet)];
    return typeof savedPreference === "boolean"
      ? savedPreference
      : sbcAutoSolverSettings.untradeablesOnly === true;
  })(sbcSet);
  let reverseSolve = (function (sbcSet) {
    const savedPreference =
      sbcAutoSolverSettings.reverseSolvePreferences?.[getSbcAutoSolverSetKey(sbcSet)];
    return typeof savedPreference === "boolean"
      ? savedPreference
      : sbcAutoSolverSettings.reverseSolve === true;
  })(sbcSet);
  let submitDelay = (function (sbcSet) {
    const savedPreference =
      sbcAutoSolverSettings.submitDelayPreferences?.[getSbcAutoSolverSetKey(sbcSet)];
    return normalizeSbcAutoSolverSubmitDelay(savedPreference ?? sbcAutoSolverSettings.submitDelay);
  })(sbcSet);
  let ignoreEvolutions = (function (sbcSet) {
    const savedPreference =
      sbcAutoSolverSettings.ignoreEvolutionsPreferences?.[getSbcAutoSolverSetKey(sbcSet)];
    return typeof savedPreference === "boolean"
      ? savedPreference
      : sbcAutoSolverSettings.ignoreEvolutions !== false;
  })(sbcSet);
  let ignoreSingleRevisionPlayers = (function (sbcSet) {
    const savedPreference =
      sbcAutoSolverSettings.ignoreSingleRevisionPreferences?.[getSbcAutoSolverSetKey(sbcSet)];
    return typeof savedPreference === "boolean"
      ? savedPreference
      : sbcAutoSolverSettings.ignoreSingleRevisionPlayers === true;
  })(sbcSet);
  const dialog = showDialog(
    [
      {
        labelEnum: enums.UIDialogOptions.OK,
        primaryActionFlag: true,
      },
      {
        labelEnum: enums.UIDialogOptions.CANCEL,
        primaryActionFlag: false,
      },
    ],
    translate("plugins.sbcAutoSolver.dialog.title"),
    "",
    async (selectedOption) => {
      if (selectedOption !== enums.UIDialogOptions.OK) {
        return;
      }
      if (
        !configuration.enabled ||
        !sbcAutoSolverSettings.enabled ||
        (isOneClick && !isDialogContextActive())
      ) {
        return;
      }
      const repetitionCount = canChooseRepetitions
        ? repetitionModeDropDown.getValue() === "all"
          ? remainingRepetitions
          : repetitionCountInput.getValue()
        : 1;
      if (!repetitionCount || repetitionCount < 1) {
        return void showErrorNotification(
          translate("plugins.sbcAutoSolver.errors.invalidRepetitions"),
        );
      }
      ovrRange = normalizeSbcAutoSolverOvrRange(ovrRange.ovrMin, ovrRange.ovrMax);
      saveSbcAutoSolverRatingRange(sbcSet, ovrRange);
      showLoadingShield();
      let progressNotification = createStaticNotification(UINotificationType.POSITIVE);
      try {
        if (isOneClick) {
          const oneClickPlan = await (async function (
            sbcSet,
            challengeId,
            solveOptions = {},
            isActive = () => true,
          ) {
            const loadResult = await loadOneClickSbcChallenges(sbcSet, isActive, true);
            const challenge = loadResult.challenges.find(
              (loadedChallenge) => String(loadedChallenge.id) === String(challengeId),
            );
            if (!challenge) {
              throwOneClickSbcError("noChallenges");
            }
            if (challenge.hasNotStarted()) {
              assertSbcAutoSolverActive(isActive);
              const initiateResponse = await observableToPromise(
                services.SBC.initiateOneClickChallenge(challenge),
              );
              assertSbcAutoSolverActive(isActive);
              if (!initiateResponse.success) {
                throwOneClickSbcError("loadFailed");
              }
            }
            const target = getOneClickSbcRemainingScore(challenge);
            const maxPlayerCount = getOneClickSbcSubmitLimit();
            const candidates = await loadOneClickSbcCandidatePlayers(
              challenge,
              solveOptions,
              isActive,
            );
            const solutions = await findOneClickSbcScoreSolutions(
              candidates,
              target,
              maxPlayerCount,
              () => isSbcAutoSolverEnabled() && isActive(),
            );
            assertSbcAutoSolverActive(isActive);
            if (!solutions.length) {
              throwOneClickSbcError("noSolutions");
            }
            return {
              set: loadResult.set,
              challenge: challenge,
              options: {
                ...solveOptions,
              },
              target: target,
              solutions: solutions,
              submittedScore: challenge.submittedScore ?? 0,
              scoreRequirement: challenge.scoreRequirement,
              selectedIndex: null,
              invalidated: false,
            };
          })(
            sbcSet,
            challengeDropDown?.getValue() ?? oneClickChallenges[0].id,
            {
              ...ovrRange,
              preferStorage: preferStorage,
              storageOnly: storageOnly,
              allowSpecialCards: allowSpecialCards,
              untradeablesOnly: untradeablesOnly,
              ignoreEvolutions: ignoreEvolutions,
              ignoreSingleRevisionPlayers: ignoreSingleRevisionPlayers,
            },
            isDialogContextActive,
          );
          if (!isDialogContextActive()) {
            return;
          }
          const solutionsController = new OneClickSbcSplitViewController(
            oneClickPlan,
            oneClickOptions.workArea,
          );
          solutionsController.init();
          return void navigationController.pushViewController(solutionsController);
        }
        await moveUnassignedItemsToClub(null, true);
        const solvePlan = await (async function (
          sbcSet,
          repetitionTotal,
          solveOptions = {},
          onProgress,
          onChallengeSkipped,
        ) {
          if (!repetitionTotal || repetitionTotal < 1) {
            return {
              success: false,
              reason: "Invalid repetition count",
            };
          }
          const response = await observableToPromise(services.SBC.requestChallengesForSet(sbcSet));
          if (!response.success) {
            return {
              success: false,
              reason: "Failed to load SBC challenges",
            };
          }
          const challenges = (function (loadedSet) {
            return toArray(
              loadedSet?.getChallenges?.() || loadedSet?.challenges?.values?.() || [],
            ).map((challengeEntry) =>
              challengeEntry?.value !== undefined ? challengeEntry.value : challengeEntry,
            );
          })(response.data?.set || sbcSet).filter((challenge) => !challenge.isCompleted?.());
          if (solveOptions.reverseSolve === true) {
            challenges.reverse();
          }
          if (!challenges.length) {
            return {
              success: false,
              reason: "No challenge found for this SBC",
            };
          }
          const usedPlayerKeys = new Set();
          const normalizedSubmitDelay = normalizeSbcRepetitionSubmitDelay(solveOptions.submitDelay);
          const groups = [];
          const players = [];
          const isMultiChallenge = challenges.length > 1;
          let hasSkippedChallenge = false;
          const reportSkippedChallenge = (challenge, challengeIndex, repetitionCurrent) => {
            hasSkippedChallenge = true;
            onChallengeSkipped?.({
              challengeTitle: challenge.name,
              challengeCurrent: challengeIndex + 1,
              challengeTotal: challenges.length,
              repetitionCurrent: repetitionCurrent,
              repetitionTotal: repetitionTotal,
            });
          };
          for (let repetition = 1; repetition <= repetitionTotal; repetition++) {
            for (const [challengeIndex, challenge] of challenges.entries()) {
              if (
                !(await observableToPromise(services.SBC.loadChallenge(challenge))).success ||
                !challenge.squad
              ) {
                if (isMultiChallenge) {
                  reportSkippedChallenge(challenge, challengeIndex, repetition);
                  continue;
                }
                return {
                  success: false,
                  reason: "Failed to load SBC challenge " + challenge.name,
                };
              }
              const solveResult = await buildSmartBuilderSquad(
                challenge,
                buildSbcRepetitionSolveOptions(usedPlayerKeys, solveOptions),
              );
              if (!solveResult.success) {
                if (isMultiChallenge) {
                  reportSkippedChallenge(challenge, challengeIndex, repetition);
                  continue;
                }
                return groups.length > 0
                  ? buildSbcAutoSolvePlan(
                      sbcSet,
                      repetitionTotal,
                      challenges.length,
                      groups,
                      players,
                      "partialSolve",
                      normalizedSubmitDelay,
                    )
                  : {
                      success: false,
                      reason: "Failed to solve " + challenge.name + ": " + solveResult.reason,
                    };
              }
              const requiredPlayersCount = challenge.squad.getNonBrickSlots().length;
              if (solveResult.count < requiredPlayersCount || !solveResult.meetsRequirements) {
                if (isMultiChallenge) {
                  reportSkippedChallenge(challenge, challengeIndex, repetition);
                  continue;
                }
                return groups.length === 0
                  ? {
                      success: false,
                      reason: noRepetitionsWithoutConceptPlayersMessage,
                      errorCode: "noRepetitionsWithoutConceptPlayers",
                    }
                  : buildSbcAutoSolvePlan(
                      sbcSet,
                      repetitionTotal,
                      challenges.length,
                      groups,
                      players,
                      "stoppedOnConceptPlayers",
                      normalizedSubmitDelay,
                    );
              }
              const solvedPlayers = solveResult.players.slice(0, requiredPlayersCount);
              if (solveResult.hasConceptPlayers || solvedPlayers.some(isConceptPlayerItem)) {
                if (isMultiChallenge) {
                  reportSkippedChallenge(challenge, challengeIndex, repetition);
                  continue;
                }
                return groups.length === 0
                  ? {
                      success: false,
                      reason: noRepetitionsWithoutConceptPlayersMessage,
                      errorCode: "noRepetitionsWithoutConceptPlayers",
                    }
                  : buildSbcAutoSolvePlan(
                      sbcSet,
                      repetitionTotal,
                      challenges.length,
                      groups,
                      players,
                      "stoppedOnConceptPlayers",
                      normalizedSubmitDelay,
                    );
              }
              groups.push({
                challengeId: challenge.id,
                challengeTitle: challenge.name,
                repetition: repetition,
                requiredPlayersCount: requiredPlayersCount,
                targetRating: getSbcChallengeTargetRating(challenge),
                players: solvedPlayers,
              });
              onProgress?.({
                challengeTitle: challenge.name,
                current: groups.length,
                total: challenges.length * repetitionTotal,
                challengeCurrent: challengeIndex + 1,
                challengeTotal: challenges.length,
                repetitionCurrent: repetition,
                repetitionTotal: repetitionTotal,
                isMultiChallenge: isMultiChallenge,
              });
              for (const player of solvedPlayers) {
                usedPlayerKeys.add(getSbcItemInstanceKey(player));
                players.push(player);
              }
            }
          }
          return groups.length
            ? {
                success: true,
                set: sbcSet,
                repetitions: repetitionTotal,
                challengeCount: challenges.length,
                isNonRepeatable: sbcSet.repeatabilityMode === SBCRepeatabilityMode.NON_REPEATABLE,
                submitDelay: normalizedSubmitDelay,
                groups: groups,
                players: players,
                warningCode: hasSkippedChallenge ? "partialSolve" : null,
              }
            : {
                success: false,
                reason: "No SBC challenges could be solved",
              };
        })(
          sbcSet,
          repetitionCount,
          {
            ...ovrRange,
            preferStorage: preferStorage,
            storageOnly: storageOnly,
            allowSpecialCards: allowSpecialCards,
            untradeablesOnly: untradeablesOnly,
            reverseSolve: reverseSolve,
            submitDelay: submitDelay,
            ignoreEvolutions: ignoreEvolutions,
            ignoreSingleRevisionPlayers: ignoreSingleRevisionPlayers,
          },
          (progress) => {
            const progressMessage = progress.isMultiChallenge
              ? translate("plugins.sbcAutoSolver.notifications.challengeProgress")
                  .replace("{challenge}", progress.challengeTitle)
                  .replace("{current}", progress.challengeCurrent)
                  .replace("{total}", progress.challengeTotal)
              : translate("plugins.sbcAutoSolver.notifications.repetitionProgress")
                  .replace("{current}", progress.current)
                  .replace("{total}", progress.total);
            progressNotification.message(progressMessage);
          },
          (progress) => {
            const progressMessage = translate(
              "plugins.sbcAutoSolver.notifications.challengeProgress",
            )
              .replace("{challenge}", progress.challengeTitle)
              .replace("{current}", progress.challengeCurrent)
              .replace("{total}", progress.challengeTotal);
            progressNotification.message(progressMessage, UINotificationType.NEGATIVE);
          },
        );
        if (!solvePlan.success) {
          return void showErrorNotification(
            solvePlan.errorCode
              ? translate("plugins.sbcAutoSolver.errors." + solvePlan.errorCode)
              : solvePlan.reason,
          );
        }
        const previewController = new SbcAutoSolverPreviewViewController(solvePlan, null);
        previewController.init();
        getActiveNavigationController().pushViewController(previewController);
      } catch (error) {
        if (isOneClick) {
          showOneClickSbcError(error);
        } else {
          showErrorNotification(
            error?.message || translate("plugins.sbcAutoSolver.oneClick.errors.loadFailed"),
          );
        }
      } finally {
        hideLoadingShield();
        progressNotification.dispose();
        progressNotification = null;
      }
    },
  );
  const dialogContent = createElement("div", {
    id: "sbc-auto-solver-dialog",
  });
  if (isOneClick && oneClickChallenges.length > 1) {
    const challengeField = createElement("div", {
      className: "sbc-auto-solver-field",
    });
    challengeDropDown = new DropdownControl();
    challengeDropDown.init();
    challengeDropDown.setOptions(
      oneClickChallenges.map((challenge) => ({
        label: challenge.name,
        value: challenge.id,
      })),
    );
    challengeDropDown.setValue(oneClickChallenges[0].id);
    appendElements(
      challengeField,
      createElement("label", translate("plugins.sbcAutoSolver.oneClick.challenge")),
      challengeDropDown,
    );
    appendElements(dialogContent, challengeField);
  }
  const preferStorageField = createElement("div", {
    className: "sbc-auto-solver-field",
  });
  const storageOnlyField = createElement("div", {
    className: "sbc-auto-solver-field",
  });
  const allowSpecialCardsField = createElement("div", {
    className: "sbc-auto-solver-field",
  });
  const untradeablesOnlyField = createElement("div", {
    className: "sbc-auto-solver-field",
  });
  const reverseSolveField = createElement("div", {
    className: "sbc-auto-solver-field",
  });
  const submitDelayField = createElement("div", {
    className: "sbc-auto-solver-field",
  });
  const ignoreEvolutionsField = createElement("div", {
    className: "sbc-auto-solver-field",
  });
  const ignoreSingleRevisionPlayersField = createElement("div", {
    className: "sbc-auto-solver-field",
  });
  const ovrRangeSearchView = new UTItemSearchView();
  const ovrRangeSearchViewModel = new UTItemSearchViewModel();
  ovrRangeSearchView.init();
  ovrRangeSearchView.togglePlayerNameRow(false);
  ovrRangeSearchView.toggleEvolutionStatusFilter(false);
  ovrRangeSearchView.togglePileFilter(false);
  ovrRangeSearchView.toggleOvrRange(SearchType.PLAYER, ItemSearchFeature.ANY);
  ovrRangeSearchViewModel.searchCriteria.ovrMin = ovrRange.ovrMin;
  ovrRangeSearchViewModel.searchCriteria.ovrMax = ovrRange.ovrMax;
  ovrRangeSearchView.setFilters(ovrRangeSearchViewModel);
  ovrRangeSearchView.filters.forEach((filter) => filter.hide());
  ovrRangeSearchView.onFilterChange.observe(this, (observable, filterType, filterValue) => {
    if (filterType === enums.UISearchFilters.OVR_MIN) {
      ovrRange.ovrMin = filterValue;
    } else if (filterType === enums.UISearchFilters.OVR_MAX) {
      ovrRange.ovrMax = filterValue;
    }
    ovrRange = normalizeSbcAutoSolverOvrRange(ovrRange.ovrMin, ovrRange.ovrMax);
    saveSbcAutoSolverRatingRange(sbcSet, ovrRange);
  });
  appendToggle(
    preferStorageField,
    "plugins.sbcAutoSolver.dialog.preferStorage",
    preferStorage,
    (isEnabled) => {
      preferStorage = isEnabled;
      (function (sbcSet, isEnabled) {
        sbcAutoSolverSettings.storagePreferences = sbcAutoSolverSettings.storagePreferences || {};
        sbcAutoSolverSettings.storagePreferences[getSbcAutoSolverSetKey(sbcSet)] = isEnabled;
        persistConfiguration();
      })(sbcSet, preferStorage);
    },
  );
  appendToggle(
    storageOnlyField,
    "plugins.sbcAutoSolver.dialog.storageOnly",
    storageOnly,
    (isEnabled) => {
      storageOnly = isEnabled;
      (function (sbcSet, isEnabled) {
        sbcAutoSolverSettings.storageOnlyPreferences =
          sbcAutoSolverSettings.storageOnlyPreferences || {};
        sbcAutoSolverSettings.storageOnlyPreferences[getSbcAutoSolverSetKey(sbcSet)] = isEnabled;
        persistConfiguration();
      })(sbcSet, storageOnly);
    },
  );
  appendToggle(
    allowSpecialCardsField,
    "plugins.sbcAutoSolver.dialog.allowSpecialCards",
    allowSpecialCards,
    (isEnabled) => {
      allowSpecialCards = isEnabled;
      (function (sbcSet, isEnabled) {
        sbcAutoSolverSettings.allowSpecialCardsPreferences =
          sbcAutoSolverSettings.allowSpecialCardsPreferences || {};
        sbcAutoSolverSettings.allowSpecialCardsPreferences[getSbcAutoSolverSetKey(sbcSet)] =
          isEnabled;
        persistConfiguration();
      })(sbcSet, allowSpecialCards);
    },
  );
  appendToggle(
    untradeablesOnlyField,
    "plugins.sbcAutoSolver.dialog.untradeablesOnly",
    untradeablesOnly,
    (isEnabled) => {
      untradeablesOnly = isEnabled;
      (function (sbcSet, isEnabled) {
        sbcAutoSolverSettings.untradeablesOnlyPreferences =
          sbcAutoSolverSettings.untradeablesOnlyPreferences || {};
        sbcAutoSolverSettings.untradeablesOnlyPreferences[getSbcAutoSolverSetKey(sbcSet)] =
          isEnabled;
        persistConfiguration();
      })(sbcSet, untradeablesOnly);
    },
  );
  const submitDelayLabel = createElement(
    "label",
    translate("plugins.sbcAutoSolver.dialog.submitDelay"),
  );
  const submitDelayDropDown = new DropdownControl();
  submitDelayDropDown.init();
  submitDelayDropDown.setOptions(sbcAutoSolverSubmitDelayOptions);
  submitDelayDropDown.setValue(submitDelay);
  submitDelayDropDown.onChange((selectedDelay) => {
    submitDelay = normalizeSbcAutoSolverSubmitDelay(selectedDelay);
    (function (sbcSet, submitDelay) {
      sbcAutoSolverSettings.submitDelayPreferences =
        sbcAutoSolverSettings.submitDelayPreferences || {};
      sbcAutoSolverSettings.submitDelayPreferences[getSbcAutoSolverSetKey(sbcSet)] =
        normalizeSbcAutoSolverSubmitDelay(submitDelay);
      persistConfiguration();
    })(sbcSet, submitDelay);
  });
  appendElements(submitDelayField, submitDelayLabel, submitDelayDropDown);
  appendToggle(
    ignoreEvolutionsField,
    "plugins.sbcAutoSolver.dialog.ignoreEvolutions",
    ignoreEvolutions,
    (isEnabled) => {
      ignoreEvolutions = isEnabled;
      (function (sbcSet, isEnabled) {
        sbcAutoSolverSettings.ignoreEvolutionsPreferences =
          sbcAutoSolverSettings.ignoreEvolutionsPreferences || {};
        sbcAutoSolverSettings.ignoreEvolutionsPreferences[getSbcAutoSolverSetKey(sbcSet)] =
          isEnabled;
        persistConfiguration();
      })(sbcSet, ignoreEvolutions);
    },
  );
  appendToggle(
    ignoreSingleRevisionPlayersField,
    "plugins.sbcAutoSolver.dialog.ignoreSingleRevisionPlayers",
    ignoreSingleRevisionPlayers,
    (isEnabled) => {
      ignoreSingleRevisionPlayers = isEnabled;
      (function (sbcSet, isEnabled) {
        sbcAutoSolverSettings.ignoreSingleRevisionPreferences =
          sbcAutoSolverSettings.ignoreSingleRevisionPreferences || {};
        sbcAutoSolverSettings.ignoreSingleRevisionPreferences[getSbcAutoSolverSetKey(sbcSet)] =
          isEnabled;
        persistConfiguration();
      })(sbcSet, ignoreSingleRevisionPlayers);
    },
  );
  appendToggle(
    reverseSolveField,
    "plugins.sbcAutoSolver.dialog.reverseSolve",
    reverseSolve,
    (isEnabled) => {
      reverseSolve = isEnabled;
      (function (sbcSet, isEnabled) {
        sbcAutoSolverSettings.reverseSolvePreferences =
          sbcAutoSolverSettings.reverseSolvePreferences || {};
        sbcAutoSolverSettings.reverseSolvePreferences[getSbcAutoSolverSetKey(sbcSet)] = isEnabled;
        persistConfiguration();
      })(sbcSet, reverseSolve);
    },
  );
  if (canChooseRepetitions) {
    const repetitionModeField = createElement("div", {
      className: "sbc-auto-solver-field",
    });
    const repetitionCountField = createElement("div", {
      className: "sbc-auto-solver-field",
    });
    const repetitionModeLabel = createElement(
      "label",
      translate("plugins.sbcAutoSolver.dialog.mode"),
    );
    const repetitionCountLabel = createElement(
      "label",
      translate("plugins.sbcAutoSolver.dialog.repetitions"),
    );
    repetitionModeDropDown = new DropdownControl();
    repetitionCountInput = new NumericSpinnerControl();
    repetitionModeDropDown.init();
    repetitionModeDropDown.setOptions(
      remainingRepetitions !== null
        ? [
            {
              label: translate("plugins.sbcAutoSolver.dialog.solveAll"),
              value: "all",
            },
            {
              label: translate("plugins.sbcAutoSolver.dialog.specify"),
              value: "specify",
            },
          ]
        : [
            {
              label: translate("plugins.sbcAutoSolver.dialog.specify"),
              value: "specify",
            },
          ],
    );
    repetitionModeDropDown.setValue(remainingRepetitions !== null ? "all" : "specify");
    repetitionCountInput.init();
    repetitionCountInput.setLimits(1, remainingRepetitions !== null ? remainingRepetitions : 999);
    repetitionCountInput.setValue(1);
    repetitionModeDropDown.onChange((mode) => {
      if (mode === "specify") {
        showElements(repetitionCountField);
      } else {
        hideElements(repetitionCountField);
      }
    });
    if (!isUnlimited) {
      appendElements(repetitionModeField, repetitionModeLabel, repetitionModeDropDown);
    }
    appendElements(repetitionCountField, repetitionCountLabel, repetitionCountInput);
    if (remainingRepetitions !== null) {
      hideElements(repetitionCountField);
    }
    appendElements(dialogContent, repetitionModeField, repetitionCountField);
  }
  appendElements(
    dialogContent,
    preferStorageField,
    storageOnlyField,
    allowSpecialCardsField,
    untradeablesOnlyField,
    ignoreEvolutionsField,
    ignoreSingleRevisionPlayersField,
    ovrRangeSearchView,
    submitDelayField,
    reverseSolveField,
  );
  if (isOneClick) {
    hideElements(submitDelayField);
    hideElements(reverseSolveField);
  }
  appendElements(dialog.getView().getContent(), dialogContent);
}
