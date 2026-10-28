/**
 * `searchAutoSnipeMarket(playerId, maxPrice, filters)`: one transfer-market search for Auto Snipe
 * (added in 27.2.1). Resolves the offers of the first results page as
 * `{ item, playerId, price, active }`, sorted by buy-now price (cheapest first).
 *
 * Invariants:
 * - The criteria are a copy of `filters` (the Auto Snipe filter view's search criteria) with
 *   `type` defaulting to PLAYER, `maskedDefId = playerId` when it is positive, and
 *   `maxBuy = maxPrice`; the search runs with `disableOverrides`, so the result transformers and
 *   validators of src/market/search-hooks.js do not apply.
 * - Like the Web App, it sends the "Transfer Market Search" page view and clears the
 *   transfer-market cache before searching, and the "Transfer Market Results - List View" page
 *   view after.
 * - It rejects with `plugins.autoSnipe.timeout` after 30 s without a response, and with
 *   `plugins.autoSnipe.httpError (<status or error code or "unknown">)` for a missing,
 *   unsuccessful or >= 400 response; the observer is removed in every case.
 * - `playerId` of a result is `definitionId & ItemIdMask.DATABASE` (the base player id);
 *   `active` means the auction is still ACTIVE.
 * - The `var searchObservable` assigned inside the `await` comes from a helper the original
 *   bundle inlined there; it is kept as-is.
 */
import { translate } from "../../i18n/translations.js";
import { trackPageView } from "../../webapp/telemetry.js";

const translateAutoSnipeSearchText = (translationKey) =>
  translate("plugins.autoSnipe." + translationKey);

export async function searchAutoSnipeMarket(playerId, maxPrice, filters = {}) {
  const searchCriteria = new UTSearchCriteriaDTO();
  const searchViewModel = new UTBucketedItemSearchViewModel();
  Object.assign(searchCriteria, filters);
  searchCriteria.type = filters.type || SearchType.PLAYER;
  if (playerId > 0) {
    searchCriteria.maskedDefId = playerId;
  }
  searchCriteria.maxBuy = maxPrice;
  searchViewModel.searchFeature = ItemSearchFeature.MARKET;
  searchViewModel.defaultSearchCriteria.type = searchCriteria.type;
  searchViewModel.defaultSearchCriteria.category = searchCriteria.category;
  searchViewModel.updateSearchCriteria(searchCriteria);
  searchViewModel.searchCriteria.disableOverrides = true;
  trackPageView("Transfer Market Search");
  services.Item.clearTransferMarketCache();
  const response = await ((searchObservable = services.Item.searchTransferMarket(
    searchViewModel.searchCriteria,
    1,
  )),
  new Promise((resolve, reject) => {
    const observer = {};
    const timeoutId = setTimeout(() => {
      searchObservable.unobserve(observer);
      reject(new Error(translateAutoSnipeSearchText("timeout")));
    }, 30000);
    try {
      searchObservable.observe(observer, (observable, searchResponse) => {
        clearTimeout(timeoutId);
        observable.unobserve(observer);
        if (!searchResponse || !searchResponse.success || Number(searchResponse.status) >= 400) {
          reject(
            new Error(
              translateAutoSnipeSearchText("httpError") +
                " (" +
                (searchResponse?.status ?? searchResponse?.error?.code ?? "unknown") +
                ")",
            ),
          );
        } else {
          resolve(searchResponse);
        }
      });
    } catch (error) {
      clearTimeout(timeoutId);
      searchObservable.unobserve(observer);
      reject(error);
    }
  }));
  var searchObservable;
  trackPageView("Transfer Market Results - List View");
  return response.data.items
    .map((item) => ({
      item: item,
      playerId: item.definitionId & ItemIdMask.DATABASE,
      price: item.getAuctionData().buyNowPrice,
      active: item.getAuctionData()._tradeState === AuctionTradeStateEnum.ACTIVE,
    }))
    .sort((left, right) => left.price - right.price);
}
