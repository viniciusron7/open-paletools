/**
 * SBC auto solver settings helpers shared by dialog.js and index.js of the plugin.
 *
 * Invariants:
 * - `sbcAutoSolverSettings` aliases `configuration.plugins.sbcAutoSolver`, captured at module
 *   evaluation (mutate it in place). Per-set maps (`ratingRanges` and the `*Preferences` maps)
 *   are keyed by `String(set.id)` (`getSbcAutoSolverSetKey`).
 * - `normalizeSbcAutoSolverOvrRange` parses and clamps to `minOvr`..`maxOvr` and forces min <=
 *   max; `saveSbcAutoSolverRatingRange` persists the configuration.
 * - Submit delay options and normalization: 1-5 seconds, default 1.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { maxOvr, minOvr } from "../../webapp/search-criteria-limits.js";

export const sbcAutoSolverSettings = configuration.plugins.sbcAutoSolver;

export const sbcAutoSolverSubmitDelayOptions = [1, 2, 3, 4, 5].map((seconds) => ({
  value: seconds,
  label: seconds + "s",
}));

export function normalizeSbcAutoSolverOvrRange(ovrMin, ovrMax) {
  ovrMin = parseInt(ovrMin) || minOvr;
  ovrMax = parseInt(ovrMax) || maxOvr;
  if (
    (ovrMin = Math.max(minOvr, Math.min(ovrMin, maxOvr))) >
    (ovrMax = Math.max(minOvr, Math.min(ovrMax, maxOvr)))
  ) {
    ovrMin = ovrMax;
  }
  return {
    ovrMin: ovrMin,
    ovrMax: ovrMax,
  };
}

export function getSbcAutoSolverSetKey(sbcSet) {
  return String(sbcSet?.id);
}

export function saveSbcAutoSolverRatingRange(sbcSet, ovrRange) {
  sbcAutoSolverSettings.ratingRanges = sbcAutoSolverSettings.ratingRanges || {};
  sbcAutoSolverSettings.ratingRanges[getSbcAutoSolverSetKey(sbcSet)] =
    normalizeSbcAutoSolverOvrRange(ovrRange.ovrMin, ovrRange.ovrMax);
  persistConfiguration();
}

export function normalizeSbcAutoSolverSubmitDelay(submitDelay) {
  const parsedDelay = parseInt(submitDelay);
  return parsedDelay >= 1 && parsedDelay <= 5 ? parsedDelay : 1;
}
