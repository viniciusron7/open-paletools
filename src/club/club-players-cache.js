/**
 * Cache of owned club players keyed by definitionId, plus a negative cache of definitionIds not
 * in the club, answering "do I own this player?" for SBC squad filling (src/sbc/squad-fill.js),
 * item piles, import SBC, mark-duplicated, market search filters and the club analyzer.
 *
 * Invariants:
 * - `clubPlayersByDefinitionId` (object) and `definitionIdsNotInClub` (Set) are exported mutable
 *   state that src/bootstrap/boot.js updates on ITEM_MOVED/ITEM_DISCARDED; `loadClubPlayers`
 *   replaces the object, so importers must read the binding live.
 * - `findOwnedClubPlayers(items, _, returnAsMap, bypassCache)` accepts player items or
 *   `UTStaticPlayerDataDTO`s (whose `id` is the definitionId), fetches only ids neither cached nor
 *   negatively cached (every id with `bypassCache`), keeps results with `loans === -1`, and adds
 *   every id still missing from the cache to `definitionIdsNotInClub`. The second parameter is
 *   unused (callers pass 0).
 * - `loadClubPlayers(onProgress, shouldLoad, forceReload)` resolves `{}` unless `shouldLoad`;
 *   `forceReload` empties only the positive cache. The scan is
 *   `searchClubPlayers(true, null, progress, null, bypassClubIndex = true)` and is shared through
 *   `clubPlayersSearchPromise`: a still-pending scan (detected with `Promise.race` against a
 *   sentinel) is reused without the new caller's progress callback; a settled one is replaced.
 * - Progress is shown with `setBannerMessage(translate("ui.loadingPlayers"))` (`{count}`
 *   placeholder) and cleared with "" when done.
 * - After a load, entries of the previous cache object are copied over the loaded ones (previous
 *   entries win).
 *
 * Known issues (kept as-is):
 * - src/db/transactions-store.js, mark-duplicated and market-search-filters call
 *   `loadClubPlayers()` without arguments, which resolves `{}` and loads nothing.
 * - The cache is built from the value `searchClubPlayers` resolves, which holds only the items of
 *   the last page (each page replaces the previous one there).
 */
import {
  clubPlayersSearchPromise,
  searchClubPlayers,
  searchClubPlayersByDefinitionIds,
} from "./club-search.js";
import { translate } from "../i18n/translations.js";
import { setBannerMessage } from "../ui/banner.js";

export let clubPlayersByDefinitionId = {};

export let definitionIdsNotInClub = new Set();

let isClubPlayersCacheLoaded = false;

function indexByDefinitionId(players) {
  if (!players) {
    return {};
  }
  const playersByDefinitionId = {};
  for (let player of players) {
    playersByDefinitionId[player.definitionId] = player;
  }
  return playersByDefinitionId;
}

export async function findOwnedClubPlayers(
  sourceItems,
  unusedArgument2,
  returnAsMap = false,
  bypassCache = false,
) {
  const definitionIds = sourceItems
    .filter((item) => item instanceof UTStaticPlayerDataDTO || item.isPlayer())
    .map((item) => (item instanceof UTStaticPlayerDataDTO ? item.id : item.definitionId));
  {
    let ownedPlayers = returnAsMap ? {} : [];
    let definitionIdsToFetch = [];
    for (let definitionId of definitionIds) {
      const cachedPlayer = bypassCache ? null : clubPlayersByDefinitionId[definitionId];
      if (cachedPlayer) {
        if (returnAsMap) {
          ownedPlayers[cachedPlayer.definitionId] = cachedPlayer;
        } else {
          ownedPlayers.push(cachedPlayer);
        }
      } else if (bypassCache) {
        definitionIdsToFetch.push(definitionId);
      } else if (!definitionIdsNotInClub.has(definitionId)) {
        definitionIdsToFetch.push(definitionId);
      }
    }
    for (let clubPlayer of await searchClubPlayersByDefinitionIds(definitionIdsToFetch)) {
      if (-1 === clubPlayer.loans) {
        if (returnAsMap) {
          ownedPlayers[clubPlayer.definitionId] = clubPlayer;
        } else {
          ownedPlayers.push(clubPlayer);
        }
        clubPlayersByDefinitionId[clubPlayer.definitionId] = clubPlayer;
      }
    }
    for (let definitionId of definitionIds) {
      if (!clubPlayersByDefinitionId[definitionId]) {
        definitionIdsNotInClub.add(definitionId);
      }
    }
    return ownedPlayers;
  }
}

export async function loadClubPlayers(onProgress, shouldLoad = false, forceReload = false) {
  if (!shouldLoad) {
    return new Promise((resolve) => resolve({}));
  }
  if (forceReload) {
    isClubPlayersCacheLoaded = false;
    clubPlayersByDefinitionId = {};
  }
  if (isClubPlayersCacheLoaded) {
    return new Promise((resolve) => resolve(clubPlayersByDefinitionId));
  }
  let loadedPlayersByDefinitionId = {};
  return new Promise((resolve) => {
    var excludeLoans;
    var definitionIdFilter;
    var reportProgress;
    ((excludeLoans = true),
    (definitionIdFilter = null),
    (reportProgress = (loadedCount, loadedPlayers) => {
      loadedPlayersByDefinitionId = indexByDefinitionId(loadedPlayers);
      setBannerMessage(translate("ui.loadingPlayers").replace("{count}", loadedCount));
      if (onProgress) {
        onProgress(loadedCount);
      }
    }),
    new Promise((resolveClubPlayers) => {
      var pendingLoad;
      var continueWithState;
      var pendingMarker;
      var raceCandidates;
      if (clubPlayersSearchPromise) {
        pendingLoad = clubPlayersSearchPromise;
        continueWithState = (promiseState) => {
          if (promiseState !== "pending") {
            clubPlayersSearchPromise = searchClubPlayers(
              excludeLoans,
              definitionIdFilter,
              reportProgress,
              null,
              true,
            );
          }
          clubPlayersSearchPromise.then(resolveClubPlayers);
        };
        pendingMarker = window.Symbol ? Symbol("unique") : /unique/;
        raceCandidates = [pendingLoad, Promise.resolve(pendingMarker)];
        Promise.race(raceCandidates).then(
          function (settledValue) {
            return continueWithState(settledValue === pendingMarker ? "pending" : "fulfilled");
          },
          function (rejectionReason) {
            return continueWithState("rejected");
          },
        );
      } else {
        clubPlayersSearchPromise = searchClubPlayers(
          excludeLoans,
          definitionIdFilter,
          reportProgress,
          null,
          true,
        );
        clubPlayersSearchPromise.then(resolveClubPlayers);
      }
    })).then((clubPlayers) => {
      loadedPlayersByDefinitionId = indexByDefinitionId(clubPlayers);
      setBannerMessage("");
      const previousPlayersByDefinitionId = clubPlayersByDefinitionId;
      clubPlayersByDefinitionId = loadedPlayersByDefinitionId;
      if (previousPlayersByDefinitionId) {
        for (let definitionId of Object.keys(previousPlayersByDefinitionId)) {
          clubPlayersByDefinitionId[definitionId] = previousPlayersByDefinitionId[definitionId];
        }
      }
      isClubPlayersCacheLoaded = true;
      resolve(clubPlayersByDefinitionId);
    });
  });
}
