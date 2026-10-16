/**
 * `maxOvr`/`minOvr`: EA's default OVR bounds (`UTSearchCriteriaDTO.SEARCH_CRITERIA_DEFAULT_OVR_MAX`
 * / `_MIN`), used by the configuration defaults (src/config/defaults.js) and the SBC solvers.
 *
 * Invariants:
 * - Read once at module evaluation; this module must stay before src/config/defaults.js in the
 *   manifest order.
 */
export const maxOvr = UTSearchCriteriaDTO.SEARCH_CRITERIA_DEFAULT_OVR_MAX;

export const minOvr = UTSearchCriteriaDTO.SEARCH_CRITERIA_DEFAULT_OVR_MIN;
