/**
 * Registries read by the market search patches in src/webapp/patches.js:
 * `marketSearchResultTransformers` (filled through `addMarketSearchResultTransformer` by the
 * market-search-filters plugin), `marketSearchResultValidators` (legacy snipe plugin) and
 * `marketSearchSetItemsHandlers` (mark-duplicated plugin).
 *
 * Invariants:
 * - Entries run in registration (plugin run) order and are never removed.
 * - Transformer `(items, controller, criteria) -> items | Promise`; validator
 *   `(items, services.Item, criteria) -> boolean | Promise` (criteria: the searched
 *   `UTSearchCriteriaDTO`), a falsy result marks the response unsuccessful
 *   and stops later validators; handler `(items, controller)` after `UTMarketSearchView.setItems`.
 *   Transformers and validators are skipped for searches with `disableOverrides`.
 */
export const marketSearchResultTransformers = [];

export const marketSearchResultValidators = [];

export const marketSearchSetItemsHandlers = [];

export function addMarketSearchResultTransformer(transformer) {
  marketSearchResultTransformers.push(transformer);
}
