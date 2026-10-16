/**
 * Shared handler registries for `UTSBCSquadDetailPanelView`: the wrappers installed by
 * `applyWebAppPatches` (src/webapp/patches.js) call every handler with the panel view after the
 * original `_generate` / `destroyGeneratedElements`; src/sbc/use-players-button.js pushes them.
 *
 * Invariants:
 * - The arrays are mutated in place and never reassigned or cleared; handlers run in the order
 *   the *-to-SBC plugins register them.
 * - The manifest places this module after src/webapp/patches.js, so patches.js may only read the
 *   arrays at run time (inside the wrappers), never at module evaluation.
 */
export const sbcSquadDetailPanelGenerateHandlers = [];

export const sbcSquadDetailPanelDestroyHandlers = [];
