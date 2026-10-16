/**
 * FUT.GG price data client. `fetchFutggPlayerPrices(year, platform)` downloads the public price
 * files from `https://r2.fut.gg` and returns `Map(definitionId -> {price, isSbc, isObjective})`.
 * Called only by the futgg provider in src/market/external-prices/index.js (with
 * `APP_YEAR_SHORT`).
 *
 * Invariants:
 * - URLs: `<base>/<year>/manifest.json`, then
 *   `<base>/<year>/<key>.v<manifest._version>.<manifest[key]>.json` for `player-prices-index`
 *   and `player-prices-pc-dyn` (`GamePlatform.PC`) or `player-prices-ps5-dyn` (any other
 *   platform). A key missing from the manifest throws.
 * - The index is delta-encoded (`id0` plus deltas `d`); the data file's `p` (prices) and `s`
 *   (statuses) arrays must match the decoded id count or it throws. Status 1 = SBC,
 *   2 = objective; a falsy price becomes null.
 * - Results are cached per `"<year>-<platform>"` in `ExpiringCache(300)`, whose TTL is in
 *   seconds (5 minutes).
 */
import { ExpiringCache } from "../../core/expiring-cache.js";
import { requestHttp } from "../../core/http.js";

const futggPricesBaseUrl = "https://r2.fut.gg";

let futggPricesCache = new ExpiringCache(300);

function getFutggManifestFileUrl({ year: year, manifest: manifest, key: key }) {
  const version = manifest._version;
  const manifestEntry = manifest[key];
  if (!manifestEntry) {
    throw new Error("Manifest missing key: " + key);
  }
  return (
    futggPricesBaseUrl + "/" + year + "/" + key + ".v" + version + "." + manifestEntry + ".json"
  );
}

function decodeFutggIds(encodedIds) {
  const ids = [encodedIds.id0];
  let currentId = encodedIds.id0;
  for (const delta of encodedIds.d) {
    currentId += delta;
    ids.push(currentId);
  }
  return ids;
}

export async function fetchFutggPlayerPrices(year, platform) {
  let cacheKey = year + "-" + platform;
  let prices = futggPricesCache.get(cacheKey);
  if (prices) {
    return prices;
  }
  const manifest = await (
    await (async function (manifestYear) {
      return await requestHttp(futggPricesBaseUrl + "/" + manifestYear + "/manifest.json");
    })(year)
  ).json();
  prices = (function (priceIndex, priceData) {
    const definitionIds = decodeFutggIds(priceIndex);
    const pricesById = (function (priceIndex, priceData) {
      const decodedIds = decodeFutggIds(priceIndex);
      if (priceData.p.length !== decodedIds.length) {
        throw new Error(
          "Length mismatch: " +
            priceData.p.length +
            " prices for " +
            decodedIds.length +
            " decoded EA IDs",
        );
      }
      const priceMap = new Map();
      for (let index = 0; index < decodedIds.length; index += 1) {
        priceMap.set(decodedIds[index], priceData.p[index] || null);
      }
      return priceMap;
    })(priceIndex, priceData);
    const statusesById = (function (priceIndex, priceData) {
      const decodedIds = decodeFutggIds(priceIndex);
      if (priceData.s.length !== decodedIds.length) {
        throw new Error(
          "Length mismatch: " +
            priceData.s.length +
            " statuses for " +
            decodedIds.length +
            " decoded EA IDs",
        );
      }
      const statusMap = new Map();
      for (let index = 0; index < decodedIds.length; index += 1) {
        statusMap.set(decodedIds[index], priceData.s[index] ?? null);
      }
      return statusMap;
    })(priceIndex, priceData);
    let pricesByDefinitionId = new Map();
    for (let definitionId of definitionIds) {
      pricesByDefinitionId.set(definitionId, {
        price: pricesById.get(definitionId) ?? null,
        isSbc: statusesById.get(definitionId) === 1,
        isObjective: statusesById.get(definitionId) === 2,
      });
    }
    return pricesByDefinitionId;
  })(
    await (
      await requestHttp(
        getFutggManifestFileUrl({
          year: year,
          manifest: manifest,
          key: "player-prices-index",
        }),
      )
    ).json(),
    await (
      await requestHttp(
        getFutggManifestFileUrl({
          year: year,
          manifest: manifest,
          key: "player-prices-" + (platform == GamePlatform.PC ? "pc" : "ps5") + "-dyn",
        }),
      )
    ).json(),
  );
  futggPricesCache.set(cacheKey, prices);
  return prices;
}
