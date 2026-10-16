/**
 * Helpers for the market search min/max price rows (rows exposing `_currencyInput._currencyInput`).
 * Used by the legacy snipe plugin and the player-snipe selection.
 *
 * Invariants:
 * - `incrementPriceRowWithinMax` raises the input one tick (`increase()`), or `reset()`s it when
 *   the next tick (`UTCurrencyInputControl.getIncrementAboveVal`) would reach a positive
 *   `maxBuyNowPrice`. `getPriceRowValue` returns 0 when the row structure is missing.
 * - `getPriceRowValue` must stay a top-level function declaration with this name:
 *   tests/support/market-automation-sources.cjs evaluates it from this file.
 */
export function incrementPriceRowWithinMax(priceRow, maxBuyNowPrice) {
  if (
    maxBuyNowPrice > 0 &&
    UTCurrencyInputControl.getIncrementAboveVal(priceRow._currencyInput._currencyInput.value) >=
      maxBuyNowPrice
  ) {
    priceRow._currencyInput.reset();
  } else {
    priceRow._currencyInput._currencyInput.increase();
  }
}

export function getPriceRowValue(priceRow) {
  try {
    return priceRow._currencyInput._currencyInput.value;
  } catch {
    return 0;
  }
}
