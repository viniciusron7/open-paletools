/**
 * Network club searches through `services.Club.search`: `searchClubPlayersByDefinitionIds`
 * (chunked lookup by definitionId, used by the club players cache and the album) and
 * `searchClubPlayers` (paged player scan with progress, used by the club players cache, improved
 * filters and the SBC builder enhancer).
 *
 * Invariants:
 * - `clubSearchPageSize` snapshots `configuration.requests.maxItemsCount` at module evaluation, so
 *   this module must stay after src/config/configuration.js in the manifest; later setting changes
 *   do not affect it. src/webapp/patches.js also imports it.
 * - `searchClubPlayersByDefinitionIds` splits id lists longer than the page size into sequential
 *   chunk searches (no delay) and returns `response.items` unfiltered (loans included).
 * - `searchClubPlayers` mutates the criteria object it receives (defId, count, type, sortBy/sort
 *   defaults, offset advanced and never reset). Paging continues until status 400,
 *   `retrievedAll` or `maxPages`, with a random 100-200 ms delay between pages;
 *   `onProgress(offset, pageItems)` returning false resolves early.
 * - The resolved value is the current (last) page's items only; callers that need every page
 *   collect them in `onProgress`.
 *
 * Known issues (kept as-is):
 * - The club-index branch resolves `{success, response: {items: Promise}}` (`searchClubIndex` is
 *   not awaited) instead of an array; every current caller passes `bypassClubIndex = true`.
 * - The club players cache and improved-filters treat the resolved last page as the whole club.
 */
import { isClubIndexReady, searchClubIndex } from "./club-index.js";
import { configuration } from "../config/configuration.js";
import { waitForDelay } from "../core/async.js";
import { flattenArray } from "../core/collections.js";
import { observableToPromise } from "../webapp/observable.js";

export const clubSearchPageSize = configuration.requests.maxItemsCount;

export async function searchClubPlayersByDefinitionIds(definitionIds) {
  if (definitionIds.length === 0) {
    return [];
  }
  if (clubSearchPageSize < definitionIds.length) {
    const chunkCount = Math.ceil(definitionIds.length / clubSearchPageSize);
    const chunkResults = [];
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
      chunkResults.push(
        await searchClubPlayersByDefinitionIds(definitionIds.slice(0, clubSearchPageSize)),
      );
      definitionIds = definitionIds.slice(clubSearchPageSize, definitionIds.length);
    }
    return flattenArray(chunkResults);
  }
  {
    const searchCriteria = new UTItemSearchViewModel().searchCriteria;
    searchCriteria.count = clubSearchPageSize;
    searchCriteria.defId = definitionIds;
    searchCriteria.sortBy = SearchSortType.RATING;
    searchCriteria.sort = SearchSortOrder.ASCENDING;
    return (await observableToPromise(services.Club.search(searchCriteria))).response.items;
  }
}

/**
 * @mutable The club scan in progress, shared by concurrent loads of the club players cache
 * (src/club/club-players-cache.js assigns it). It stays declared here, where the original
 * bundle declared it: moving it into its user would change when it is initialized.
 */
export let clubPlayersSearchPromise = null;

export function searchClubPlayers(
  excludeLoans,
  definitionId,
  onProgress,
  searchCriteria,
  bypassClubIndex,
  maxPages = -1,
) {
  if (!bypassClubIndex && configuration.plugins.clubIndex?.enabled && isClubIndexReady()) {
    return new Promise((resolve) =>
      resolve({
        success: true,
        response: {
          items: searchClubIndex(excludeLoans, definitionId, onProgress, searchCriteria),
        },
      }),
    );
  }
  let pageCount = 1;
  return new Promise((resolve, reject) => {
    searchCriteria = searchCriteria || new UTItemSearchViewModel().searchCriteria;
    if (definitionId) {
      searchCriteria.defId = [parseInt(definitionId)];
    }
    searchCriteria.count = clubSearchPageSize;
    searchCriteria.type = SearchType.PLAYER;
    searchCriteria.sortBy = searchCriteria.sortBy || SearchSortType.RATING;
    searchCriteria.sort = searchCriteria.sort || SearchSortOrder.ASCENDING;
    let players = [];
    const searchNextPage = () => {
      services.Club.search(searchCriteria).observe(this, async function (sender, response) {
        players = [...response.response.items.filter((item) => !excludeLoans || item.loans < 0)];
        if (
          response.status !== 400 &&
          !response.response.retrievedAll &&
          (-1 === maxPages || pageCount < maxPages)
        ) {
          pageCount++;
          searchCriteria.offset += searchCriteria.count;
          if (onProgress && onProgress(searchCriteria.offset, players) === false) {
            return void resolve(players);
          }
          waitForDelay(100 + 100 * Math.random()).then(() => searchNextPage());
        } else {
          if (onProgress) {
            onProgress(searchCriteria.offset, players);
          }
          resolve(players);
        }
      });
    };
    searchNextPage();
  });
}
