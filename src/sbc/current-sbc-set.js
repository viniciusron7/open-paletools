/**
 * Remembers the SBC set (and challenge id) most recently opened. `setCurrentSbcSet` is called by
 * the `initWithSBCSet` wrappers of src/webapp/patches.js (squad split view: set and challenge id;
 * challenges list: set only); src/plugins/snipe/index.js reads the exported live bindings for its
 * SBC hub "repeat" shortcut.
 *
 * Invariants:
 * - Both values are replaced only when a set with a different `id` is stored; storing the same
 *   set again changes nothing, `challengeId` included.
 * - The `let` bindings only exist once this module is evaluated; callers use them at run time.
 *
 * Known issues (kept as-is):
 * - If a set's challenge list is opened first (stored without a challenge id), opening one of its
 *   challenges afterwards does not update `challengeId`, which stays undefined.
 */
export let currentSbcSet = null;

export let challengeId = null;

export function setCurrentSbcSet(sbcSet, newChallengeId) {
  if (!(currentSbcSet && currentSbcSet.id === sbcSet.id)) {
    currentSbcSet = sbcSet;
    challengeId = newChallengeId;
  }
}
