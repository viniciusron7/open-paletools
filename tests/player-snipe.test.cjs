const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { loadSources } = require("./support/load-sources.cjs");
const { PLAYER_SNIPE_CORE } = require("./support/market-automation-sources.cjs");

const context = vm.createContext({ AbortController, DOMException, setTimeout, clearTimeout });
loadSources(context, {
  modules: [PLAYER_SNIPE_CORE],
  epilogue: "globalThis.playerSnipeCore = { getNextPlayerSnipePrices, createPlayerSnipeRunner };",
});
const { getNextPlayerSnipePrices, createPlayerSnipeRunner } = context.playerSnipeCore;

// The first tick is supplied by the WebApp in production. This fixture deliberately
// supplies it instead of assuming that a search minimum must start at 150 or 200.
function nextPrice(value) {
  if (value === 0) return 150;
  const step =
    value < 1000 ? 50 : value < 10000 ? 100 : value < 50000 ? 250 : value < 100000 ? 500 : 1000;
  return value + step;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function runnerOptions(overrides = {}) {
  return {
    maxBuy: 2000,
    nextPrice,
    search: async () => [],
    buy: async () => true,
    returnToFilters: async () => {},
    wait: async () => {},
    ...overrides,
  };
}

test("advances by the minimum tick at each price tier boundary", () => {
  for (const [current, expected] of [
    [950, 1000],
    [9900, 10000],
    [49750, 50000],
    [99500, 100000],
  ]) {
    const prices = { minBid: 0, minBuy: current };
    assert.deepEqual(plain(getNextPlayerSnipePrices(prices, expected * 3, nextPrice)), {
      minBid: 0,
      minBuy: expected,
    });
    assert.deepEqual(prices, { minBid: 0, minBuy: current }, "does not mutate caller state");
  }
});

test("takes the first increment from the injected native price function", () => {
  const prices = { minBid: 0, minBuy: 0 };
  for (const firstTick of [150, 200]) {
    assert.deepEqual(
      plain(
        getNextPlayerSnipePrices(prices, 2000, (value) =>
          value === 0 ? firstTick : nextPrice(value),
        ),
      ),
      { minBid: 0, minBuy: firstTick },
    );
  }
});

test("uses a strict half-maximum boundary and resets minimum buy to minimum bid", () => {
  assert.deepEqual(plain(getNextPlayerSnipePrices({ minBid: 0, minBuy: 900 }, 2000, nextPrice)), {
    minBid: 0,
    minBuy: 950,
  });
  assert.deepEqual(plain(getNextPlayerSnipePrices({ minBid: 0, minBuy: 950 }, 2000, nextPrice)), {
    minBid: 150,
    minBuy: 150,
  });
  assert.deepEqual(plain(getNextPlayerSnipePrices({ minBid: 0, minBuy: 950 }, 2100, nextPrice)), {
    minBid: 0,
    minBuy: 1000,
  });
  assert.deepEqual(plain(getNextPlayerSnipePrices({ minBid: 900, minBuy: 950 }, 2000, nextPrice)), {
    minBid: 950,
    minBuy: 950,
  });
  assert.equal(getNextPlayerSnipePrices({ minBid: 950, minBuy: 950 }, 2000, nextPrice), null);
});

test("all complete filter cycles preserve the minimum constraints and terminate", () => {
  for (const maxBuy of [200, 250, 300, 350, 400, 500, 1000, 2000, 10000, 100000, 200000]) {
    let prices = { minBid: 0, minBuy: 0 };
    const seen = new Set();
    while (prices !== null) {
      assert(prices.minBid <= prices.minBuy);
      assert(prices.minBuy < maxBuy / 2);
      const key = JSON.stringify(prices);
      assert(!seen.has(key), `repeated filters for maximum ${maxBuy}: ${key}`);
      seen.add(key);
      prices = getNextPlayerSnipePrices(prices, maxBuy, nextPrice);
    }
    assert(seen.size > 0);
  }
});

test("rejects invalid inputs and increments instead of repeating a search forever", () => {
  for (const maxBuy of [0, -1, NaN, Infinity]) {
    assert.throws(() => getNextPlayerSnipePrices({ minBid: 0, minBuy: 0 }, maxBuy, nextPrice));
  }
  for (const prices of [
    null,
    {},
    { minBid: -1, minBuy: 0 },
    { minBid: 0, minBuy: -1 },
    { minBid: 200, minBuy: 150 },
  ]) {
    assert.throws(() => getNextPlayerSnipePrices(prices, 2000, nextPrice));
  }
  for (const value of [0, -1, NaN, Infinity, "150"]) {
    assert.throws(() => getNextPlayerSnipePrices({ minBid: 0, minBuy: 0 }, 2000, () => value));
  }
});

test(
  "searches initially with zero minimums and buys only the first candidate",
  { timeout: 2000 },
  async () => {
    const first = { id: "first" };
    const second = { id: "second" };
    const events = [];
    const statuses = [];
    const runner = createPlayerSnipeRunner(
      runnerOptions({
        search: async (prices, signal) => {
          assert.equal(signal.aborted, false);
          events.push(["search", plain(prices)]);
          return [first, second];
        },
        buy: async (item, signal) => {
          assert.equal(signal.aborted, false);
          events.push(["buy", item.id]);
          return true;
        },
        returnToFilters: async () => events.push(["return"]),
        wait: async () => events.push(["wait"]),
        onStatus: (status) => statuses.push(status),
      }),
    );
    const result = await runner.start();
    assert.equal(result.reason, "bought");
    assert.equal(result.item, first);
    assert.equal(runner.running, false);
    assert.deepEqual(events, [
      ["search", { minBid: 0, minBuy: 0 }],
      ["buy", "first"],
    ]);
    for (const phase of ["searching", "buying", "bought"]) {
      assert(
        statuses.some((status) => status.phase === phase),
        `missing status ${phase}`,
      );
    }
  },
);

test(
  "returns to filters, advances the range and waits after an empty result",
  { timeout: 2000 },
  async () => {
    const events = [];
    let searches = 0;
    const runner = createPlayerSnipeRunner(
      runnerOptions({
        search: async (prices) => {
          events.push(["search", plain(prices)]);
          assert(++searches <= 2, "must stop after purchasing");
          return searches === 1 ? [] : [{ id: "found" }];
        },
        buy: async (item) => {
          events.push(["buy", item.id]);
          return true;
        },
        returnToFilters: async () => events.push(["return"]),
        wait: async () => events.push(["wait"]),
      }),
    );
    assert.equal((await runner.start()).reason, "bought");
    assert.deepEqual(events, [
      ["search", { minBid: 0, minBuy: 0 }],
      ["return"],
      ["wait"],
      ["search", { minBid: 0, minBuy: 150 }],
      ["buy", "found"],
    ]);
  },
);

test(
  "a failed purchase advances the search instead of trying another card from the same result",
  { timeout: 2000 },
  async () => {
    let searches = 0;
    let returns = 0;
    let waits = 0;
    const purchases = [];
    const runner = createPlayerSnipeRunner(
      runnerOptions({
        search: async () => {
          assert(++searches <= 2);
          return searches === 1 ? [{ id: "expired" }, { id: "second" }] : [{ id: "available" }];
        },
        buy: async (item) => {
          purchases.push(item.id);
          return item.id === "available";
        },
        returnToFilters: async () => {
          returns++;
        },
        wait: async () => {
          waits++;
        },
      }),
    );
    assert.equal((await runner.start()).reason, "bought");
    assert.deepEqual(purchases, ["expired", "available"]);
    assert.equal(returns, 1);
    assert.equal(waits, 1);
  },
);

test(
  "runs the action delay before searching, returning, adjusting and buying",
  { timeout: 2000 },
  async () => {
    const events = [];
    let searches = 0;
    const runner = createPlayerSnipeRunner(
      runnerOptions({
        beforeAction: async (action, signal) => {
          assert.equal(signal.aborted, false);
          events.push(`before:${action}`);
        },
        search: async () => {
          events.push("search");
          assert(++searches <= 2);
          return searches === 1 ? [] : [{ id: "available" }];
        },
        buy: async () => {
          events.push("buy");
          return true;
        },
        returnToFilters: async () => {
          events.push("return");
        },
        nextPrice: (value) => {
          events.push("adjust");
          return nextPrice(value);
        },
        wait: async () => {
          events.push("wait");
        },
      }),
    );
    assert.equal((await runner.start()).reason, "bought");
    assert.deepEqual(events, [
      "before:search",
      "search",
      "before:return",
      "return",
      "before:adjust",
      "adjust",
      "wait",
      "before:search",
      "search",
      "before:buy",
      "buy",
    ]);
  },
);

for (const actionToStop of ["search", "return", "adjust", "buy"]) {
  test(
    `stopping in the ${actionToStop} delay prevents the pending action`,
    { timeout: 2000 },
    async () => {
      const calls = { search: 0, return: 0, adjust: 0, buy: 0, wait: 0 };
      let runner;
      runner = createPlayerSnipeRunner(
        runnerOptions({
          beforeAction: async (action) => {
            if (action === actionToStop) runner.stop();
          },
          search: async () => {
            calls.search++;
            return actionToStop === "buy" ? [{ id: "candidate" }] : [];
          },
          buy: async () => {
            calls.buy++;
            return true;
          },
          returnToFilters: async () => {
            calls.return++;
          },
          nextPrice: (value) => {
            calls.adjust++;
            return nextPrice(value);
          },
          wait: async () => {
            calls.wait++;
          },
        }),
      );
      assert.equal((await runner.start()).reason, "stopped");
      assert.equal(calls[actionToStop], 0);
      assert.equal(calls.wait, 0);
      assert.equal(runner.running, false);
    },
  );
}

test(
  "a failed action delay ends the run without sending a request",
  { timeout: 2000 },
  async () => {
    const error = new Error("delay failed");
    let searches = 0;
    const runner = createPlayerSnipeRunner(
      runnerOptions({
        beforeAction: async () => {
          throw error;
        },
        search: async () => {
          searches++;
          return [];
        },
      }),
    );
    const result = await runner.start();
    assert.equal(result.reason, "error");
    assert.equal(result.error, error);
    assert.equal(searches, 0);
    assert.equal(runner.running, false);
  },
);

test(
  "restarts both minimums after exhausting the valid prices and continues until a purchase",
  { timeout: 2000 },
  async () => {
    const searches = [];
    let purchases = 0;
    const runner = createPlayerSnipeRunner(
      runnerOptions({
        maxBuy: 300,
        search: async (prices) => {
          searches.push(plain(prices));
          assert(searches.length <= 2, "must stop after purchasing");
          return searches.length === 1 ? [] : [{ id: "found-on-next-cycle" }];
        },
        buy: async () => {
          purchases++;
          return true;
        },
      }),
    );
    assert.equal((await runner.start()).reason, "bought");
    assert.deepEqual(searches, [
      { minBid: 0, minBuy: 0 },
      { minBid: 0, minBuy: 0 },
    ]);
    assert.equal(purchases, 1);
    assert.equal(runner.running, false);
  },
);

test(
  "continues empty price cycles until Stop without crossing the half-maximum boundary",
  { timeout: 2000 },
  async () => {
    const searches = [];
    let returns = 0;
    let waits = 0;
    let runner;
    runner = createPlayerSnipeRunner(
      runnerOptions({
        maxBuy: 300,
        search: async (prices) => {
          searches.push(plain(prices));
          assert(searches.length <= 3);
          if (searches.length === 3) runner.stop();
          return [];
        },
        returnToFilters: async () => {
          returns++;
        },
        wait: async () => {
          waits++;
        },
      }),
    );
    assert.equal((await runner.start()).reason, "stopped");
    assert.deepEqual(
      searches,
      Array.from({ length: 3 }, () => ({ minBid: 0, minBuy: 0 })),
    );
    assert.equal(returns, 2);
    assert.equal(waits, 2);
    assert.equal(runner.running, false);
  },
);

test(
  "concurrent starts share the active work and never launch a second search",
  { timeout: 2000 },
  async () => {
    const pendingSearch = deferred();
    const searchEntered = deferred();
    let searches = 0;
    const runner = createPlayerSnipeRunner(
      runnerOptions({
        maxBuy: 300,
        search: async () => {
          searches++;
          searchEntered.resolve();
          return pendingSearch.promise;
        },
      }),
    );
    const firstRun = runner.start();
    await searchEntered.promise;
    const secondRun = runner.start();
    assert.equal(runner.running, true);
    assert.equal(searches, 1);
    pendingSearch.resolve([{ id: "candidate" }]);
    const results = await Promise.all([firstRun, secondRun]);
    assert.equal(results[0].reason, "bought");
    assert.equal(results[1].reason, "bought");
    assert.equal(searches, 1);
    assert.equal(runner.running, false);
  },
);

test(
  "a synchronous status observer cannot reenter start and launch another search",
  { timeout: 2000 },
  async () => {
    const pendingSearch = deferred();
    const searchEntered = deferred();
    let searches = 0;
    let reentered = false;
    let secondRun;
    let runner;
    runner = createPlayerSnipeRunner(
      runnerOptions({
        maxBuy: 300,
        search: async () => {
          searches++;
          searchEntered.resolve();
          return pendingSearch.promise;
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
    await searchEntered.promise;
    pendingSearch.resolve([{ id: "candidate" }]);
    const results = await Promise.all([firstRun, secondRun]);
    assert.equal(results[0].reason, "bought");
    assert.equal(results[1].reason, "bought");
    assert.equal(searches, 1);
  },
);

test(
  "a stop from the buying status observer prevents sending a purchase",
  { timeout: 2000 },
  async () => {
    let purchases = 0;
    let runner;
    runner = createPlayerSnipeRunner(
      runnerOptions({
        search: async () => [{ id: "candidate" }],
        buy: async () => {
          purchases++;
          return true;
        },
        onStatus: ({ phase }) => {
          if (phase === "buying") runner.stop();
        },
      }),
    );
    assert.equal((await runner.start()).reason, "stopped");
    assert.equal(purchases, 0);
    assert.equal(runner.running, false);
  },
);

test(
  "stopping a pending search aborts its signal and prevents any purchase",
  { timeout: 2000 },
  async () => {
    const pendingSearch = deferred();
    const searchEntered = deferred();
    const statuses = [];
    let searchSignal;
    let purchases = 0;
    let returns = 0;
    const runner = createPlayerSnipeRunner(
      runnerOptions({
        search: async (_prices, signal) => {
          searchSignal = signal;
          searchEntered.resolve();
          return pendingSearch.promise;
        },
        buy: async () => {
          purchases++;
          return true;
        },
        returnToFilters: async () => {
          returns++;
        },
        onStatus: (status) => statuses.push(status.phase),
      }),
    );
    const resultPromise = runner.start();
    await searchEntered.promise;
    runner.stop();
    assert.equal(searchSignal.aborted, true);
    pendingSearch.resolve([{ id: "late-result" }]);
    assert.equal((await resultPromise).reason, "stopped");
    assert.equal(purchases, 0);
    assert.equal(returns, 0);
    assert.equal(runner.running, false);
    assert(statuses.includes("stopping"));
    assert(statuses.includes("stopped"));
  },
);

for (const bought of [true, false]) {
  test(
    `a purchase already in flight settles after stop (${bought ? "bought" : "stopped"})`,
    { timeout: 2000 },
    async () => {
      const pendingBuy = deferred();
      const buyEntered = deferred();
      let purchases = 0;
      let returns = 0;
      let buySignal;
      const item = { id: "in-flight" };
      const runner = createPlayerSnipeRunner(
        runnerOptions({
          search: async () => [item],
          buy: async (candidate, signal) => {
            assert.equal(candidate, item);
            purchases++;
            buySignal = signal;
            buyEntered.resolve();
            return pendingBuy.promise;
          },
          returnToFilters: async () => {
            returns++;
          },
        }),
      );
      const resultPromise = runner.start();
      await buyEntered.promise;
      runner.stop();
      assert.equal(buySignal.aborted, true);
      pendingBuy.resolve(bought);
      const result = await resultPromise;
      assert.equal(result.reason, bought ? "bought" : "stopped");
      if (bought) assert.equal(result.item, item);
      assert.equal(purchases, 1);
      assert.equal(returns, 0);
      assert.equal(runner.running, false);
    },
  );
}

test(
  "stopping during return to filters prevents waiting or another search",
  { timeout: 2000 },
  async () => {
    const pendingReturn = deferred();
    const returnEntered = deferred();
    let searches = 0;
    let waits = 0;
    const runner = createPlayerSnipeRunner(
      runnerOptions({
        search: async () => {
          searches++;
          return [];
        },
        returnToFilters: async () => {
          returnEntered.resolve();
          return pendingReturn.promise;
        },
        wait: async () => {
          waits++;
        },
      }),
    );
    const resultPromise = runner.start();
    await returnEntered.promise;
    runner.stop();
    pendingReturn.resolve();
    assert.equal((await resultPromise).reason, "stopped");
    assert.equal(searches, 1);
    assert.equal(waits, 0);
  },
);

test(
  "stopping during the delay cancels the wait without another search",
  { timeout: 2000 },
  async () => {
    const waitEntered = deferred();
    let searches = 0;
    const runner = createPlayerSnipeRunner(
      runnerOptions({
        search: async () => {
          searches++;
          return [];
        },
        wait: (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("Stopped", "AbortError")),
              { once: true },
            );
            waitEntered.resolve();
          }),
      }),
    );
    const resultPromise = runner.start();
    await waitEntered.promise;
    runner.stop();
    assert.equal((await resultPromise).reason, "stopped");
    assert.equal(searches, 1);
    assert.equal(runner.running, false);
  },
);

test(
  "invalid search responses end the run instead of buying or searching again",
  { timeout: 2000 },
  async () => {
    for (const response of [null, undefined, {}, "items"]) {
      let searches = 0;
      let purchases = 0;
      const runner = createPlayerSnipeRunner(
        runnerOptions({
          search: async () => {
            searches++;
            return response;
          },
          buy: async () => {
            purchases++;
            return true;
          },
        }),
      );
      const result = await runner.start();
      assert.equal(result.reason, "error");
      assert(result.error);
      assert.equal(searches, 1);
      assert.equal(purchases, 0);
      assert.equal(runner.running, false);
    }
  },
);

test("rejects invalid runner settings before starting any request", () => {
  for (const maxBuy of [0, -1, NaN, Infinity, "2000"]) {
    assert.throws(() => createPlayerSnipeRunner(runnerOptions({ maxBuy })));
  }
  for (const action of [
    "nextPrice",
    "search",
    "buy",
    "returnToFilters",
    "wait",
    "beforeAction",
    "onStatus",
  ]) {
    assert.throws(() => createPlayerSnipeRunner(runnerOptions({ [action]: null })));
  }
});

for (const stage of ["search", "buy", "returnToFilters", "wait"]) {
  test(`a ${stage} failure ends the run without retries`, { timeout: 2000 }, async () => {
    const error = new Error(`failure in ${stage}`);
    const statuses = [];
    let searches = 0;
    let purchases = 0;
    const options = runnerOptions({
      search: async () => {
        searches++;
        return stage === "buy" ? [{ id: "candidate" }] : [];
      },
      buy: async () => {
        purchases++;
        return true;
      },
      onStatus: (status) => statuses.push(status),
    });
    options[stage] = async () => {
      if (stage === "search") searches++;
      if (stage === "buy") purchases++;
      throw error;
    };
    const runner = createPlayerSnipeRunner(options);
    const result = await runner.start();
    assert.equal(result.reason, "error");
    assert.equal(result.error, error);
    assert.equal(searches, 1);
    assert.equal(purchases, stage === "buy" ? 1 : 0);
    assert.equal(runner.running, false);
    assert(statuses.some((status) => status.phase === "error" && status.error === error));
  });
}
