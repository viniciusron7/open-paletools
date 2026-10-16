/**
 * Searches of concept (not owned) items through `services.Item.searchConceptItems`; used by the
 * smart builder solver, price tracker, album, gallery and import SBC.
 *
 * Invariants:
 * - `searchConceptItemsPaged(criteria, maxPages = 1)` sets `criteria.count` to
 *   `configuration.requests.maxItemsCount`, advances `offset` per page with a random 50-150 ms
 *   delay, stops on `retrievedAll` or a short page, and resets `offset` to 0 before returning
 *   (`count` stays changed).
 * - Every item it returns gets `isConceptPlayer = true`; src/club/player-tracking.js relies on
 *   that flag to skip concept items.
 * - `findConceptItemByDefinitionId` pages 100 ms apart until status 400 or `endOfList`, then
 *   resolves the item whose `definitionId` equals `parseInt(definitionId)` (or undefined); it does
 *   not set `isConceptPlayer`.
 */
import { configuration } from "../config/configuration.js";
import { waitForDelay } from "../core/async.js";
import { observableToPromise } from "../webapp/observable.js";

export async function searchConceptItemsPaged(searchCriteria, maxPages = 1) {
  const conceptItems = [];
  searchCriteria.count = configuration.requests.maxItemsCount;
  for (let page = 0; page < maxPages; page++) {
    const searchResult = await observableToPromise(
      services.Item.searchConceptItems(searchCriteria),
    );
    for (const conceptItem of searchResult.response.items) {
      conceptItem.isConceptPlayer = true;
      conceptItems.push(conceptItem);
    }
    if (
      searchResult.response.retrievedAll ||
      searchResult.response.items.length < configuration.requests.maxItemsCount
    ) {
      break;
    }
    searchCriteria.offset += searchCriteria.count;
    await waitForDelay(50, 150);
  }
  searchCriteria.offset = 0;
  return conceptItems;
}

export function findConceptItemByDefinitionId(definitionId) {
  return new Promise((resolve) => {
    (function (searchDefinitionId) {
      return new Promise((resolveItems, reject) => {
        const searchCriteria = new UTItemSearchViewModel().searchCriteria;
        if (searchDefinitionId) {
          searchCriteria.defId = [searchDefinitionId];
        }
        const conceptItems = [];
        const searchNextPage = () => {
          services.Item.searchConceptItems(searchCriteria).observe(
            this,
            async function (sender, response) {
              conceptItems.push(...response.response.items);
              if (response.status === 400 || response.response.endOfList) {
                resolveItems(conceptItems);
              } else {
                searchCriteria.offset += searchCriteria.count;
                waitForDelay(100).then(() => searchNextPage());
              }
            },
          );
        };
        searchNextPage();
      });
    })((definitionId = parseInt(definitionId))).then((foundItems) => {
      let conceptItem = foundItems.find((item) => item.definitionId === definitionId);
      resolve(conceptItem);
    });
  });
}
