/**
 * Album data helpers shared by album/index.js, album-view-controller.js and the gallery
 * controller: per-club cache of concept-search results, album entry creation and owner
 * enrichment.
 *
 * Invariants:
 * - `albumClubPlayersCache` (club id -> search promise, filled by `AlbumViewController`) is
 *   cleared on ITEM_MOVED, ITEM_DISCARDED, SBC_SUBMITTED and ITEM_WON;
 *   `registerAlbumCacheInvalidation` adds these page-window listeners once
 *   (`albumCacheListenersRegistered`), never removed.
 * - `createAlbumEntries` dedupes by definitionId; items with `isCollected` become status
 *   `tracked` (a copy with `concept`/`isConceptPlayer` false), others `missing`; sorted by
 *   rating, grading score, name, definitionId.
 * - `addOwnersToAlbumEntries` prefers owners stored in `paletoolsDatabase.trackedPlayers`; for
 *   the rest it uses the club index when `plugins.clubIndex.enabled`, else a club search by
 *   definition ids, ignoring limited-use and concept items and keeping an owners value of 1 once
 *   seen. It returns prototype-preserving item copies and `canMarkFirstOwner = owners !== 1`.
 */
import { getOrLoadClubIndexPlayers } from "../../club/club-index.js";
import { searchClubPlayersByDefinitionIds } from "../../club/club-search.js";
import { configuration } from "../../config/configuration.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { paletoolsDatabase } from "../../db/database.js";

let albumCacheListenersRegistered = false;

export const albumClubPlayersCache = new Map();

export function createAlbumEntries(items) {
  return [...new Map(items.map((item) => [item.definitionId, item])).values()]
    .map((item) => {
      const tracked = Boolean(item.isCollected);
      return {
        item: tracked
          ? Object.assign(Object.create(Object.getPrototypeOf(item)), item, {
              concept: false,
              isConceptPlayer: false,
            })
          : item,
        tracked: tracked,
        status: tracked ? "tracked" : "missing",
      };
    })
    .sort((left, right) => {
      const getName = (item) => item.getStaticData().name || "";
      return (
        (right.item.rating || 0) - (left.item.rating || 0) ||
        (right.item.gradingScore || 0) - (left.item.gradingScore || 0) ||
        getName(left.item).localeCompare(getName(right.item), undefined, {
          sensitivity: "base",
        }) ||
        left.item.definitionId - right.item.definitionId
      );
    });
}

export function registerAlbumCacheInvalidation() {
  if (!albumCacheListenersRegistered) {
    albumCacheListenersRegistered = true;
    for (const eventName of [
      paletoolsEvents.ITEM_MOVED,
      paletoolsEvents.ITEM_DISCARDED,
      paletoolsEvents.SBC_SUBMITTED,
      paletoolsEvents.ITEM_WON,
    ]) {
      listenForEvent(eventName, () => {
        albumClubPlayersCache.clear();
      });
    }
  }
}

export async function addOwnersToAlbumEntries(albumEntries) {
  const storedOwners = await paletoolsDatabase.trackedPlayers.all();
  const unknownOwnerDefinitionIds = [
    ...new Set(
      albumEntries
        .map((entry) => entry.item.definitionId)
        .filter((definitionId) => !storedOwners.has(definitionId)),
    ),
  ];
  let ownerLookupItems = [];
  if (unknownOwnerDefinitionIds.length) {
    if (configuration.plugins.clubIndex?.enabled) {
      const unknownOwnerDefinitionIdSet = new Set(unknownOwnerDefinitionIds);
      ownerLookupItems = (await getOrLoadClubIndexPlayers()).filter((item) =>
        unknownOwnerDefinitionIdSet.has(item.definitionId),
      );
    } else {
      ownerLookupItems = await searchClubPlayersByDefinitionIds(unknownOwnerDefinitionIds);
    }
  }
  const ownersByDefinitionId = new Map();
  for (const item of ownerLookupItems) {
    if (!(item.isLimitedUse() || item.concept || item.isConceptPlayer)) {
      if (ownersByDefinitionId.get(item.definitionId) !== 1 && item.owners !== undefined) {
        ownersByDefinitionId.set(item.definitionId, item.owners);
      }
    }
  }
  return albumEntries.map((entry) => {
    const definitionId = entry.item.definitionId;
    const owners = storedOwners.has(definitionId)
      ? storedOwners.get(definitionId)
      : ownersByDefinitionId.get(definitionId);
    const itemCopy = Object.assign(Object.create(Object.getPrototypeOf(entry.item)), entry.item);
    if (owners !== undefined) {
      itemCopy.owners = owners;
    }
    return {
      ...entry,
      item: itemCopy,
      canMarkFirstOwner: owners !== 1,
    };
  });
}
