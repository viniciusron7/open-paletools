/**
 * `listItemOnTransferMarket(item, buyNowPrice, startingBid, skipIfOutsidePriceLimits)` lists an
 * item for one hour, fitting the price into EA's price limits. Used by the sell-multiple plugin.
 *
 * Invariants:
 * - Price limits are requested (`services.Item.requestMarketData`) only when
 *   `item.hasPriceLimits()` is false.
 * - With limits and a truthy `skipIfOutsidePriceLimits`, a price outside `_itemPriceLimits`
 *   returns undefined without listing and an inside price is neither clamped nor raised; with it
 *   falsy the price is clamped into the limits and rounded, and a result equal to the minimum is
 *   raised one step (+50 below 1,000, +100 below 10,000, +250 below 50,000, +500 below 100,000,
 *   else +1,000), leaving room for a start bid one step lower.
 * - Buy now is finally `roundToValidPrice(price, 200)`; the start bid defaults to
 *   `decreasePriceByOneStep(buyNow)`; the duration is 3600 s. The call goes through the patched
 *   `services.Item.list` (buy transaction recorded, ITEM_MOVED dispatched).
 * - Returns the buy-now price used; a falsy `buyNowPrice` lists nothing.
 */
import { decreasePriceByOneStep, roundToValidPrice } from "./prices.js";

export async function listItemOnTransferMarket(
  item,
  buyNowPrice,
  startingBid,
  skipIfOutsidePriceLimits,
) {
  await (async function (targetItem) {
    return new Promise((resolve) => {
      if (targetItem.hasPriceLimits()) {
        resolve();
      } else {
        services.Item.requestMarketData(targetItem).observe(this, async function () {
          resolve();
        });
      }
    });
  })(item);
  if (buyNowPrice) {
    if (item.hasPriceLimits()) {
      if (skipIfOutsidePriceLimits) {
        if (
          buyNowPrice < item._itemPriceLimits.minimum ||
          buyNowPrice > item._itemPriceLimits.maximum
        ) {
          return;
        }
      } else {
        buyNowPrice = (function (price, targetItem) {
          var minimumPrice;
          if (
            (price = roundToValidPrice(
              Math.min(
                targetItem._itemPriceLimits.maximum,
                Math.max(targetItem._itemPriceLimits.minimum, price),
              ),
            )) === targetItem._itemPriceLimits.minimum
          ) {
            price =
              (minimumPrice = price) < 1000
                ? minimumPrice + 50
                : minimumPrice >= 1000 && minimumPrice < 10000
                  ? minimumPrice + 100
                  : minimumPrice >= 10000 && minimumPrice < 50000
                    ? minimumPrice + 250
                    : minimumPrice >= 50000 && minimumPrice < 100000
                      ? minimumPrice + 500
                      : minimumPrice + 1000;
          }
          return price;
        })(buyNowPrice, item);
      }
    }
    buyNowPrice = roundToValidPrice(buyNowPrice, 200);
    services.Item.list(item, startingBid || decreasePriceByOneStep(buyNowPrice), buyNowPrice, 3600);
  }
  return buyNowPrice;
}
