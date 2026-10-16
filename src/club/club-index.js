/**
 * Club index: an in-memory snapshot of the user's non-loan club players, built by paging
 * `services.Club.search`. Read by the SBC smart builder (src/sbc/smart-builder-solver.js), the SBC
 * auto solver, the album, player tracking and `searchClubPlayers`; loads and incremental updates
 * are driven by src/plugins/club-index/index.js. Enabled by `plugins.clubIndex.enabled`.
 *
 * Index lifecycle:
 * - Disabled: `loadClubIndex`/`getOrLoadClubIndexPlayers` resolve `[]`; not ready.
 * - `loadClubIndex(onProgress)` is single-flight through `clubIndexLoadPromise` (a concurrent
 *   caller gets the same promise; its `onProgress` is ignored). It empties both maps, sets
 *   `isClubIndexLoaded = false` and opens `clubIndexBuildOverlay`
 *   (`snapshotByItemId`, `addedByItemId`, `removedByItemId`).
 * - Pages: `count = configuration.requests.maxItemsCount`, PLAYER, rating ascending, random
 *   100-200 ms between pages; only `loans < 0` players are snapshotted. Stops on `retrievedAll`,
 *   on `!success` or when `onProgress` returns false.
 * - With `onProgress`, each page is committed (partial results visible), reported as
 *   `(count, players)`, and a fresh overlay is reopened seeded with the committed players.
 * - End: commit (snapshot minus removed, plus added), overlay set to null, `isClubIndexLoaded =
 *   true`, promise cleared, `CLUB_INDEX_LOADED` dispatched with `{count}`.
 * - While the overlay is open, `removePlayerFromClubIndex` and the plugin's add path write into
 *   it instead of the maps.
 *
 * Invariants:
 * - Item key: `id:<id>`, else `item:<itemData.id>`, else
 *   `def:<definitionId>:<rareflag>:<rating>:<teamId>:<leagueId>:<nationId>`; adds, removals and
 *   snapshots must derive the same key.
 * - The revision map (databaseId -> Set of definitionIds of `rareflag > 1` cards) is kept in step
 *   only by `setClubIndexPlayer`/`deleteClubIndexPlayer`; `getClubIndexRevisionCount` is >= 1.
 * - The maps, `clubIndexBuildOverlay` and `isClubIndexLoaded` are reassigned `export let`
 *   bindings; importers (`clubIndexDebug`, the smart builder) must read them live.
 * - `getItemDatabaseId` must stay a self-contained top-level function declaration: the tests
 *   evaluate it alone (tests/support/market-automation-sources.cjs).
 * - `searchClubIndex` mirrors EA search-criteria fields (ovr/rating bounds, defId/maskedDefId,
 *   rarities, nation/league/club, level, untradeables, hideLoans, hideLocked via `isItemLocked`);
 *   only `SearchSortType.RATING` sorts. It writes `defId` into the criteria it is given.
 *
 * Known issues (kept as-is):
 * - The build runs in an `async` Promise executor: an exception inside it leaves the promise
 *   pending forever, `clubIndexLoadPromise` set and the overlay open.
 * - A failed page (`!success`) or `onProgress` returning false still marks the partial index as
 *   loaded.
 */
import { isItemLocked } from "./locked-items.js";
import { configuration } from "../config/configuration.js";
import { waitForDelay } from "../core/async.js";
import { dispatchPaletoolsEvent, paletoolsEvents } from "../core/events.js";
import { observableToPromise } from "../webapp/observable.js";

const clubIndexPageDelayMinMs = 100;

const clubIndexPageDelayMaxMs = 200;

export let clubIndexPlayersByItemKey = new Map();

export let clubIndexRevisionDefinitionIdsByDatabaseId = new Map();

let clubIndexLoadPromise = null;

export let clubIndexBuildOverlay = null;

export let isClubIndexLoaded = false;

export function isClubIndexEnabled() {
  return configuration.plugins.clubIndex?.enabled === true;
}

export function removePlayerFromClubIndex(item) {
  if (!item || item.type !== ItemType.PLAYER) {
    return;
  }
  const itemKey = getClubIndexItemKey(item);
  if (itemKey) {
    if (clubIndexBuildOverlay) {
      delete clubIndexBuildOverlay.addedByItemId[itemKey];
      return void (clubIndexBuildOverlay.removedByItemId[itemKey] = true);
    } else {
      return void deleteClubIndexPlayer(itemKey);
    }
  } else {
    return undefined;
  }
}

export function getClubIndexPlayers() {
  return [...clubIndexPlayersByItemKey.values()];
}

export function getClubIndexRevisionCount(item) {
  const databaseId = getItemDatabaseId(item);
  return databaseId === null
    ? 1
    : clubIndexRevisionDefinitionIdsByDatabaseId.get(databaseId)?.size || 1;
}

export function getItemDatabaseId(item) {
  const databaseId = item?.databaseId;
  if (Number.isInteger(databaseId) && databaseId > 0) {
    return databaseId;
  }
  const definitionId = item?.definitionId ?? item?.itemData?.definitionId;
  return Number.isInteger(definitionId) ? definitionId & ItemIdMask.DATABASE : null;
}

function unregisterClubIndexRevision(item) {
  if (!(item?.rareflag > 1)) {
    return;
  }
  const databaseId = getItemDatabaseId(item);
  const definitionId = item?.definitionId ?? item?.itemData?.definitionId;
  if (databaseId === null || !Number.isInteger(definitionId)) {
    return;
  }
  const definitionIds = clubIndexRevisionDefinitionIdsByDatabaseId.get(databaseId);
  if (definitionIds) {
    definitionIds.delete(definitionId);
    if (definitionIds.size === 0) {
      clubIndexRevisionDefinitionIdsByDatabaseId.delete(databaseId);
    }
  }
}

export function setClubIndexPlayer(itemKey, item) {
  const previousItem = clubIndexPlayersByItemKey.get(itemKey);
  if (previousItem) {
    unregisterClubIndexRevision(previousItem);
  }
  clubIndexPlayersByItemKey.set(itemKey, item);
  (function (addedItem) {
    if (!(addedItem?.rareflag > 1)) {
      return;
    }
    const databaseId = getItemDatabaseId(addedItem);
    const definitionId = addedItem?.definitionId ?? addedItem?.itemData?.definitionId;
    if (databaseId !== null && Number.isInteger(definitionId)) {
      if (!clubIndexRevisionDefinitionIdsByDatabaseId.has(databaseId)) {
        clubIndexRevisionDefinitionIdsByDatabaseId.set(databaseId, new Set());
      }
      clubIndexRevisionDefinitionIdsByDatabaseId.get(databaseId).add(definitionId);
    }
  })(item);
}

export function deleteClubIndexPlayer(itemKey) {
  const item = clubIndexPlayersByItemKey.get(itemKey);
  if (item) {
    unregisterClubIndexRevision(item);
    clubIndexPlayersByItemKey.delete(itemKey);
  }
}

export function getClubIndexItemKey(item) {
  return item?.id != null
    ? "id:" + item.id
    : item?.itemData?.id != null
      ? "item:" + item.itemData.id
      : item?.definitionId != null
        ? "def:" +
          item.definitionId +
          ":" +
          item.rareflag +
          ":" +
          item.rating +
          ":" +
          item.teamId +
          ":" +
          item.leagueId +
          ":" +
          item.nationId
        : null;
}

function snapshotClubIndexPlayer(item) {
  if (!item || item.type !== ItemType.PLAYER || !clubIndexBuildOverlay) {
    return;
  }
  if (item.loans > -1) {
    return;
  }
  const itemKey = getClubIndexItemKey(item);
  if (itemKey) {
    clubIndexBuildOverlay.snapshotByItemId[itemKey] = item;
  }
}

function commitClubIndexBuildOverlay() {
  if (!clubIndexBuildOverlay) {
    return;
  }
  const overlay = clubIndexBuildOverlay;
  clubIndexPlayersByItemKey = new Map();
  clubIndexRevisionDefinitionIdsByDatabaseId = new Map();
  for (const [itemKey, item] of Object.entries(overlay.snapshotByItemId)) {
    if (!overlay.removedByItemId[itemKey]) {
      setClubIndexPlayer(itemKey, item);
    }
  }
  for (const [itemKey, item] of Object.entries(overlay.addedByItemId)) {
    setClubIndexPlayer(itemKey, item);
  }
  clubIndexBuildOverlay = null;
}

function matchesClubIndexFilterValue(itemValue, allowedValues) {
  if (allowedValues == null) {
    return true;
  }
  const allowedValuesList = Array.isArray(allowedValues) ? allowedValues : [allowedValues];
  return (
    allowedValuesList.length === 0 ||
    allowedValuesList.map((allowedValue) => parseInt(allowedValue)).includes(itemValue)
  );
}

export function isClubIndexReady() {
  return isClubIndexEnabled() && isClubIndexLoaded;
}

export async function loadClubIndex(onProgress) {
  return isClubIndexEnabled()
    ? clubIndexLoadPromise ||
        ((clubIndexLoadPromise = new Promise(async (resolve) => {
          clubIndexPlayersByItemKey = new Map();
          clubIndexRevisionDefinitionIdsByDatabaseId = new Map();
          clubIndexBuildOverlay = null;
          isClubIndexLoaded = false;
          clubIndexBuildOverlay = {
            snapshotByItemId: {},
            addedByItemId: {},
            removedByItemId: {},
          };
          const searchCriteria = new UTItemSearchViewModel().searchCriteria;
          searchCriteria.count = configuration.requests.maxItemsCount;
          searchCriteria.type = SearchType.PLAYER;
          searchCriteria.sortBy = SearchSortType.RATING;
          searchCriteria.sort = SearchSortOrder.ASCENDING;
          let offset = 0;
          let hasRetrievedAll = false;
          for (; !hasRetrievedAll; ) {
            searchCriteria.offset = offset;
            const searchResult = await observableToPromise(services.Club.search(searchCriteria));
            if (!searchResult.success) {
              break;
            }
            const clubPlayers = searchResult.response.items.filter(
              (item) => item.type === ItemType.PLAYER && item.loans < 0,
            );
            for (const player of clubPlayers) {
              snapshotClubIndexPlayer(player);
            }
            hasRetrievedAll = searchResult.response.retrievedAll;
            offset += searchCriteria.count;
            if (onProgress) {
              commitClubIndexBuildOverlay();
              const players = getClubIndexPlayers();
              const progressResult = onProgress(players.length, players);
              clubIndexBuildOverlay = {
                snapshotByItemId: {},
                addedByItemId: {},
                removedByItemId: {},
              };
              for (const player of players) {
                snapshotClubIndexPlayer(player);
              }
              if (progressResult === false) {
                break;
              }
            }
            if (!hasRetrievedAll) {
              await waitForDelay(clubIndexPageDelayMinMs, clubIndexPageDelayMaxMs);
            }
          }
          commitClubIndexBuildOverlay();
          isClubIndexLoaded = true;
          clubIndexLoadPromise = null;
          dispatchPaletoolsEvent(paletoolsEvents.CLUB_INDEX_LOADED, {
            count: getClubIndexPlayers().length,
          });
          resolve(getClubIndexPlayers());
        })),
        clubIndexLoadPromise)
    : [];
}

export async function getOrLoadClubIndexPlayers(onProgress) {
  return isClubIndexEnabled()
    ? isClubIndexLoaded
      ? getClubIndexPlayers()
      : loadClubIndex(onProgress)
    : [];
}

export async function searchClubIndex(
  excludeLoans,
  definitionId,
  onProgress,
  customSearchCriteria,
) {
  await getOrLoadClubIndexPlayers(onProgress);
  const searchCriteria = customSearchCriteria || new UTItemSearchViewModel().searchCriteria;
  if (definitionId) {
    searchCriteria.defId = [parseInt(definitionId)];
  }
  const sortedPlayers = (function (players, criteria) {
    return criteria.sortBy !== SearchSortType.RATING
      ? players
      : players.sort((left, right) => {
          const ratingDifference = left.rating - right.rating;
          return criteria.sort === SearchSortOrder.DESCENDING
            ? -ratingDifference
            : ratingDifference;
        });
  })(
    getClubIndexPlayers().filter((player) =>
      (function (player, criteria, excludeLoans) {
        return !(
          (excludeLoans && player.loans > -1) ||
          (criteria.type && criteria.type !== SearchType.PLAYER) ||
          (criteria.ovrMin && player.rating < criteria.ovrMin) ||
          (criteria.ovrMax && player.rating > criteria.ovrMax) ||
          (criteria.minRating && player.rating < criteria.minRating) ||
          (criteria.maxRating && player.rating > criteria.maxRating) ||
          (criteria.hideLoans && player.loans > -1) ||
          (criteria.hideLocked && isItemLocked(player)) ||
          !matchesClubIndexFilterValue(
            player.definitionId,
            criteria.defId || criteria.maskedDefId,
          ) ||
          !matchesClubIndexFilterValue(player.rareflag, criteria.rarities) ||
          (criteria.nation > -1 &&
            !matchesClubIndexFilterValue(player.nationId, criteria.nation)) ||
          (criteria.league > -1 &&
            !matchesClubIndexFilterValue(player.leagueId, criteria.league)) ||
          (criteria.club > -1 && !matchesClubIndexFilterValue(player.teamId, criteria.club)) ||
          !(function (player, level) {
            if (level == null) {
              return true;
            }
            if (level === SearchLevel.ANY) {
              return true;
            }
            if ([SearchLevel.SPECIAL, SearchLevel.SP].includes(level)) {
              return player.isSpecial();
            }
            if (!player.hasQualityTiers()) {
              return false;
            }
            switch (level) {
              case SearchLevel.BRONZE:
                return player.getTier() === ItemRatingTier.BRONZE;
              case SearchLevel.SILVER:
                return player.getTier() === ItemRatingTier.SILVER;
              case SearchLevel.GOLD:
                return player.getTier() === ItemRatingTier.GOLD;
            }
            return player.getTier() === level;
          })(player, criteria.level) ||
          !(function (player, criteria) {
            const untradeablesFilter = criteria.untradeables ?? criteria._untradeables;
            return (
              untradeablesFilter == null ||
              untradeablesFilter === "" ||
              (String(untradeablesFilter) === "true" ? !player.tradable : player.tradable)
            );
          })(player, criteria)
        );
      })(player, searchCriteria, excludeLoans),
    ),
    searchCriteria,
  );
  const matchingPlayers = sortedPlayers;
  if (onProgress) {
    onProgress(matchingPlayers.length, matchingPlayers);
  }
  return matchingPlayers;
}
