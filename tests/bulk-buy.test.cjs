const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { loadSources } = require("./support/load-sources.cjs");
const { BULK_BUY_CORE } = require("./support/market-automation-sources.cjs");

const context = vm.createContext({ AbortController, DOMException, setTimeout, clearTimeout });
const exportCore = "\nglobalThis.bulkBuyCore = { validateBulkBuyPlan, createBulkBuyRunner };";
loadSources(context, { modules: [BULK_BUY_CORE], epilogue: exportCore });
const { validateBulkBuyPlan, createBulkBuyRunner } = context.bulkBuyCore;
const plain = (value) => JSON.parse(JSON.stringify(value));
const row = (overrides = {}) => ({ ovr: 85, maxPrice: 1000, quantity: 1, ...overrides });
const plan = (rows = [row()], coins = 10000) => validateBulkBuyPlan(rows, coins);
const options = (overrides = {}) => ({
  plan: plan(),
  getCoins: () => 10000,
  search: async () => ({ items: [], hasMore: false }),
  buy: async () => ({ success: true, price: 900 }),
  wait: async () => {},
  ...overrides,
});
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("validates a cloned multi-row plan with a strictly smaller worst-case cost than the balance", () => {
  const rows = [row({ quantity: 2 }), row({ ovr: 86, maxPrice: 2000, quantity: 3 })];
  const validated = validateBulkBuyPlan(rows, 8001);
  assert.deepEqual(plain(validated), { rows, totalCost: 8000, totalQuantity: 5 });
  rows[0].quantity = 99;
  assert.equal(validated.rows[0].quantity, 2);
  assert.throws(() => validateBulkBuyPlan([row()], 1000));
  assert.throws(() => validateBulkBuyPlan([row()], 999));
  assert.equal(validateBulkBuyPlan([row()], 1001).totalCost, 1000);
});

test("accepts the valid endpoints and increments of each market price tier", () => {
  for (const maxPrice of [
    200, 950, 1000, 1100, 9900, 10000, 10250, 49750, 50000, 50500, 99500, 100000, 101000, 14999000,
  ]) {
    assert.equal(validateBulkBuyPlan([row({ maxPrice })], 20000000).rows[0].maxPrice, maxPrice);
  }
  for (const maxPrice of [
    150,
    199,
    201,
    1050,
    10100,
    50050,
    100500,
    15000000,
    NaN,
    Infinity,
    "1000",
  ]) {
    assert.throws(() => validateBulkBuyPlan([row({ maxPrice })], 20000000));
  }
});

test("rejects invalid OVR, quantities, empty plans and invalid balances", () => {
  for (const ovr of [0, 100, 85.5, NaN, "85", undefined]) {
    assert.throws(() => validateBulkBuyPlan([row({ ovr })], 10000));
  }
  for (const quantity of [0, -1, 1.5, Infinity, "1", undefined]) {
    assert.throws(() => validateBulkBuyPlan([row({ quantity })], 10000));
  }
  for (const rows of [[], null, {}, [null]]) assert.throws(() => validateBulkBuyPlan(rows, 10000));
  for (const coins of [-1, Infinity, NaN, 10000.5, "10000"])
    assert.throws(() => validateBulkBuyPlan([row()], coins));
  assert.equal(validateBulkBuyPlan([row({ ovr: 1 }), row({ ovr: 99 })], 10000).rows.length, 2);
});

test("rejects unsafe multiplication and unsafe totals", () => {
  assert.throws(() =>
    validateBulkBuyPlan([row({ quantity: Number.MAX_SAFE_INTEGER })], Number.MAX_SAFE_INTEGER),
  );
  const quantity = Math.floor(Number.MAX_SAFE_INTEGER / 200);
  assert.throws(() =>
    validateBulkBuyPlan(
      [row({ maxPrice: 200, quantity }), row({ maxPrice: 200, quantity })],
      Number.MAX_SAFE_INTEGER,
    ),
  );
});

test(
  "processes rows sequentially, resets pagination after purchases and counts actual confirmed prices",
  { timeout: 2000 },
  async () => {
    const rows = [row({ quantity: 2 }), row({ ovr: 86, maxPrice: 2000 })];
    const searches = [];
    const purchases = [];
    const runner = createBulkBuyRunner(
      options({
        plan: plan(rows, 5001),
        getCoins: () => 5001,
        search: async (current, { offset, signal }) => {
          assert.equal(signal.aborted, false);
          searches.push([current.ovr, offset]);
          return {
            items: current.ovr === 85 ? [{ tradeId: "a" }, { tradeId: "b" }] : [{ tradeId: "c" }],
            hasMore: false,
          };
        },
        buy: async (item, current) => {
          purchases.push([item.tradeId, current.ovr]);
          return { success: true, price: { a: 900, b: 800, c: 1500 }[item.tradeId] };
        },
      }),
    );
    const result = await runner.start();
    assert.equal(result.reason, "complete");
    assert.equal(result.totalBought, 3);
    assert.equal(result.spent, 3200);
    assert.deepEqual(purchases, [
      ["a", 85],
      ["b", 85],
      ["c", 86],
    ]);
    assert.deepEqual(searches, [
      [85, 0],
      [85, 0],
      [86, 0],
    ]);
    assert.deepEqual(
      plain(result.rows).map((current) => current.bought),
      [2, 1],
    );
    assert.equal(runner.running, false);
  },
);

test(
  "paginates through three empty filtered pages before finding an eligible auction",
  { timeout: 2000 },
  async () => {
    const offsets = [];
    const runner = createBulkBuyRunner(
      options({
        search: async (_row, { offset }) => {
          offsets.push(offset);
          assert(offset <= 60);
          return offset === 60
            ? { items: [{ tradeId: "found" }], hasMore: false }
            : { items: [], hasMore: true };
        },
      }),
    );
    assert.equal((await runner.start()).reason, "complete");
    assert.deepEqual(offsets, [0, 20, 40, 60]);
  },
);

test(
  "honors explicit next offsets instead of filtered result counts",
  { timeout: 2000 },
  async () => {
    const offsets = [];
    const runner = createBulkBuyRunner(
      options({
        search: async (_row, { offset }) => {
          offsets.push(offset);
          return offset === 0
            ? { items: [], hasMore: true, nextOffset: 50 }
            : { items: [{ id: "found" }], hasMore: false };
        },
      }),
    );
    assert.equal((await runner.start()).reason, "complete");
    assert.deepEqual(offsets, [0, 50]);
  },
);

test(
  "failed auction races are attempted once globally and do not count toward the requested quantity",
  { timeout: 2000 },
  async () => {
    const attempted = [];
    const offsets = [];
    const runner = createBulkBuyRunner(
      options({
        search: async (_row, { offset }) => {
          offsets.push(offset);
          return offset === 0
            ? { items: [{ tradeId: "race" }, { tradeId: "race" }], hasMore: true }
            : { items: [{ tradeId: "race" }, { tradeId: "available" }], hasMore: false };
        },
        buy: async (item) => {
          attempted.push(item.tradeId);
          return item.tradeId === "race" ? { success: false } : { success: true, price: 800 };
        },
      }),
    );
    const result = await runner.start();
    assert.equal(result.reason, "complete");
    assert.equal(result.totalBought, 1);
    assert.equal(result.spent, 800);
    assert.deepEqual(attempted, ["race", "available"]);
    assert.deepEqual(offsets, [0, 20]);
  },
);

test(
  "uses auction trade identifiers rather than the shared player definition identifier",
  { timeout: 2000 },
  async () => {
    const items = ["auction-a", "auction-b"].map((tradeId) => ({
      id: 85,
      getAuctionData: () => ({ tradeId }),
    }));
    const runner = createBulkBuyRunner(
      options({
        plan: plan([row({ quantity: 2 })]),
        search: async () => ({ items, hasMore: false }),
      }),
    );
    const result = await runner.start();
    assert.equal(result.reason, "complete");
    assert.equal(result.totalBought, 2);
    assert.deepEqual(
      plain(result.purchases).map((purchase) => purchase.auctionKey),
      ["auction-a", "auction-b"],
    );
  },
);

test(
  "returns unavailable with partial confirmed purchases when the remaining supply is exhausted",
  { timeout: 2000 },
  async () => {
    let searches = 0;
    const runner = createBulkBuyRunner(
      options({
        plan: plan([row({ quantity: 2 })]),
        search: async () => ({
          items: ++searches === 1 ? [{ tradeId: "only-one" }] : [],
          hasMore: false,
        }),
      }),
    );
    const result = await runner.start();
    assert.equal(result.reason, "unavailable");
    assert.equal(result.totalBought, 1);
    assert.equal(result.spent, 900);
    assert.equal(result.rows[0].bought, 1);
    assert.equal(searches, 2);
  },
);

test(
  "an unavailable row does not prevent buying the following OVR",
  { timeout: 2000 },
  async () => {
    const statuses = [];
    const searchedOvrs = [];
    const runner = createBulkBuyRunner(
      options({
        plan: plan([row(), row({ ovr: 86 })]),
        search: async (current) => {
          searchedOvrs.push(current.ovr);
          return { items: current.ovr === 86 ? [{ id: "available-86" }] : [], hasMore: false };
        },
        onStatus: (status) => statuses.push(status),
      }),
    );
    const result = await runner.start();
    assert.equal(result.reason, "unavailable");
    assert.equal(result.totalBought, 1);
    assert.equal(result.spent, 900);
    assert.deepEqual(searchedOvrs, [85, 86]);
    assert.deepEqual(
      plain(result.rows).map((current) => current.bought),
      [0, 1],
    );
    assert(statuses.some((status) => status.phase === "rowUnavailable" && status.rowIndex === 0));
  },
);

test(
  "status snapshots include every row without exposing mutable runner counts",
  { timeout: 2000 },
  async () => {
    const statuses = [];
    const runner = createBulkBuyRunner(
      options({
        search: async () => ({ items: [{ id: "available" }], hasMore: false }),
        onStatus: (status) => {
          statuses.push({ phase: status.phase, bought: status.rows[0].bought });
          status.rows[0].bought = 99;
          status.rows[0].quantity = 999;
        },
      }),
    );
    const result = await runner.start();
    assert.equal(result.reason, "complete");
    assert.equal(result.rows[0].bought, 1);
    assert.equal(result.rows[0].quantity, 1);
    assert(statuses.some((status) => status.phase === "bought" && status.bought === 1));
  },
);

test(
  "stops pagination without retrying offsets that do not advance",
  { timeout: 2000 },
  async () => {
    let searches = 0;
    const runner = createBulkBuyRunner(
      options({
        search: async () => {
          searches++;
          return { items: [], hasMore: true, nextOffset: 0 };
        },
      }),
    );
    assert.equal((await runner.start()).reason, "unavailable");
    assert.equal(searches, 1);
  },
);

test(
  "detects a repeated auction page rather than retrying it indefinitely",
  { timeout: 2000 },
  async () => {
    let searches = 0;
    let purchases = 0;
    const runner = createBulkBuyRunner(
      options({
        search: async () => {
          searches++;
          return { items: [{ tradeId: "same" }], hasMore: true };
        },
        buy: async () => {
          purchases++;
          return { success: false };
        },
      }),
    );
    assert.equal((await runner.start()).reason, "unavailable");
    assert.equal(searches, 2);
    assert.equal(purchases, 1);
  },
);

test(
  "checks that the current balance strictly covers all remaining maximum prices before buying",
  { timeout: 2000 },
  async () => {
    let reads = 0;
    let purchases = 0;
    const runner = createBulkBuyRunner(
      options({
        getCoins: () => (++reads === 1 ? 1001 : 1000),
        search: async () => ({ items: [{ id: "candidate" }], hasMore: false }),
        buy: async () => {
          purchases++;
          return { success: true, price: 900 };
        },
      }),
    );
    const result = await runner.start();
    assert.equal(result.reason, "error");
    assert.equal(result.totalBought, 0);
    assert.equal(purchases, 0);
  },
);

test(
  "rechecks all remaining reservations after a buying observer changes the balance",
  { timeout: 2000 },
  async () => {
    let coins = 3001;
    let purchases = 0;
    const runner = createBulkBuyRunner(
      options({
        plan: plan([row({ quantity: 2 })], coins),
        getCoins: () => coins,
        search: async () => ({ items: [{ id: "a" }, { id: "b" }], hasMore: false }),
        onStatus: ({ phase }) => {
          if (phase === "buying") coins = 1500;
        },
        buy: async () => {
          assert(
            900 < coins,
            "the immediate card remains affordable, but the entire reservation does not",
          );
          purchases++;
          return { success: true, price: 900 };
        },
      }),
    );
    const result = await runner.start();
    assert.equal(result.reason, "error");
    assert.equal(result.totalBought, 0);
    assert.equal(result.spent, 0);
    assert.equal(purchases, 0);
  },
);

test(
  "subtracts confirmed spending from the initial balance even when the native balance is stale",
  { timeout: 2000 },
  async () => {
    const runner = createBulkBuyRunner(
      options({
        plan: plan([row({ quantity: 2 })], 2001),
        getCoins: () => 2001,
        search: async () => ({ items: [{ id: "a" }, { id: "b" }], hasMore: false }),
        buy: async () => ({ success: true, price: 1000 }),
      }),
    );
    const result = await runner.start();
    assert.equal(result.reason, "complete");
    assert.equal(result.spent, 2000);
    assert.equal(result.totalBought, 2);
  },
);

test(
  "stops with partial progress if another action reduces the available coins",
  { timeout: 2000 },
  async () => {
    let purchases = 0;
    const runner = createBulkBuyRunner(
      options({
        plan: plan([row({ quantity: 2 })], 3001),
        getCoins: () => (purchases ? 1000 : 3001),
        search: async () => ({ items: [{ id: "a" }, { id: "b" }], hasMore: false }),
        buy: async () => {
          purchases++;
          return { success: true, price: 1000 };
        },
      }),
    );
    const result = await runner.start();
    assert.equal(result.reason, "error");
    assert.equal(result.totalBought, 1);
    assert.equal(result.spent, 1000);
    assert.equal(purchases, 1);
  },
);

test("waits before searches and buys and between pages", { timeout: 2000 }, async () => {
  const events = [];
  let searches = 0;
  const runner = createBulkBuyRunner(
    options({
      wait: async (signal, action) => {
        assert.equal(signal.aborted, false);
        events.push(`wait:${action}`);
      },
      search: async () => {
        events.push("search");
        return ++searches === 1
          ? { items: [], hasMore: true }
          : { items: [{ id: "a" }], hasMore: false };
      },
      buy: async () => {
        events.push("buy");
        return { success: true, price: 900 };
      },
    }),
  );
  assert.equal((await runner.start()).reason, "complete");
  assert.deepEqual(events, [
    "wait:search",
    "search",
    "wait:return",
    "wait:search",
    "search",
    "wait:buy",
    "buy",
  ]);
});

for (const actionToStop of ["search", "return", "buy"]) {
  test(
    `stopping during the ${actionToStop} delay prevents the pending action`,
    { timeout: 2000 },
    async () => {
      let searches = 0;
      let purchases = 0;
      let runner;
      runner = createBulkBuyRunner(
        options({
          wait: async (_signal, action) => {
            if (action === actionToStop) runner.stop();
          },
          search: async () => {
            searches++;
            return actionToStop === "buy"
              ? { items: [{ id: "a" }], hasMore: false }
              : { items: [], hasMore: true };
          },
          buy: async () => {
            purchases++;
            return { success: true, price: 900 };
          },
        }),
      );
      assert.equal((await runner.start()).reason, "stopped");
      assert.equal(purchases, 0);
      assert.equal(searches, actionToStop === "search" ? 0 : 1);
    },
  );
}

test(
  "stopping a pending search aborts the signal and prevents buying its late results",
  { timeout: 2000 },
  async () => {
    const pending = deferred();
    const entered = deferred();
    let signal;
    let purchases = 0;
    const runner = createBulkBuyRunner(
      options({
        search: async (_row, request) => {
          signal = request.signal;
          entered.resolve();
          return pending.promise;
        },
        buy: async () => {
          purchases++;
          return { success: true, price: 900 };
        },
      }),
    );
    const resultPromise = runner.start();
    await entered.promise;
    runner.stop();
    assert.equal(signal.aborted, true);
    pending.resolve({ items: [{ id: "late" }], hasMore: false });
    assert.equal((await resultPromise).reason, "stopped");
    assert.equal(purchases, 0);
  },
);

for (const quantity of [1, 2]) {
  test(
    `a confirmed in-flight purchase is counted after Stop (requested quantity ${quantity})`,
    { timeout: 2000 },
    async () => {
      const pending = deferred();
      const entered = deferred();
      const runner = createBulkBuyRunner(
        options({
          plan: plan([row({ quantity })]),
          search: async () => ({ items: [{ id: "in-flight" }], hasMore: false }),
          buy: async () => {
            entered.resolve();
            return pending.promise;
          },
        }),
      );
      const resultPromise = runner.start();
      await entered.promise;
      runner.stop();
      pending.resolve({ success: true, price: 800 });
      const result = await resultPromise;
      assert.equal(result.reason, quantity === 1 ? "complete" : "stopped");
      assert.equal(result.totalBought, 1);
      assert.equal(result.spent, 800);
      assert.equal(runner.running, false);
    },
  );
}

test(
  "concurrent and synchronous reentrant starts cannot launch duplicate searches",
  { timeout: 2000 },
  async () => {
    const pending = deferred();
    const entered = deferred();
    let searches = 0;
    let reentered = false;
    let secondRun;
    let runner;
    runner = createBulkBuyRunner(
      options({
        search: async () => {
          searches++;
          entered.resolve();
          return pending.promise;
        },
        onStatus: ({ phase }) => {
          if (phase === "searching" && !reentered) {
            reentered = true;
            secondRun = runner.start();
          }
        },
      }),
    );
    const firstRun = runner.start();
    const thirdRun = runner.start();
    await entered.promise;
    pending.resolve({ items: [{ id: "found" }], hasMore: false });
    const results = await Promise.all([firstRun, secondRun, thirdRun]);
    assert(results.every((result) => result.reason === "complete"));
    assert.equal(searches, 1);
  },
);

test(
  "a stop from the buying status observer prevents sending the purchase",
  { timeout: 2000 },
  async () => {
    let purchases = 0;
    let runner;
    runner = createBulkBuyRunner(
      options({
        search: async () => ({ items: [{ id: "candidate" }], hasMore: false }),
        buy: async () => {
          purchases++;
          return { success: true, price: 900 };
        },
        onStatus: ({ phase }) => {
          if (phase === "buying") runner.stop();
        },
      }),
    );
    assert.equal((await runner.start()).reason, "stopped");
    assert.equal(purchases, 0);
  },
);

test(
  "invalid final purchase prices cause a fatal result rather than counting a success",
  { timeout: 2000 },
  async () => {
    for (const price of [undefined, 0, -1, 1.5, 1001, Infinity, "900"]) {
      const runner = createBulkBuyRunner(
        options({
          search: async () => ({ items: [{ id: "candidate" }], hasMore: false }),
          buy: async () => ({ success: true, price }),
        }),
      );
      const result = await runner.start();
      assert.equal(result.reason, "error");
      assert.equal(result.totalBought, 0);
      assert.equal(result.spent, 0);
    }
  },
);

for (const stage of ["search", "buy", "wait"]) {
  test(`a ${stage} exception ends the run without retrying`, { timeout: 2000 }, async () => {
    const error = new Error(`failure in ${stage}`);
    let searches = 0;
    let purchases = 0;
    const settings = options({
      search: async () => {
        searches++;
        return { items: [{ id: "candidate" }], hasMore: false };
      },
      buy: async () => {
        purchases++;
        return { success: true, price: 900 };
      },
    });
    settings[stage] = async () => {
      if (stage === "search") searches++;
      if (stage === "buy") purchases++;
      throw error;
    };
    const runner = createBulkBuyRunner(settings);
    const result = await runner.start();
    assert.equal(result.reason, "error");
    assert.equal(result.error, error);
    assert.equal(searches, stage === "wait" ? 0 : 1);
    assert.equal(purchases, stage === "buy" ? 1 : 0);
    assert.equal(runner.running, false);
  });
}

test(
  "rejects malformed responses and auctions without a reliable identity",
  { timeout: 2000 },
  async () => {
    for (const response of [
      null,
      {},
      { items: [], hasMore: "yes" },
      { items: [{}], hasMore: false },
      { items: [], hasMore: true, nextOffset: -1 },
    ]) {
      const runner = createBulkBuyRunner(options({ search: async () => response }));
      assert.equal((await runner.start()).reason, "error");
    }
  },
);

test(
  "clones and revalidates the plan at creation instead of trusting supplied totals",
  { timeout: 2000 },
  async () => {
    const supplied = { rows: [row()], totalCost: 0, totalQuantity: 0 };
    const runner = createBulkBuyRunner(
      options({
        plan: supplied,
        search: async () => ({ items: [{ id: "candidate" }], hasMore: false }),
      }),
    );
    supplied.rows[0].quantity = 99;
    assert.equal((await runner.start()).reason, "complete");
    assert.throws(() => createBulkBuyRunner(options({ plan: { rows: [row({ quantity: 99 })] } })));
    for (const action of ["getCoins", "search", "buy", "wait", "onStatus", "getAuctionKey"]) {
      assert.throws(() => createBulkBuyRunner(options({ [action]: null })));
    }
  },
);
