/**
 * `AutoSnipeRunner`: the Auto Snipe loop (added in 27.2.1). It repeats a search, buys the
 * matching offers one by one and reports progress, until a limit is reached or it is stopped.
 * The search, buy and activity check are injected (src/plugins/auto-snipe/controller.js passes
 * `searchAutoSnipeMarket`, `buyFirstActiveItem` and the enabled/visible check).
 *
 * Invariants:
 * - `start(options)` validates every input first and throws "Invalid autoSnipe inputs" without
 *   running: maxPrice 200..14 999 000, maxSnipes and maxCards >= 1, delayMs and buyDelayMs
 *   1000..2 147 483 447 (all safe integers), a positive integer `playerId` or, without one,
 *   `filters`, and 0 <= filters.minBid <= the bid ceiling (`min(maxPrice, filters.maxBid)` when
 *   maxBid is positive).
 * - Each search and each buy counts as one attempt against maxSnipes; bought cards count against
 *   maxCards. Searches after the first wait `delayMs` and buys after the first of a search wait
 *   `buyDelayMs`, both randomised by ±200 ms (`waitForDelay`); `stop()` cancels a pending wait.
 * - After every search the next search's `minBid` steps up by one market increment (at least
 *   150) up to the bid ceiling, then returns to the initial minBid, so consecutive searches
 *   differ (the transfer market caches identical searches).
 * - Only offers with 0 < price <= maxPrice, still active and of `playerId` (when given) are
 *   bought, cheapest first. `onPurchase({ item, price })` runs for each successful buy (a result
 *   with `success`) and `onProgress({ attempts, bought })` after each buy and each search.
 * - The loop stops as soon as `stopped` is set or `isActive()` is false; `start` resolves
 *   `{ attempts, bought, stopped }` (stopped = not active any more) and a second `start` while
 *   `running` returns at once. `running` is cleared in `finally`, also when the search or the buy
 *   throws (the error is re-thrown to the caller).
 */
import { waitForDelay } from "../../core/async.js";

export class AutoSnipeRunner {
  constructor({ search, buy, isActive, onProgress, onPurchase = () => {}, wait = waitForDelay }) {
    Object.assign(this, {
      search: search,
      buy: buy,
      isActive: isActive,
      onProgress: onProgress,
      onPurchase: onPurchase,
    });
    this.wait = async (delayMs) => {
      const abortController = new AbortController();
      this.cancelWait = () => abortController.abort();
      try {
        await wait(delayMs - 200, delayMs + 200, abortController.signal);
      } finally {
        this.cancelWait = null;
      }
    };
    this.running = false;
    this.stopped = false;
  }
  ["stop"]() {
    this.stopped = true;
    this.cancelWait?.();
  }
  async ["start"]({ playerId, maxPrice, maxSnipes, delayMs, maxCards, buyDelayMs, filters }) {
    if (this.running) {
      return;
    }
    const initialMinBid = Number(filters?.minBid) || 0;
    const maxBid = filters?.maxBid > 0 ? Math.min(maxPrice, Number(filters.maxBid)) : maxPrice;
    if (
      ![maxPrice, maxSnipes, delayMs, maxCards, buyDelayMs].every(Number.isSafeInteger) ||
      !Number.isSafeInteger(initialMinBid) ||
      initialMinBid < 0 ||
      initialMinBid > maxBid ||
      (playerId !== undefined ? !Number.isSafeInteger(playerId) || playerId <= 0 : !filters) ||
      maxPrice < 200 ||
      maxPrice > 14999000 ||
      maxSnipes < 1 ||
      maxCards < 1 ||
      delayMs < 1000 ||
      delayMs > 2147483447 ||
      buyDelayMs < 1000 ||
      buyDelayMs > 2147483447
    ) {
      throw new Error("Invalid autoSnipe inputs");
    }
    this.running = true;
    this.stopped = false;
    let attempts = 0;
    let bought = 0;
    let searchFilters = { ...filters };
    const isRunning = () => !this.stopped && this.isActive();
    try {
      // The test waits `delayMs` before every search but the first, then checks again.
      for (
        ;
        attempts < maxSnipes &&
        bought < maxCards &&
        isRunning() &&
        (attempts > 0 && (await this.wait(delayMs)), isRunning());
      ) {
        attempts++;
        const offers = await this.search(playerId, maxPrice, searchFilters);
        if (!isRunning()) {
          break;
        }
        const previousMinBid = Number(searchFilters.minBid) || 0;
        searchFilters = {
          ...filters,
          minBid:
            previousMinBid >= maxBid
              ? initialMinBid
              : Math.min(
                  maxBid,
                  Math.max(150, UTCurrencyInputControl.getIncrementAboveVal(previousMinBid)),
                ),
        };
        const matchingOffers = offers.filter(
          (offer) =>
            offer.price > 0 &&
            offer.price <= maxPrice &&
            (playerId === undefined || offer.playerId === playerId) &&
            offer.active,
        );
        let buysThisSearch = 0;
        for (const offer of matchingOffers) {
          if (attempts >= maxSnipes || bought >= maxCards || !isRunning()) {
            break;
          }
          if (buysThisSearch > 0) {
            await this.wait(buyDelayMs);
          }
          if (!isRunning()) {
            break;
          }
          attempts++;
          const purchase = { item: offer.item, price: offer.price };
          buysThisSearch++;
          const buyResult = await this.buy(offer);
          if (buyResult?.success) {
            bought++;
            this.onPurchase(purchase);
            this.onProgress({ attempts: attempts, bought: bought });
          } else {
            this.onProgress({ attempts: attempts, bought: bought });
          }
        }
        this.onProgress({ attempts: attempts, bought: bought });
      }
      return { attempts: attempts, bought: bought, stopped: !isRunning() };
    } finally {
      this.running = false;
    }
  }
}
