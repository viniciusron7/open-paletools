/**
 * Platform-independent core of Bulk buy (no Web App globals): plan validation, also used live by
 * the dialog, and the purchase runner. Used by market-automation/sessions.js; unit tests evaluate
 * this module alone.
 *
 * Invariants:
 * - `validateBulkBuyPlan(rows, coins)`: OVR integer 1-99; maxPrice safe integer 200-14,999,000
 *   and a multiple of its tier step (<=1,000: 50, <=10,000: 100, <=50,000: 250, <=100,000: 500,
 *   else 1,000); quantity positive integer; safe-integer totals; the sum of maxPrice x quantity
 *   must be STRICTLY below the balance.
 * - The runner reads `initialCoins` once and revalidates the plan; rows run in order. Before each
 *   purchase `checkFunds()` (run twice) requires the remaining reservation, sum of (quantity -
 *   bought) x maxPrice, to be strictly below min(current coins, initialCoins - spent).
 * - Only `{ success: true, price }` with an integer price in (0, row.maxPrice] counts (`spent`,
 *   `bought`); `false` or `success: false` (lost offer) is skipped without counting; anything
 *   else ends with 'error'.
 * - Deduplication: the auction key (trimmed non-empty string or positive integer, else error)
 *   enters `attemptedAuctions` BEFORE the bid, so each auction is tried once per run.
 * - Pagination: `hasMore` false ends the row ('rowUnavailable'); `nextOffset` (default offset +
 *   20) must be a non-negative safe integer (else error) and larger than the offset, and a
 *   repeated page whose auctions were all attempted ends the row (both detail 'pagination').
 *   After each purchase the row restarts at offset 0 with cleared signatures, because bought
 *   auctions shift later offers forward.
 * - `wait(signal, action)` runs before each search ('search'), purchase ('buy') and next page or
 *   restart ('return').
 * - End: 'complete' as soon as the plan total is bought, else 'unavailable' after the last row;
 *   Stop and errors after abort give 'stopped'. A purchase already awaited settles and is counted
 *   before Stop is honored. `start()` is idempotent.
 */
export function validateBulkBuyPlan(inputRows, coins) {
  if (!Number.isSafeInteger(coins) || coins < 0) {
    throw new Error("Invalid coin balance.");
  }
  if (!Array.isArray(inputRows) || inputRows.length === 0) {
    throw new Error("Add at least one row to the bulk buy.");
  }
  let totalCost = 0;
  let totalQuantity = 0;
  const rows = inputRows.map((row) => {
    if (!row || !Number.isSafeInteger(row.ovr) || row.ovr < 1 || row.ovr > 99) {
      throw new Error("OVR must be a whole number between 1 and 99.");
    }
    const { ovr, maxPrice, quantity } = row;
    const increment =
      maxPrice <= 1000
        ? 50
        : maxPrice <= 10000
          ? 100
          : maxPrice <= 50000
            ? 250
            : maxPrice <= 100000
              ? 500
              : 1000;
    if (
      !Number.isSafeInteger(maxPrice) ||
      maxPrice < 200 ||
      maxPrice > 14999000 ||
      maxPrice % increment !== 0
    ) {
      throw new Error(
        "The max price must follow the Transfer Market price increments, between 200 and 14,999,000.",
      );
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw new Error("Quantity must be a positive whole number.");
    }
    const rowCost = maxPrice * quantity;
    if (
      !Number.isSafeInteger(rowCost) ||
      !Number.isSafeInteger(totalCost + rowCost) ||
      !Number.isSafeInteger(totalQuantity + quantity)
    ) {
      throw new Error("The total amount or quantity of the purchase is too large.");
    }
    totalCost += rowCost;
    totalQuantity += quantity;
    return {
      ovr,
      maxPrice,
      quantity,
    };
  });
  if (totalCost >= coins) {
    throw new Error("The total max cost must be lower than the coin balance.");
  }
  return {
    rows,
    totalCost,
    totalQuantity,
  };
}

export function createBulkBuyRunner({
  plan,
  getCoins,
  search,
  buy,
  wait,
  onStatus = () => {},
  getAuctionKey = (item) => item?.tradeId ?? item?.getAuctionData?.()?.tradeId ?? item?.id,
}) {
  for (const action of [getCoins, search, buy, wait, onStatus, getAuctionKey]) {
    if (typeof action !== "function") {
      throw new Error("Invalid bulk buy action.");
    }
  }
  const initialCoins = getCoins();
  const validatedPlan = validateBulkBuyPlan(plan?.rows, initialCoins);
  const rows = validatedPlan.rows.map((row) => ({
    ...row,
    bought: 0,
  }));
  const purchases = [];
  const attemptedAuctions = new Set();
  const abortController = new AbortController();
  let running = false;
  let task;
  let spent = 0;
  let totalBought = 0;
  let rowIndex = 0;
  const rowPlan = (row) => ({
    ovr: row.ovr,
    maxPrice: row.maxPrice,
    quantity: row.quantity,
  });
  const emit = (phase, extra = {}) =>
    onStatus({
      phase,
      rowIndex,
      row: rows[rowIndex]
        ? {
            ...rows[rowIndex],
          }
        : null,
      rows: rows.map((row) => ({
        ...row,
      })),
      bought: totalBought,
      totalBought,
      spent,
      ...extra,
    });
  const finish = (reason, extra = {}) => {
    emit(reason, extra);
    return {
      reason,
      purchases: [...purchases],
      spent,
      totalBought,
      rows: rows.map((row) => ({
        ...row,
      })),
      ...extra,
    };
  };
  const auctionKey = (item) => {
    const rawKey = getAuctionKey(item);
    if (typeof rawKey === "string" && rawKey.trim()) {
      return rawKey.trim();
    }
    if (Number.isSafeInteger(rawKey) && rawKey > 0) {
      return String(rawKey);
    }
    throw new Error("The offer does not have a valid auction ID.");
  };
  const checkFunds = () => {
    const currentCoins = getCoins();
    if (!Number.isSafeInteger(currentCoins) || currentCoins < 0) {
      throw new Error("Invalid coin balance.");
    }
    const effectiveCoins = Math.min(currentCoins, initialCoins - spent);
    const remainingCost = rows.reduce(
      (sum, row) => sum + (row.quantity - row.bought) * row.maxPrice,
      0,
    );
    if (!Number.isSafeInteger(remainingCost) || remainingCost >= effectiveCoins) {
      throw new Error("The balance no longer covers the remaining max cost of the bulk buy.");
    }
  };
  async function pause(action, signal, extra = {}) {
    if (signal.aborted) {
      return false;
    }
    emit("waiting", {
      action,
      ...extra,
    });
    if (signal.aborted) {
      return false;
    }
    await wait(signal, action);
    return !signal.aborted;
  }
  async function run() {
    const signal = abortController.signal;
    try {
      for (rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        let offset = 0;
        let seenPageSignatures = new Set();
        while (row.bought < row.quantity) {
          if (
            !(await pause("search", signal, {
              offset,
            }))
          ) {
            return finish("stopped");
          }
          emit("searching", {
            offset,
          });
          if (signal.aborted) {
            return finish("stopped");
          }
          const page = await search(rowPlan(row), {
            offset,
            signal,
          });
          if (signal.aborted) {
            return finish("stopped");
          }
          if (!page || !Array.isArray(page.items) || typeof page.hasMore !== "boolean") {
            throw new Error("Invalid search response.");
          }
          const keyedItems = page.items.map((item) => ({
            item,
            key: auctionKey(item),
          }));
          const signature = keyedItems.length
            ? JSON.stringify([...new Set(keyedItems.map(({ key }) => key))].sort())
            : null;
          if (
            signature &&
            seenPageSignatures.has(signature) &&
            keyedItems.every(({ key }) => attemptedAuctions.has(key))
          ) {
            emit("rowUnavailable", {
              detail: "pagination",
            });
            break;
          }
          if (signature) {
            seenPageSignatures.add(signature);
          }
          let restart = false;
          for (const { item, key } of keyedItems) {
            if (attemptedAuctions.has(key)) {
              continue;
            }
            if (
              !(await pause("buy", signal, {
                item,
                auctionKey: key,
              }))
            ) {
              return finish("stopped");
            }
            checkFunds();
            emit("buying", {
              item,
              auctionKey: key,
            });
            if (signal.aborted) {
              return finish("stopped");
            }
            checkFunds();
            attemptedAuctions.add(key);
            // Once sent, a purchase must settle even if Stop is pressed.
            const purchase = await buy(item, rowPlan(row), signal);
            if (purchase === false || purchase?.success === false) {
              if (signal.aborted) {
                return finish("stopped");
              }
              continue;
            }
            if (
              !purchase ||
              purchase.success !== true ||
              !Number.isSafeInteger(purchase.price) ||
              purchase.price <= 0 ||
              purchase.price > row.maxPrice ||
              !Number.isSafeInteger(spent + purchase.price)
            ) {
              throw new Error(
                "The purchase did not return a valid confirmed price within the limit.",
              );
            }
            spent += purchase.price;
            row.bought++;
            totalBought++;
            purchases.push({
              item,
              auctionKey: key,
              rowIndex,
              ovr: row.ovr,
              price: purchase.price,
            });
            emit("bought", {
              item,
              auctionKey: key,
              price: purchase.price,
            });
            if (totalBought === validatedPlan.totalQuantity) {
              return finish("complete");
            }
            if (signal.aborted) {
              return finish("stopped");
            }
            if (row.bought === row.quantity) {
              break;
            }
            // Removing a bought auction shifts later offers into earlier pages.
            offset = 0;
            seenPageSignatures = new Set();
            restart = true;
            break;
          }
          if (row.bought === row.quantity) {
            break;
          }
          if (!restart) {
            if (!page.hasMore) {
              emit("rowUnavailable");
              break;
            }
            const nextOffset = page.nextOffset ?? offset + 20;
            if (!Number.isSafeInteger(nextOffset) || nextOffset < 0) {
              throw new Error("The search returned an invalid page position.");
            }
            if (nextOffset <= offset) {
              emit("rowUnavailable", {
                detail: "pagination",
              });
              break;
            }
            offset = nextOffset;
          }
          if (
            !(await pause("return", signal, {
              offset,
            }))
          ) {
            return finish("stopped");
          }
        }
      }
      return finish(totalBought === validatedPlan.totalQuantity ? "complete" : "unavailable");
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
