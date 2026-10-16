/**
 * Platform-independent core of Player snipe (no Web App globals): pause generator, minimum-price
 * progression and the search/buy/return/adjust loop. Used by market-automation/sessions.js (bulk
 * buy reuses `createPlayerSnipeTiming`); unit tests evaluate this module alone.
 *
 * Invariants:
 * - `createPlayerSnipeTiming(random)`: integer ms from the inclusive ranges search 80-180, return
 *   70-160, adjust 30-90, buy 15-55; a delay never equals the previous delay (any action) nor the
 *   previous delay of the same action; `random()` must return [0, 1); unknown actions throw.
 * - `getNextPlayerSnipePrices`: advance minBuy one tick (`nextPrice` must return a larger safe
 *   integer); if it reaches maxBuy / 2, advance minBid one tick and set minBuy = minBid; return
 *   null when minBid cannot stay below maxBuy / 2. Inputs with minBuy >= maxBuy / 2 or minBuy <
 *   minBid throw, so every search keeps minBuy < maxBuy / 2 (strict).
 * - Loop: prices start at 0/0; search, then buy only `items[0]` (server order, no sorting) and
 *   finish 'bought' on success; a false result (offer no longer active) goes on; return to
 *   filters, adjust prices, wait. An exhausted sweep (null) restarts at 0/0 instead of ending the
 *   session.
 * - `beforeAction(action, signal)` runs before search, buy, return and adjust; `onStatus`
 *   receives phase, a copy of the prices and the search count.
 * - Stop: `stop()` aborts once and emits 'stopping' while running; `signal.aborted` is checked
 *   after every await; an error after abort finishes 'stopped', not 'error'. A `buy` already
 *   awaited is not interrupted: a successful purchase returns 'bought' even after Stop. `start()`
 *   is idempotent and runs the loop on a microtask.
 */
export function createPlayerSnipeTiming(random = Math.random) {
  if (typeof random !== "function") {
    throw new Error("Invalid interval generator.");
  }
  const ranges = {
    search: [80, 180],
    return: [70, 160],
    adjust: [30, 90],
    buy: [15, 55],
  };
  const previousByAction = new Map();
  let previous;
  return (action) => {
    if (!Object.prototype.hasOwnProperty.call(ranges, action)) {
      throw new Error("Unknown sniping action.");
    }
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new Error("Invalid random value.");
    }
    const [minimum, maximum] = ranges[action];
    const available = [];
    for (let delay = minimum; delay <= maximum; delay++) {
      if (delay !== previous && delay !== previousByAction.get(action)) {
        available.push(delay);
      }
    }
    const delay = available[Math.floor(sample * available.length)];
    previous = delay;
    previousByAction.set(action, delay);
    return delay;
  };
}

function getNextPlayerSnipePrices(prices, maxBuy, nextPrice) {
  if (
    !Number.isSafeInteger(maxBuy) ||
    maxBuy <= 0 ||
    !Number.isSafeInteger(prices.minBid) ||
    !Number.isSafeInteger(prices.minBuy) ||
    prices.minBid < 0 ||
    prices.minBuy < prices.minBid ||
    prices.minBuy >= maxBuy / 2 ||
    typeof nextPrice !== "function"
  ) {
    throw new Error("Invalid price range for sniping.");
  }
  const advance = (price) => {
    const next = nextPrice(price);
    if (!Number.isSafeInteger(next) || next <= price) {
      throw new Error("The Transfer Market did not provide a valid next price.");
    }
    return next;
  };
  const minBuy = advance(prices.minBuy);
  if (minBuy < maxBuy / 2) {
    return {
      minBid: prices.minBid,
      minBuy,
    };
  }
  const minBid = advance(prices.minBid);
  return minBid < maxBuy / 2
    ? {
        minBid,
        minBuy: minBid,
      }
    : null;
}

export function createPlayerSnipeRunner({
  maxBuy,
  nextPrice,
  search,
  buy,
  returnToFilters,
  wait,
  beforeAction = async () => {},
  onStatus = () => {},
}) {
  if (!Number.isSafeInteger(maxBuy) || maxBuy <= 0) {
    throw new Error("Invalid Buy Now Price Max.");
  }
  for (const action of [nextPrice, search, buy, returnToFilters, wait, beforeAction, onStatus]) {
    if (typeof action !== "function") {
      throw new Error("Invalid sniping action.");
    }
  }
  const abortController = new AbortController();
  let running = false;
  let task;
  let prices = {
    minBid: 0,
    minBuy: 0,
  };
  let attempts = 0;
  const emit = (phase, extra = {}) =>
    onStatus({
      phase,
      prices: {
        ...prices,
      },
      attempts,
      ...extra,
    });
  const finish = (reason, extra = {}) => {
    emit(reason, extra);
    return {
      reason,
      ...extra,
    };
  };
  async function run() {
    running = true;
    const signal = abortController.signal;
    try {
      while (!signal.aborted) {
        attempts++;
        emit("searching");
        if (signal.aborted) {
          break;
        }
        await beforeAction("search", signal);
        if (signal.aborted) {
          break;
        }
        const items = await search(
          {
            ...prices,
          },
          signal,
        );
        if (signal.aborted) {
          break;
        }
        if (!Array.isArray(items)) {
          throw new Error("Invalid search response.");
        }
        if (items.length) {
          const item = items[0];
          emit("buying", {
            item,
          });
          if (signal.aborted) {
            break;
          }
          await beforeAction("buy", signal);
          if (signal.aborted) {
            break;
          }
          // A purchase already sent must settle even if Stop is pressed.
          const purchased = await buy(item, signal);
          if (purchased) {
            return finish("bought", {
              item,
            });
          }
          if (signal.aborted) {
            break;
          }
        }
        emit("returning");
        if (signal.aborted) {
          break;
        }
        await beforeAction("return", signal);
        if (signal.aborted) {
          break;
        }
        await returnToFilters(signal);
        if (signal.aborted) {
          break;
        }
        emit("adjusting");
        if (signal.aborted) {
          break;
        }
        await beforeAction("adjust", signal);
        if (signal.aborted) {
          break;
        }
        const next = getNextPlayerSnipePrices(prices, maxBuy, nextPrice);
        // Keep searching after a full sweep while preserving minBuy < maxBuy / 2.
        prices = next || {
          minBid: 0,
          minBuy: 0,
        };
        emit("waiting");
        if (signal.aborted) {
          break;
        }
        await wait(signal);
      }
      return finish("stopped");
    } catch (error) {
      return signal.aborted
        ? finish("stopped")
        : finish("error", {
            error,
          });
    } finally {
      running = false;
    }
  }
  return {
    start() {
      if (!task) {
        running = true;
        task = Promise.resolve().then(run);
      }
      return task;
    },
    stop() {
      if (!abortController.signal.aborted) {
        abortController.abort();
        if (running) {
          emit("stopping");
        }
      }
    },
    get running() {
      return running;
    },
  };
}
