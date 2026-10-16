/**
 * Numeric squad-builder search sources: 1 SBC storage only, 2 club only, 3 storage then club (the
 * default), 4 club then storage. Used by src/plugins/sbc-builder-enhancer/index.js
 * (`searchSettings.searchSource`) and by the SBC template editor's search source dropdown.
 *
 * Invariants:
 * - The values are stored in per-challenge builder settings (session storage key
 *   `sbc:<challengeId>:searchSettings`) and persisted in SBC template steps (IndexedDB); do not
 *   renumber them.
 */
export const searchSourceStorage = 1;

export const searchSourceClub = 2;

export const searchSourceStorageThenClub = 3;

export const searchSourceClubThenStorage = 4;
