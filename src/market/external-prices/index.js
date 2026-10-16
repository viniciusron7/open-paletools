/**
 * External (FUT.GG) market prices for player items. `requestExternalPrices(items)` is used by the
 * external-market-prices plugin and the price-tracker view model; `getActivePriceProvider()`
 * returns the only provider (`futgg`), whose `init(platform)` the external-market-prices plugin
 * calls once in `run()`.
 *
 * Invariants:
 * - `init()` returns early when `canAccessExternalHosts()` is false; otherwise it loads
 *   `allPrices` asynchronously (setTimeout 0) and refreshes it every 310000 ms with a
 *   `setInterval` that is never cleared.
 * - `getItemPrices` returns `ExternalItemPrice` objects only for players found in `allPrices`
 *   (`isExtinct` when the price is null).
 * - `requestExternalPrices` debounces: calls within 10 ms of each other share one batch; each
 *   caller resolves with `{definitionId: ExternalItemPrice | undefined}` for its own items. Items
 *   only need `definitionId` and `isPlayer()` (the price tracker passes plain objects). Found
 *   prices are cached per definitionId in `externalPriceCache`; missing ones are asked again.
 *
 * Known issues (kept as-is):
 * - `externalPriceCache` is `new ExpiringCache(300000)` and that TTL is in seconds (about 83 h),
 *   so cached prices outlive the 310 s `allPrices` refresh.
 * - `getItemPrices` dereferences `this.allPrices`, undefined until the first fetch completes, so
 *   an early batch throws inside the timer and its callers wait until a later batch resolves them.
 * - `paletoolsImages.logosvg;` is a leftover no-op statement.
 */
import { ExpiringCache } from "../../core/expiring-cache.js";
import { canAccessExternalHosts } from "../../core/http.js";
import { fetchFutggPlayerPrices } from "./futgg.js";
import { ExternalItemPrice, ExternalPriceProvider } from "./price-provider.js";
import { paletoolsImages } from "../../ui/images.js";
import { getGamePlatform } from "../../webapp/user.js";

const externalPriceCache = new ExpiringCache(300000);

const priceProviders = {
  futgg: new (class extends ExternalPriceProvider {
    async ["init"](platform) {
      if (!(await canAccessExternalHosts())) {
        return [];
      }
      setTimeout(async () => {
        this.allPrices = await fetchFutggPlayerPrices(APP_YEAR_SHORT, platform);
      }, 0);
      setInterval(async () => {
        this.allPrices = await fetchFutggPlayerPrices(APP_YEAR_SHORT, platform);
      }, 310000);
    }
    async ["getItemPrices"](requestedItems, platform) {
      if (!(await canAccessExternalHosts())) {
        return [];
      }
      const prices = [];
      for (const item of requestedItems) {
        if (!item.definitionId) {
          continue;
        }
        if (!item.isPlayer()) {
          continue;
        }
        const priceEntry = this.allPrices.get(item.definitionId);
        if (priceEntry) {
          prices.push(
            new ExternalItemPrice(
              item.definitionId,
              priceEntry.price,
              platform,
              priceEntry.price == null,
              priceEntry.isObjective,
              priceEntry.isSbc,
            ),
          );
        }
      }
      return prices;
    }
  })(),
};

export function getActivePriceProvider() {
  return priceProviders.futgg;
}

paletoolsImages.logosvg;

let pendingExternalPriceRequests = [];

let externalPriceBatchTimeoutId = null;

export async function requestExternalPrices(requestedItems) {
  return new Promise((resolve) => {
    pendingExternalPriceRequests.push({
      resolve: resolve,
      items: requestedItems,
      prices: {},
    });
    if (externalPriceBatchTimeoutId) {
      clearTimeout(externalPriceBatchTimeoutId);
    }
    externalPriceBatchTimeoutId = setTimeout(async () => {
      const playersByDefinitionId = new Map();
      for (const item of pendingExternalPriceRequests.map((request) => request.items).flat()) {
        if (item.isPlayer()) {
          playersByDefinitionId.set(item.definitionId, item);
        }
      }
      const uniquePlayers = Array.from(playersByDefinitionId.values());
      const pricesByDefinitionId = await (async function (players) {
        if (!(await canAccessExternalHosts())) {
          return {};
        }
        if ((players = players.filter((item) => item.isPlayer())).length === 0) {
          return {};
        }
        const priceProvider = getActivePriceProvider();
        const uncachedPlayers = [];
        const prices = {};
        for (let player of players) {
          const cachedPrice = externalPriceCache.get(player.definitionId);
          if (cachedPrice) {
            prices[player.definitionId] = cachedPrice;
          } else {
            uncachedPlayers.push(player);
          }
        }
        if (uncachedPlayers.length > 0) {
          const itemPrices = await priceProvider.getItemPrices(uncachedPlayers, getGamePlatform());
          for (let itemPrice of itemPrices) {
            prices[itemPrice.definitionId] = itemPrice;
            externalPriceCache.set(itemPrice.definitionId, itemPrice);
          }
        }
        return prices;
      })(uniquePlayers);
      for (const request of pendingExternalPriceRequests) {
        for (const item of request.items) {
          request.prices[item.definitionId] = pricesByDefinitionId[item.definitionId];
        }
        request.resolve(request.prices);
      }
      pendingExternalPriceRequests = [];
      externalPriceBatchTimeoutId = null;
    }, 10);
  });
}
