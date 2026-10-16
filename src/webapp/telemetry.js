/**
 * `trackPageView(pgid)` sends an EA PIN `PINEventType.PAGE_VIEW` event (`services.PIN.sendData`)
 * with the given page id. Used by src/market/lowest-price-search.js and
 * src/webapp/item-piles.js (`fetchUnassignedItems`).
 *
 * Invariants:
 * - The `pgid` strings passed by callers ("Transfer Market Search", "Item - Detail View", ...) are
 *   EA page ids and must stay identical.
 */
export function trackPageView(pgid) {
  services.PIN.sendData(PINEventType.PAGE_VIEW, {
    type: PIN_PAGEVIEW_EVT_TYPE,
    pgid: pgid,
  });
}
