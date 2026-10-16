/**
 * Session-wide dedupe maps (item id -> item) for the ITEMS_SOLD and ITEMS_WON events dispatched by
 * the transfer-list and watch-list `_requestItems` overrides in src/webapp/patches.js, their only
 * user.
 *
 * Invariants:
 * - Entries are never removed, so those overrides report an item id at most once per page load.
 */
export const reportedSoldItemsById = {};

export const reportedWonItemsById = {};
