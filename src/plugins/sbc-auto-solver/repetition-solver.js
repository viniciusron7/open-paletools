/**
 * Pure helpers of the SBC auto solver's repetition mode, used by
 * src/plugins/sbc-auto-solver/dialog.js and preview-view.js.
 *
 * Invariants:
 * - `buildSbcRepetitionSolveOptions` maps the auto-solver options to the smart builder's
 *   `builderConfig`: storage always used, concept players and important-league/nation exclusions
 *   off, `allowSpecialCards` and `ignoreEvolutions` default to true, and `excludedPlayerKeys` are
 *   the instance keys (`getSbcItemInstanceKey`) already used by earlier groups.
 * - Plan shape (`buildSbcAutoSolvePlan` and the dialog's own success plan): `success, set,
 *   repetitions, challengeCount, isNonRepeatable, submitDelay, groups, players, warningCode`
 *   (plus `requestedRepetitions` here). `warningCode` values are suffixes of the
 *   `plugins.sbcAutoSolver.preview.*` translation keys.
 * - Submit delay: whole seconds 1-5, otherwise 1; the same rule as
 *   `normalizeSbcAutoSolverSubmitDelay` in settings.js, keep both in sync.
 * - `noRepetitionsWithoutConceptPlayersMessage` pairs with errorCode
 *   `noRepetitionsWithoutConceptPlayers`.
 */
import { maxOvr, minOvr } from "../../webapp/search-criteria-limits.js";

const defaultSbcRepetitionSubmitDelay = 1;

export const noRepetitionsWithoutConceptPlayersMessage =
  "No SBC repetitions can be solved without concept players";

export function buildSbcRepetitionSolveOptions(usedPlayerKeys, solveOptions = {}) {
  return {
    useStorage: true,
    preferStorage: solveOptions.preferStorage === true,
    storageOnly: solveOptions.storageOnly === true,
    ignoreEvolutions: solveOptions.ignoreEvolutions !== false,
    ignoreSingleRevisionPlayers: solveOptions.ignoreSingleRevisionPlayers === true,
    allowSpecialCards: solveOptions.allowSpecialCards !== false,
    ignoreImportantLeagues: false,
    ignoreImportantNations: false,
    ovrMin: solveOptions.ovrMin || minOvr,
    ovrMax: solveOptions.ovrMax || maxOvr,
    untradeablesOnly: solveOptions.untradeablesOnly === true,
    includeConceptPlayers: false,
    excludedPlayerKeys: Array.from(usedPlayerKeys),
  };
}

export function isConceptPlayerItem(player) {
  return player?.isConceptPlayer === true;
}

export function getSbcChallengeTargetRating(challenge) {
  const teamRatingRequirement = challenge?.eligibilityRequirements?.find(
    (requirement) => requirement.getFirstKey() === SBCEligibilityKey.TEAM_RATING,
  );
  return (
    (teamRatingRequirement && teamRatingRequirement.getValue(SBCEligibilityKey.TEAM_RATING)?.[0]) ||
    null
  );
}

export function normalizeSbcRepetitionSubmitDelay(submitDelay) {
  const parsedDelay = parseInt(submitDelay);
  return parsedDelay >= 1 && parsedDelay <= 5 ? parsedDelay : defaultSbcRepetitionSubmitDelay;
}

export function buildSbcAutoSolvePlan(
  sbcSet,
  requestedRepetitions,
  challengeCount,
  groups,
  players,
  warningCode,
  submitDelay,
) {
  return {
    success: true,
    set: sbcSet,
    repetitions: groups.length,
    requestedRepetitions: requestedRepetitions,
    challengeCount: challengeCount,
    isNonRepeatable: sbcSet.repeatabilityMode === SBCRepeatabilityMode.NON_REPEATABLE,
    submitDelay: submitDelay,
    groups: groups,
    players: players,
    warningCode: warningCode,
  };
}
