/**
 * Transfer-market price step helpers. `decreasePriceByOneStep` is used by src/webapp/patches.js
 * (quick-list bid), src/market/listing.js, src/market/lowest-price-search.js and the
 * keep-player-sell-values plugin; `roundToValidPrice` by listing, the lowest-price search,
 * list-for-profit and the player-snipe selection.
 *
 * Invariants:
 * - Valid steps: 50 below 1,000; 100 from 1,000; 250 from 10,000; 500 from 50,000; 1,000 from
 *   100,000. `decreasePriceByOneStep` subtracts the step valid just below the price (tier upper
 *   bounds inclusive: 1,000 -> 950, 10,000 -> 9,900, 50,000 -> 49,750, 100,000 -> 99,500) and
 *   does not clamp at the 200 minimum.
 * - `roundToValidPrice(price, minimumPrice = 0)` rounds to the `inc` of the first
 *   `UTCurrencyInputControl.PRICE_TIERS` entry with `price >= min` (EA orders tiers from highest
 *   `min` down), then caps at 14,999,000 and floors at `minimumPrice`.
 * - `roundToValidPrice` must stay a top-level function declaration with this name:
 *   tests/support/market-automation-sources.cjs evaluates it from this file.
 */
export function decreasePriceByOneStep(price) {
  return price <= 1000
    ? price - 50
    : price > 1000 && price <= 10000
      ? price - 100
      : price > 10000 && price <= 50000
        ? price - 250
        : price > 50000 && price <= 100000
          ? price - 500
          : price - 1000;
}

export function roundToValidPrice(price, minimumPrice = 0) {
  let priceTier = JSUtils.find(UTCurrencyInputControl.PRICE_TIERS, function (tier) {
    return price >= tier.min;
  });
  var roundedPrice = Math.round(price / priceTier.inc) * priceTier.inc;
  return Math.max(Math.min(roundedPrice, 14999000), minimumPrice);
}
