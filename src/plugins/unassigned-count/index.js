/**
 * Unassigned Count plugin (`unassignedCountPlugin`), installed by the plugin list in
 * src/bootstrap/boot.js: shows the real unassigned pile size instead of the Web App's cap of 50.
 *
 * Hooks:
 * - `run()` sets `MAX_NEW_ITEMS = Number.MAX_VALUE` on the page window and wraps
 *   `UTUnassignedTileView.prototype.setNumberOfItems` (after original): for a count of 50 it shows
 *   the cached size, or `translate("loading")` while `requestHttp("usermassinfo")` fetches
 *   `userInfo.unassignedPileSize`.
 *
 * Invariants:
 * - No settings and no enable check: always active. It has no `order`, so its position in the
 *   boot sort is not well-defined (the comparator yields NaN) and depends on the JS engine.
 * - The size is cached in an in-memory `ExpiringCache` under key `count`.
 *
 * Known issues (kept as-is):
 * - The cache TTL is `300000`, but `ExpiringCache` takes seconds (about 83 hours), so the first
 *   fetched size is reused for the rest of the session.
 * - A failed `usermassinfo` request leaves the tile on the loading text (unhandled rejection).
 */
import { ExpiringCache } from "../../core/expiring-cache.js";
import { requestHttp } from "../../core/http.js";
import { getPageWindow } from "../../core/page-window.js";
import { translate } from "../../i18n/translations.js";

let unassignedCountPluginDefinition;

unassignedCountPluginDefinition = {
  run: () => {
    const unassignedCountCache = new ExpiringCache(300000);
    getPageWindow().MAX_NEW_ITEMS = Number.MAX_VALUE;
    const originalSetNumberOfItems = UTUnassignedTileView.prototype.setNumberOfItems;
    UTUnassignedTileView.prototype.setNumberOfItems = function (...args) {
      originalSetNumberOfItems.call(this, ...args);
      let itemCount = args[0];
      if (itemCount === 50) {
        itemCount = unassignedCountCache.get("count");
        if (itemCount) {
          originalSetNumberOfItems.call(this, itemCount);
        } else {
          originalSetNumberOfItems.call(this, translate("loading"));
          (async () => {
            itemCount = await (async function () {
              return (await requestHttp("usermassinfo")).userInfo.unassignedPileSize;
            })();
            originalSetNumberOfItems.call(this, itemCount);
            unassignedCountCache.set("count", itemCount);
          })();
        }
      }
    };
  },
};

export const unassignedCountPlugin = unassignedCountPluginDefinition;
