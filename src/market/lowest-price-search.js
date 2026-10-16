/**
 * `findLowestMarketPrices(definitionId, itemType, maxResults = 3)` probes the transfer market for
 * the lowest buy-now prices of one item definition. Used by the album plugin, the player-actions
 * find-lowest-price and list-for-profit actions and the lowest-market-price plugin.
 *
 * Invariants:
 * - At most 9 searches: each clears EA's transfer-market cache, sends PIN page views ("Transfer
 *   Market Search", then "Transfer Market Results - List View" and "Item - Detail View" on
 *   success) and lowers `maxBuy` to one price step below the lowest buy-now found. It stops on an
 *   empty result or a page shorter than `searchCriteria.count`, waiting 100-300 ms between pages.
 * - Entries `{value, count}` are unshifted, so index 0 is the lowest price; that entry is cached
 *   with `cacheLowestMarketPrice`. Returns that entry (possibly undefined) when `maxResults <= 1`,
 *   otherwise an array of up to `maxResults` entries.
 * - Searches set `disableOverrides = true`, bypassing the Paletools transformers and validators;
 *   the search wrapper still swaps the notification queue and this module does not restore it.
 * - `itemType` maps to search type/category: BADGE/KIT -> CLUB_INFO + category, HEALTH ->
 *   CONSUMABLES_DEVELOPMENT/HEALING, TRAINING -> CONSUMABLES_TRAINING, MANAGER -> STAFF, NONE ->
 *   ANY, any other value is used as the type.
 */
import { waitForDelay } from "../core/async.js";
import { cacheLowestMarketPrice } from "./lowest-price-cache.js";
import { decreasePriceByOneStep, roundToValidPrice } from "./prices.js";
import { trackPageView } from "../webapp/telemetry.js";

export async function findLowestMarketPrices(
  definitionId,
  itemType = SearchType.PLAYER,
  maxResults = 3,
) {
  if (typeof definitionId === "string") {
    definitionId = parseInt(definitionId);
  }
  const marketSearchCriteria = new UTSearchCriteriaDTO();
  const marketSearchViewModel = new UTBucketedItemSearchViewModel();
  (function (criteria, category) {
    criteria.type = null;
    criteria.category = null;
    if (category === ItemType.BADGE || category === ItemType.KIT) {
      criteria.category = category;
      criteria.type = SearchType.CLUB_INFO;
    } else if (category === ItemType.HEALTH) {
      criteria.type = SearchType.CONSUMABLES_DEVELOPMENT;
      criteria.category = SearchCategory.HEALING;
    } else if (category !== ItemType.TRAINING) {
      if (category !== ItemType.MANAGER) {
        if (category !== ItemType.NONE) {
          criteria.type = category;
        } else {
          criteria.type = SearchType.ANY;
        }
      } else {
        criteria.type = SearchType.STAFF;
      }
    } else {
      criteria.type = SearchType.CONSUMABLES_TRAINING;
    }
  })(marketSearchCriteria, itemType);
  marketSearchCriteria.defId = [definitionId];
  marketSearchViewModel.searchFeature = ItemSearchFeature.MARKET;
  marketSearchViewModel.defaultSearchCriteria.type = marketSearchCriteria.type;
  marketSearchViewModel.defaultSearchCriteria.category = marketSearchCriteria.category;
  let lowestPrices = [];
  let attempt = 0;
  for (; ++attempt != 10; ) {
    trackPageView("Transfer Market Search");
    services.Item.clearTransferMarketCache();
    marketSearchViewModel.updateSearchCriteria(marketSearchCriteria);
    let searchResults = await searchTransferMarketPage(marketSearchViewModel.searchCriteria);
    if (searchResults.length === 0) {
      break;
    }
    const lowestBuyNowPrice = Math.min(
      ...searchResults.map((item) => item.getAuctionData().buyNowPrice),
    );
    lowestPrices.unshift({
      value: lowestBuyNowPrice,
      count: searchResults.filter((item) => item.getAuctionData().buyNowPrice === lowestBuyNowPrice)
        .length,
    });
    marketSearchCriteria.maxBuy = roundToValidPrice(decreasePriceByOneStep(lowestBuyNowPrice));
    if (searchResults.length < marketSearchViewModel.searchCriteria.count) {
      break;
    }
    await waitForDelay(100, 300);
  }
  if (lowestPrices.length > 0) {
    cacheLowestMarketPrice(definitionId, lowestPrices[0]);
  }
  return maxResults <= 1 ? lowestPrices[0] : lowestPrices.slice(0, maxResults);
}

function searchTransferMarketPage(searchCriteria) {
  return new Promise((resolve, reject) => {
    searchCriteria.disableOverrides = true;
    services.Item.searchTransferMarket(searchCriteria, 1).observe(this, (sender, response) => {
      if (response.success) {
        trackPageView("Transfer Market Results - List View");
        trackPageView("Item - Detail View");
        resolve(response.data.items);
      } else {
        resolve([]);
      }
    });
  });
}
