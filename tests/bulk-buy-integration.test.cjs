const assert = require("node:assert/strict");
const test = require("node:test");
const { loadBulkBuyHarness, descendants, text } = require("./support/bulk-buy-fixture.cjs");

const exported = [
  "getBulkBuyCoins",
  "isBulkBuyCandidate",
  "getBulkBuyPageSize",
  "searchBulkBuyMarket",
  "buyBulkBuyOffer",
  "openBulkBuyDialog",
  "startBulkBuy",
  "confirmPlayerSnipe",
  "startPlayerSnipe",
  "isBulkBuyAuctionUnavailable",
];
const row = () => ({ ovr: 83, maxPrice: 1000, quantity: 2 });
function offer(overrides = {}) {
  const auction = {
    tradeId: "auction-1",
    _tradeState: "active",
    buyNowPrice: 1000,
    ...overrides.auction,
  };
  return {
    rating: 83,
    definitionId: 123,
    isPlayer: () => true,
    getAuctionData: () => auction,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "auction")),
  };
}
async function flush() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}
function controls(dialog) {
  const inputs = descendants(dialog, (element) => element.tagName === "input");
  const buttons = descendants(dialog, (element) => element.tagName === "button");
  return {
    inputs,
    buttons,
    execute: buttons.find((button) => button.textContent === "Run"),
    back: buttons.find((button) => button.textContent === "Back"),
    add: buttons.find((button) => button.textContent === "+"),
  };
}
async function modal(harness) {
  const view = {};
  const controller = new harness.MarketFiltersController(view);
  harness.setCurrent(controller);
  await harness.openBulkBuyDialog(view);
  await flush();
  const dialog = harness.body.children.find((element) => element.tagName === "dialog");
  assert(dialog, "the bulk-buy dialog must open in the transfer market");
  return { dialog, ...controls(dialog) };
}
function fill(inputs, values) {
  assert.equal(inputs.length, values.length);
  for (let index = 0; index < inputs.length; index++) {
    inputs[index].value = String(values[index]);
    inputs[index].fire("input");
    inputs[index].fire("change");
  }
}

test("reads the current native coin VO each time and rejects an unavailable balance", () => {
  const harness = loadBulkBuyHarness(exported);
  assert.equal(harness.getBulkBuyCoins(), 100000);
  harness.user.coins = { value: () => 75000 };
  assert.equal(harness.getBulkBuyCoins(), 75000, "a successful bid can replace the native VO");
  for (const value of [-1, NaN, Infinity, 1.5, undefined]) {
    harness.user.coins = { value: () => value };
    assert.throws(() => harness.getBulkBuyCoins());
  }
});

test("bulk candidates require the exact OVR, an active auction, and a valid price and trade ID", () => {
  const harness = loadBulkBuyHarness(exported);
  assert.equal(harness.isBulkBuyCandidate(offer(), row()), true);
  for (const candidate of [
    null,
    {},
    offer({ rating: 84 }),
    offer({ isPlayer: () => false }),
    offer({ auction: { _tradeState: "closed" } }),
    offer({ auction: { buyNowPrice: 1001 } }),
    offer({ auction: { buyNowPrice: 0 } }),
    offer({ auction: { buyNowPrice: "1000" } }),
    offer({ auction: { tradeOwner: true } }),
    offer({ auction: { isPendingExpiry: () => true } }),
    offer({ auction: { _bidState: "highest" } }),
    offer({ auction: { tradeId: undefined } }),
  ]) {
    assert.equal(harness.isBulkBuyCandidate(candidate, row()), false);
  }
});

test("bulk search uses fresh native player criteria and the native page number", async () => {
  const harness = loadBulkBuyHarness(exported);
  const pageSize = harness.getBulkBuyPageSize();
  assert.equal(pageSize, 20);
  const task = harness.searchBulkBuyMarket({}, row(), {
    offset: pageSize * 2,
    signal: new AbortController().signal,
  });
  await flush();
  assert.equal(harness.searches.length, 1);
  const request = harness.searches[0];
  request.observable.emit({ success: true, data: { items: [] } });
  const result = await task;
  assert.equal(request.page, 3);
  assert.equal(request.criteria.type, "player");
  assert.equal(request.criteria.minBid, 0);
  assert.equal(request.criteria.minBuy, 0);
  assert.equal(request.criteria.maxBid, 0);
  assert.equal(request.criteria.maxBuy, 1000);
  assert.equal(request.criteria.disableOverrides, true);
  assert.equal(request.criteria.maskedDefId, 0);
  assert.equal(request.criteria.defId.length, 0);
  for (const field of ["club", "league", "nation", "ovrMin", "ovrMax"])
    assert.equal(
      request.criteria[field],
      undefined,
      `${field} must not inherit another market search`,
    );
  assert.equal(harness.calls.cacheClears, 1);
  assert.equal(result.items.length, 0);
  assert.equal(result.hasMore, false);
});

test("bulk search filters exact OVR locally and excludes the next-page sentinel", async () => {
  const harness = loadBulkBuyHarness(exported);
  const first = offer();
  const second = offer({ auction: { tradeId: "auction-2", buyNowPrice: 900 } });
  const sentinel = offer({ auction: { tradeId: "next-page" } });
  const raw = [
    first,
    second,
    ...Array.from({ length: 18 }, (_unused, index) =>
      offer({ rating: 84, auction: { tradeId: `wrong-${index}` } }),
    ),
    sentinel,
  ];
  const task = harness.searchBulkBuyMarket({}, row(), {
    offset: 0,
    signal: new AbortController().signal,
  });
  await flush();
  harness.searches[0].observable.emit({ success: true, data: { items: raw } });
  const result = await task;
  assert.deepEqual(result.items, [first, second]);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextOffset, 20);
});

test("bulk search fails closed on a server failure or malformed response", async () => {
  for (const response of [
    { success: false, status: 429 },
    { success: true, data: {} },
  ]) {
    const harness = loadBulkBuyHarness(exported);
    const task = harness.searchBulkBuyMarket({}, row(), {
      offset: 0,
      signal: new AbortController().signal,
    });
    await flush();
    harness.searches[0].observable.emit(response);
    await assert.rejects(task);
    assert.equal(harness.bids.length, 0);
  }
});

test("Stop aborts bulk search observation and an invalid native page is never requested", async () => {
  const harness = loadBulkBuyHarness(exported);
  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(
    harness.searchBulkBuyMarket({}, row(), { offset: 0, signal: stopped.signal }),
    (failure) => failure.name === "AbortError",
  );
  await assert.rejects(
    harness.searchBulkBuyMarket({}, row(), { offset: 1, signal: new AbortController().signal }),
  );
  assert.equal(harness.searches.length, 0);
  const abort = new AbortController();
  const task = harness.searchBulkBuyMarket({}, row(), { offset: 0, signal: abort.signal });
  await flush();
  assert.equal(harness.searches[0].observable.observers.size, 1);
  abort.abort();
  await assert.rejects(task, (failure) => failure.name === "AbortError");
  assert.equal(harness.searches[0].observable.observers.size, 0);
  assert.equal(harness.bids.length, 0);
});

test("bulk buy sends one native bid only for the requested OVR and maximum", async () => {
  const harness = loadBulkBuyHarness(exported);
  const candidate = offer();
  const result = await harness.buyBulkBuyOffer({}, row(), candidate, new AbortController().signal);
  assert.equal(result.success, true);
  assert.equal(result.price, 1000);
  assert.equal(harness.bids.length, 1);
  assert.equal(harness.bids[0].item, candidate);
  assert.equal(harness.bids[0].price, 1000);
  assert.equal(
    harness.bids[0].origin,
    "item-service",
    "bulk buys use the native item service without popup handling",
  );
  assert.equal(harness.bids[0].observable.observers.size, 0);
  assert.deepEqual(harness.dirty, ["purchased"]);
});

test("confirmed native auction races are skipped without counting a purchase", async () => {
  for (const [code, httpStatus] of [
    [462, 403],
    [478, 404],
    [479, 403],
  ]) {
    for (const status of [httpStatus, code]) {
      const harness = loadBulkBuyHarness(exported);
      const response = { success: false, status, error: { code } };
      assert.equal(harness.isBulkBuyAuctionUnavailable(response), true);
      harness.setBidResponse(response);
      const result = await harness.buyBulkBuyOffer(
        {},
        row(),
        offer(),
        new AbortController().signal,
      );
      assert.equal(result.success, false);
      assert.equal(harness.bids.length, 1);
      assert.equal(harness.bids[0].observable.observers.size, 0);
      assert.equal(harness.dirty.length, 0);
      assert.equal(harness.events.length, 0);
    }
  }
});

test("unclassified HTTP, permission, and rate-limit errors remain fatal to bulk buying", async () => {
  for (const response of [
    { success: false, status: 403 },
    { success: false, status: 404 },
    { success: false, status: 429 },
    { success: false, status: 461, error: { code: 461 } },
    { success: false, status: 403, error: { code: 461 } },
    { success: false, status: 429, error: { code: 462 } },
    { success: false, status: 404, error: { code: 462 } },
    { success: true, status: 403, error: { code: 462 } },
  ]) {
    const harness = loadBulkBuyHarness(exported);
    assert.equal(harness.isBulkBuyAuctionUnavailable(response), false);
    harness.setBidResponse(response);
    await assert.rejects(
      harness.buyBulkBuyOffer({}, row(), offer(), new AbortController().signal),
      /buy the bulk buy offer/,
    );
    assert.equal(harness.bids.length, 1);
    assert.equal(harness.dirty.length, 0);
    assert.equal(harness.bids[0].observable.observers.size, 0);
  }
});

test("bulk buy refuses a different rating, an excessive price, and insufficient current coins", async () => {
  const harness = loadBulkBuyHarness(exported);
  for (const candidate of [offer({ rating: 84 }), offer({ auction: { buyNowPrice: 1100 } })]) {
    const result = await harness.buyBulkBuyOffer(
      {},
      row(),
      candidate,
      new AbortController().signal,
    );
    assert.equal(result?.success, false);
  }
  harness.setCoins(1000);
  await assert.rejects(harness.buyBulkBuyOffer({}, row(), offer(), new AbortController().signal));
  assert.equal(harness.bids.length, 0);
});

test("Stop prevents a new bulk bid but keeps observing a buy that was already sent", async () => {
  const harness = loadBulkBuyHarness(exported);
  const stopped = new AbortController();
  stopped.abort();
  const rejected = await harness.buyBulkBuyOffer({}, row(), offer(), stopped.signal);
  assert.equal(rejected?.success, false);
  assert.equal(harness.bids.length, 0);
  harness.setBidResponse(null);
  const abort = new AbortController();
  const pending = harness.buyBulkBuyOffer({}, row(), offer(), abort.signal);
  abort.abort();
  assert.equal(harness.bids.length, 1);
  assert.equal(harness.bids[0].observable.observers.size, 1);
  harness.bids[0].observable.emit({ success: true });
  assert.equal((await pending).success, true);
});

test("bulk and player sniping cannot open competing purchase confirmations", async () => {
  const harness = loadBulkBuyHarness(exported);
  const view = {};
  harness.setCurrent(new harness.MarketFiltersController(view));
  harness.setPlayerSnipeSession({});
  assert.equal(harness.startBulkBuy({ rows: [row()] }), null);
  await harness.openBulkBuyDialog(view);
  assert.equal(harness.getBulkBuyConfirmation(), null);
  assert.equal(harness.body.children.length, 0);
  harness.setPlayerSnipeSession(null);
  harness.setBulkBuySession({});
  harness.confirmPlayerSnipe(view);
  assert.equal(harness.body.children.length, 0);
});

test("bulk modal starts with one row and keeps total and native balance visible", async () => {
  const harness = loadBulkBuyHarness(exported);
  const { dialog, inputs, execute, back, add } = await modal(harness);
  assert.equal(inputs.length, 3);
  assert(execute && back && add);
  fill(inputs, [83, 1000, 2]);
  assert.equal(execute.disabled, false);
  assert.match(text(dialog), /2000/);
  assert.match(text(dialog), /100000/);
  back.click();
  assert.equal(dialog.removed, true);
  assert.equal(harness.searches.length, 0);
});

test("additional OVR rows update the maximum total and can be removed", async () => {
  const harness = loadBulkBuyHarness(exported);
  const { dialog, inputs, add, back } = await modal(harness);
  fill(inputs, [83, 1000, 2]);
  add.click();
  const updated = controls(dialog);
  assert.equal(updated.inputs.length, 6);
  fill(updated.inputs, [83, 1000, 2, 84, 2000, 3]);
  assert.match(text(dialog), /8000/);
  const remove = updated.buttons.find((button) =>
    /Remove/i.test(button.textContent + (button.getAttribute("aria-label") || "")),
  );
  assert(remove);
  remove.click();
  assert.equal(controls(dialog).inputs.length, 3);
  back.click();
});

test("bulk modal disables execution for invalid rows and a maximum total reaching the coin balance", async () => {
  const harness = loadBulkBuyHarness(exported);
  const { inputs, execute, back } = await modal(harness);
  for (const values of [
    [0, 1000, 1],
    [100, 1000, 1],
    [83, 1050, 1],
    [83, 1000, 0],
    [83, 1000, 1.5],
  ]) {
    fill(inputs, values);
    assert.equal(execute.disabled, true);
  }
  harness.setCoins(2000);
  fill(inputs, [83, 1000, 2]);
  assert.equal(execute.disabled, true, "the maximum spend must remain below the current balance");
  back.click();
});

test("native coin notifications update the modal balance and execution state without editing rows", async () => {
  const harness = loadBulkBuyHarness(exported);
  const { inputs, execute, back } = await modal(harness);
  fill(inputs, [83, 1000, 2]);
  assert.equal(execute.disabled, false);
  harness.setCoins(2000);
  assert.equal(execute.disabled, true);
  assert.match(harness.getBulkBuyConfirmation().coinsLabel.textContent, /2000/);
  harness.setCoins(3000);
  assert.equal(execute.disabled, false);
  back.click();
});

test("Run revalidates coins before reserving the bulk session", async () => {
  const harness = loadBulkBuyHarness(exported);
  const { dialog, inputs, execute, back } = await modal(harness);
  fill(inputs, [83, 1000, 2]);
  const starts = [];
  harness.setStartBulkBuyHandler((plan) => starts.push(plan));
  harness.user.coins.amount = 1500;
  execute.click();
  await flush();
  assert.equal(starts.length, 0);
  assert.equal(dialog.removed, undefined);
  back.click();
});

test("Run passes only the confirmed row plan to the bulk runner", async () => {
  const harness = loadBulkBuyHarness(exported);
  const { dialog, inputs, execute } = await modal(harness);
  fill(inputs, [83, 1000, 2]);
  const starts = [];
  harness.setStartBulkBuyHandler((plan) => starts.push(plan));
  execute.click();
  await flush();
  assert.equal(starts.length, 1);
  assert.equal(starts[0].rows[0].ovr, 83);
  assert.equal(starts[0].rows[0].maxPrice, 1000);
  assert.equal(starts[0].rows[0].quantity, 2);
  assert.equal(starts[0].totalCost, 2000);
  assert.equal(dialog.removed, true);
});

test("Back cancels an in-flight balance refresh and cannot start a bulk run afterward", async () => {
  const harness = loadBulkBuyHarness(exported);
  harness.setCurrencyResponse(null);
  const { dialog, inputs, execute, back } = await modal(harness);
  fill(inputs, [83, 1000, 2]);
  const starts = [];
  harness.setStartBulkBuyHandler((plan) => starts.push(plan));
  execute.click();
  assert.equal(harness.currencyRequests.length, 1);
  assert.equal(harness.currencyRequests[0].observers.size, 1);
  assert.equal(
    inputs.every((input) => input.disabled),
    true,
  );
  back.click();
  assert.equal(harness.currencyRequests[0].observers.size, 0);
  harness.currencyRequests[0].emit({ success: true });
  await flush();
  assert.equal(starts.length, 0);
  assert.equal(harness.getBulkBuyConfirmation(), null);
  assert.equal(dialog.removed, true);
});

test("a balance reduced by the refresh keeps the bulk dialog open and refuses execution", async () => {
  const harness = loadBulkBuyHarness(exported);
  harness.setCurrencyResponse(null);
  const { dialog, inputs, execute, back } = await modal(harness);
  fill(inputs, [83, 1000, 2]);
  const starts = [];
  harness.setStartBulkBuyHandler((plan) => starts.push(plan));
  execute.click();
  harness.user.coins.amount = 1500;
  harness.currencyRequests[0].emit({ success: true });
  await flush();
  assert.equal(starts.length, 0);
  assert.equal(dialog.removed, undefined);
  assert.equal(execute.disabled, true);
  assert.match(text(harness.getBulkBuyConfirmation().error), /balance/i);
  back.click();
});

test("the bulk session reserves purchase ownership synchronously until its runner has stopped", async () => {
  const harness = loadBulkBuyHarness(exported, { fastTimers: true });
  const plan = { rows: [row()] };
  const task = harness.startBulkBuy(plan);
  const active = harness.getBulkBuySession();
  assert(active);
  assert.equal(harness.startBulkBuy(plan), null);
  harness.startPlayerSnipe(null, null, null, null);
  assert.equal(harness.getPlayerSnipeSession(), null);
  active.runner.stop();
  await task;
  assert.equal(harness.getBulkBuySession(), null);
  assert.equal(harness.searches.length, 0);
});

test("a pending purchase keeps the bulk ownership reservation after Stop until the native bid settles", async () => {
  const harness = loadBulkBuyHarness(exported, { fastTimers: true });
  harness.setBidResponse(null);
  const task = harness.startBulkBuy({ rows: [{ ...row(), quantity: 1 }] });
  const active = harness.getBulkBuySession();
  for (let attempt = 0; attempt < 30 && harness.searches.length < 1; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(harness.searches.length, 1);
  harness.searches[0].observable.emit({ success: true, data: { items: [offer()] } });
  for (let attempt = 0; attempt < 30 && harness.bids.length < 1; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(harness.bids.length, 1);
  active.runner.stop();
  assert.equal(harness.getBulkBuySession(), active);
  assert.equal(harness.startBulkBuy({ rows: [row()] }), null);
  harness.startPlayerSnipe(null, null, null, null);
  assert.equal(harness.getPlayerSnipeSession(), null);
  harness.bids[0].observable.emit({ success: true });
  const result = await task;
  assert.equal(result.totalBought, 1);
  assert.equal(harness.getBulkBuySession(), null);
});
