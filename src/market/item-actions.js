/**
 * Shared `UTItemActionController` instance (`sharedItemActionController`) through which the
 * player-snipe market flow and the legacy snipe plugin place their bids, and
 * `buyFirstActiveItem(items)`, the Buy Now purchase used by the legacy snipe, Auto Snipe and the
 * album/gallery Buy button.
 *
 * Invariants:
 * - Created at module evaluation, so `UTItemActionController` must exist when the script runs.
 * - The player-snipe and bulk-buy tests inject a fake named `sharedItemActionController`.
 * - `buyFirstActiveItem` returns `false` (not a promise) when no item has an ACTIVE trade
 *   state; otherwise it bids the item's own `buyNowPrice` and resolves `{ success, item, status,
 *   error }`, where success needs `response.success`, no `error` and a status below 400. After
 *   30 s without a response it stops observing and resolves `{ success: false, status: 408 }`.
 */
export const sharedItemActionController = new UTItemActionController();

export function buyFirstActiveItem(items) {
  if (!items || items.length === 0) {
    return false;
  }
  const activeItem = items.find(
    (item) => item.getAuctionData()._tradeState === AuctionTradeStateEnum.ACTIVE,
  );
  return (
    !!activeItem &&
    new Promise((resolve, reject) => {
      const observer = {};
      let bidObservable;
      const timeout = setTimeout(() => {
        bidObservable?.unobserve(observer);
        resolve({
          success: false,
          item: activeItem,
          status: 408,
        });
      }, 30000);
      try {
        bidObservable = sharedItemActionController.bid(
          activeItem,
          activeItem.getAuctionData().buyNowPrice,
        );
        bidObservable.observe(observer, (sender, response) => {
          clearTimeout(timeout);
          sender.unobserve(observer);
          resolve({
            success:
              Boolean(response?.success) && !response.error && !(Number(response.status) >= 400),
            item: activeItem,
            status: response?.status,
            error: response?.error,
          });
        });
      } catch (error) {
        clearTimeout(timeout);
        bidObservable?.unobserve(observer);
        reject(error);
      }
    })
  );
}
