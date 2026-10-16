/**
 * Gallery data and search helpers used by the gallery view, controller and plugin:
 * `galleryCategories` / `galleryBonusTags` (filled by `openGallery` in gallery/index.js after
 * decoding the bundled data), set lookup, per-set search criteria and a search-promise cache.
 *
 * Invariants:
 * - `galleryCategories` and `galleryBonusTags` are shared arrays filled once by `push`; consumers
 *   hold the references, so never reassign them.
 * - `getGallerySetCriteria`: club sets (plus linked clubs from `teamConfigRepo.getTeamLinks()`
 *   when the description says "Mens or Womens", or only women's clubs of leagues
 *   2215/2216/2218/2222 when it says "Women"), league sets (`galleryLeagueIdBySetId`), rarity
 *   sets (`galleryRarityBySetId`, 127, 116) and set 113 (all players); any other set id throws.
 * - `createGallerySearchCriteria`: players, rating descending, page size
 *   `configuration.requests.maxItemsCount`.
 * - `getCachedGalleryPromise` evicts a rejected promise only if the cache still holds it;
 *   `galleryCriteriaSearchCache` is cleared on ITEM_MOVED, ITEM_DISCARDED, SBC_SUBMITTED and
 *   ITEM_WON by listeners added once (`galleryCacheListenersRegistered`) and never removed.
 */
import { configuration } from "../../config/configuration.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";

export const galleryCategories = [];

export const galleryBonusTags = [];

const galleryLeagueIdBySetId = {
  108: 13,
  100: 2216,
  111: 16,
  115: 2218,
  109: 53,
  121: 2222,
  103: 31,
  122: 19,
  120: 2215,
};

const galleryRarityBySetId = {
  99: 3,
  102: 72,
  114: 87,
};

export const galleryCriteriaSearchCache = new Map();

let galleryCacheListenersRegistered = false;

export function findGallerySet(setId) {
  return galleryCategories
    .flatMap((category) => category.sets)
    .find((gallerySet) => gallerySet.id === Number(setId));
}

export function getGallerySetCriteria(gallerySet) {
  if (gallerySet.clubEaId != null) {
    let clubIds = [gallerySet.clubEaId];
    const linkedClubIds = [];
    for (const [
      firstClubId,
      secondClubId,
    ] of factories.DataProvider.teamConfigRepo.getTeamLinks()) {
      if (firstClubId === gallerySet.clubEaId) {
        linkedClubIds.push(secondClubId);
      } else if (secondClubId === gallerySet.clubEaId) {
        linkedClubIds.push(firstClubId);
      }
    }
    if (/Mens or Womens/i.test(gallerySet.description)) {
      clubIds.push(...linkedClubIds);
    } else if (/Women/i.test(gallerySet.description)) {
      const womensClubIds = new Set(
        [2215, 2216, 2218, 2222].flatMap((leagueId) =>
          factories.DataProvider.getTeamDP(leagueId)
            .filter((team) => team.id > 0)
            .map((team) => team.id),
        ),
      );
      clubIds = [...clubIds, ...linkedClubIds].filter((clubId) => womensClubIds.has(clubId));
      if (!clubIds.length) {
        throw new Error("Missing women's team mapping for " + gallerySet.name);
      }
    }
    return [...new Set(clubIds)].map((clubId) => ({
      club: clubId,
    }));
  }
  if (galleryLeagueIdBySetId[gallerySet.id]) {
    return [
      {
        league: galleryLeagueIdBySetId[gallerySet.id],
      },
    ];
  }
  if (galleryRarityBySetId[gallerySet.id]) {
    return [
      {
        rarities: [galleryRarityBySetId[gallerySet.id]],
      },
    ];
  }
  if (gallerySet.id === 127) {
    return [
      {
        rarities: [150, 22, 71],
      },
    ];
  }
  if (gallerySet.id === 116) {
    return [
      {
        rarities: [0, 1],
      },
    ];
  }
  if (gallerySet.id === 113) {
    return [{}];
  }
  throw new Error("Unknown gallery set " + gallerySet.id);
}

export function createGallerySearchCriteria(criteriaOverrides) {
  return Object.assign(
    new UTSearchCriteriaDTO(),
    {
      type: SearchType.PLAYER,
      offset: 0,
      count: configuration.requests.maxItemsCount,
      sortBy: SearchSortType.RATING,
      sort: SearchSortOrder.DESCENDING,
    },
    criteriaOverrides,
  );
}

export function getCachedGalleryPromise(cache, cacheKey, createPromise) {
  if (!cache.has(cacheKey)) {
    const pendingPromise = createPromise().catch((error) => {
      if (cache.get(cacheKey) === pendingPromise) {
        cache.delete(cacheKey);
      }
      throw error;
    });
    cache.set(cacheKey, pendingPromise);
  }
  return cache.get(cacheKey);
}

export function registerGalleryCacheInvalidation() {
  if (!galleryCacheListenersRegistered) {
    galleryCacheListenersRegistered = true;
    for (const eventName of [
      paletoolsEvents.ITEM_MOVED,
      paletoolsEvents.ITEM_DISCARDED,
      paletoolsEvents.SBC_SUBMITTED,
      paletoolsEvents.ITEM_WON,
    ]) {
      listenForEvent(eventName, () => {
        galleryCriteriaSearchCache.clear();
      });
    }
  }
}
