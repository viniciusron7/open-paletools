/**
 * Five-minute cache (`ExpiringCache(300)`, TTL in seconds) of the lowest known buy-now price per
 * definitionId. Written by `findLowestMarketPrices` and the compare-min-max-prices plugin; read by
 * the `UTQuickListPanelViewController.renderView` patch in src/webapp/patches.js and by the
 * lowest-market-price and keep-player-sell-values plugins.
 *
 * Known issues (kept as-is):
 * - Two value shapes are stored: `findLowestMarketPrices` stores `{value, count}`,
 *   compare-min-max-prices a plain number. patches.js and lowest-market-price read `.value`,
 *   keep-player-sell-values uses the entry as a number, so each reader mishandles one shape.
 */
import { ExpiringCache } from "../core/expiring-cache.js";

const lowestMarketPriceCache = new ExpiringCache(300);

export function cacheLowestMarketPrice(definitionId, lowestPriceInfo) {
  lowestMarketPriceCache.set(definitionId, lowestPriceInfo);
}

export function getCachedLowestMarketPrice(definitionId) {
  return lowestMarketPriceCache.get(definitionId);
}
