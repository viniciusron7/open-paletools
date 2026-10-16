const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { loadSources } = require("./support/load-sources.cjs");
const {
  MARKET_HELPERS,
  PLAYER_SNIPE_AND_BULK_BUY_INTEGRATION,
} = require("./support/market-automation-sources.cjs");

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.textContent = "";
  }
  append(...children) {
    this.children.push(...children);
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
  }
  fire(name, event = {}) {
    for (const callback of this.listeners.get(name) || []) callback(event);
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  remove() {
    this.removed = true;
  }
  focus() {
    this.focused = true;
  }
}

function makeObservable() {
  const observers = new Map();
  return {
    observers,
    observe(owner, callback) {
      observers.set(owner, callback);
    },
    unobserve(owner) {
      observers.delete(owner);
    },
    emit(response) {
      for (const callback of [...observers.values()]) callback(this, response);
    },
  };
}

function fixture() {
  const staticPlayers = new Map();
  const bids = [];
  const dirty = [];
  const events = [];
  const errors = [];
  const requests = { cacheClears: 0, snipeQueueClears: 0 };
  const body = new FakeElement("body");
  let currentController;
  let bidResponse = { success: true, status: 200 };
  class MarketFiltersController {
    constructor(view, model) {
      this.view = view;
      this.viewmodel = model;
    }
    getView() {
      return this.view;
    }
  }
  const configuration = { enabled: true };
  const context = vm.createContext({
    AbortController,
    DOMException,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    configuration,
    SearchType: { PLAYER: "player" },
    ItemIdMask: { DATABASE: 16777215 },
    ItemPile: { PURCHASED: "purchased" },
    AuctionTradeStateEnum: { ACTIVE: "active" },
    UTMarketSearchFiltersViewController: MarketFiltersController,
    UTMarketSearchResultsViewController: class {},
    UTMarketSearchResultsSplitViewController: class {},
    UTCurrencyInputControl: {
      PRICE_TIERS: [
        { min: 100000, inc: 1000 },
        { min: 50000, inc: 500 },
        { min: 10000, inc: 250 },
        { min: 1000, inc: 100 },
        { min: 0, inc: 50 },
      ],
    },
    JSUtils: { find: (values, predicate) => values.find(predicate) },
    getViewModel: (controller) =>
      controller._viewmodel || controller.viewmodel || controller.viewModel,
    getActiveController: () => currentController,
    repositories: {
      Item: {
        getStaticDataByDefId: (id) => staticPlayers.get(Number(id)),
        setDirty: (pile) => dirty.push(pile),
      },
    },
    sharedItemActionController: {
      bid(item, price) {
        const observable = makeObservable();
        bids.push({ item, price, observable });
        if (bidResponse !== null) queueMicrotask(() => observable.emit(bidResponse));
        return observable;
      },
    },
    paletoolsEvents: { SNIPE_SUCCESS: "snipeSuccess" },
    dispatchPaletoolsEvent: (type, item) => events.push({ type, item }),
    formatNumber: (number) => String(number),
    showErrorNotification: (message) => errors.push(message),
    clearSnipeRequests: () => {
      requests.snipeQueueClears++;
    },
    services: {
      Item: {
        clearTransferMarketCache() {
          requests.cacheClears++;
        },
      },
    },
    document: { body, createElement: (tagName) => new FakeElement(tagName) },
  });
  loadSources(context, {
    functions: MARKET_HELPERS,
    modules: PLAYER_SNIPE_AND_BULK_BUY_INTEGRATION,
    epilogue: `
    globalThis.integration = {
      getPlayerSnipeSelection, getPlayerSnipeMaximum, isConfirmedPlayerSnipeItem,
      buyPlayerSnipeOffer, observePlayerSnipeRequest, confirmPlayerSnipe,
      validatePlayerSnipeFilterIdentity, searchPlayerSnipeMarket,
      setStartHandler(handler) { startPlayerSnipe = handler; },
      getConfirmation() { return playerSnipeConfirmation; },
    };
  `,
  });
  function selection({
    selected = { id: 123, name: "Player" },
    getter = true,
    modelPlayer = { id: 456, name: "Previous player" },
    maxBuy = 1000,
  } = {}) {
    const search = getter ? { getSelected: () => selected } : {};
    const view = {
      _searchFilters: { getPlayerNameSearch: () => search },
      _maxBuyNowPriceRow: { _currencyInput: { _currencyInput: { value: maxBuy } } },
    };
    const controller = new MarketFiltersController(view, {
      searchCriteria: { type: "player", maskedDefId: getter ? selected?.id : modelPlayer?.id },
      playerData: modelPlayer,
    });
    currentController = controller;
    return { view, controller, search };
  }
  return {
    ...context.integration,
    selection,
    configuration,
    staticPlayers,
    bids,
    dirty,
    events,
    body,
    errors,
    requests,
    setBidResponse(response) {
      bidResponse = response;
    },
  };
}

function item(overrides = {}) {
  const auction = { _tradeState: "active", buyNowPrice: 1000, ...overrides.auction };
  return {
    definitionId: 123,
    databaseId: 123,
    isPlayer: () => true,
    getAuctionData: () => auction,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "auction")),
  };
}

const session = () => ({ player: { id: "123", name: "Player" }, maxBuy: 1000 });

function searchFixture(harness, response) {
  const { view, controller } = harness.selection();
  const activeSession = {
    ...session(),
    view,
    controller,
    criteria: { ...controller.viewmodel.searchCriteria, league: 7 },
    runner: {
      stop() {
        activeSession.stops++;
      },
    },
    stops: 0,
  };
  const observed = makeObservable();
  const changes = [];
  const priceUpdates = [];
  view.setFilters = (model) => {
    changes.push("filters");
    assert.equal(model, controller.viewmodel);
  };
  // The native setFilters() updates player/category filters, not price inputs.
  for (const [method, field] of [
    ["setMinBidPrice", "_minBidPriceRow"],
    ["setMaxBidPrice", "_maxBidPriceRow"],
    ["setMinBuyNowPrice", "_minBuyNowPriceRow"],
    ["setMaxBuyNowPrice", "_maxBuyNowPriceRow"],
  ]) {
    view[method] = (value) => {
      priceUpdates.push({ method, value });
      if (!view[field]) view[field] = { _currencyInput: { _currencyInput: {} } };
      view[field]._currencyInput._currencyInput.value = value;
    };
  }
  for (const method of [
    "eMinBidPriceChanged",
    "eMaxBidPriceChanged",
    "eMinBuyPriceChanged",
    "eMaxBuyPriceChanged",
    "updateSearchCriteria",
  ]) {
    view[method] = () => changes.push(method);
  }
  const sentCriteria = [];
  view.eSearchButtonSelected = () => {
    sentCriteria.push({ ...controller.viewmodel.searchCriteria });
    activeSession.pendingSearch.accept(observed);
    queueMicrotask(() => observed.emit(response));
  };
  controller.eSearchSelected = () => view.eSearchButtonSelected();
  return { activeSession, observed, changes, priceUpdates, sentCriteria };
}

test("uses the current player control selection instead of a previous model player", () => {
  const harness = fixture();
  const { view, controller } = harness.selection();
  harness.staticPlayers.set(123, { commonName: "Player name" });
  const selected = harness.getPlayerSnipeSelection(view, controller);
  assert.equal(selected.id, "123");
  assert.equal(selected.name, "Player name");
});

test("clearing an existing player getter never resurrects the old model selection", () => {
  const harness = fixture();
  for (const selected of [null, undefined, {}, { name: "Text without a selection" }]) {
    const { view, controller } = harness.selection({ selected });
    if (selected === undefined)
      view._searchFilters.getPlayerNameSearch().getSelected = () => undefined;
    assert.equal(harness.getPlayerSnipeSelection(view, controller), null);
  }
});

test("uses native market model player data when the control has no selection getter", () => {
  const harness = fixture();
  const { view, controller } = harness.selection({
    getter: false,
    modelPlayer: { id: 789, firstName: "First", lastName: "Last" },
  });
  const selected = harness.getPlayerSnipeSelection(view, controller);
  assert.equal(selected.id, "789");
  assert.equal(selected.name, "First Last");
  controller.viewmodel.playerData = null;
  assert.equal(harness.getPlayerSnipeSelection(view, controller), null);
});

test("rejects stale model player data when its selected-player criterion was cleared or changed", () => {
  const harness = fixture();
  const { view, controller } = harness.selection({ getter: false });
  for (const maskedDefId of [undefined, null, 0, 123]) {
    controller.viewmodel.searchCriteria.maskedDefId = maskedDefId;
    assert.equal(harness.getPlayerSnipeSelection(view, controller), null);
  }
});

test("invalid player identifiers cannot become a confirmed selection", () => {
  const harness = fixture();
  for (const id of [0, -1, NaN, Infinity, "not-an-id", 123.5]) {
    const { view, controller } = harness.selection({ selected: { id, name: "Invalid" } });
    assert.equal(harness.getPlayerSnipeSelection(view, controller), null);
  }
});

test("does not offer a player selection when disabled or searching another category", () => {
  const harness = fixture();
  const { view, controller } = harness.selection();
  controller.viewmodel.searchCriteria.type = "consumables";
  assert.equal(harness.getPlayerSnipeSelection(view, controller), null);
  controller.viewmodel.searchCriteria.type = "player";
  harness.configuration.enabled = false;
  assert.equal(harness.getPlayerSnipeSelection(view, controller), null);
});

test("accepts native valid maximums at tier boundaries and rejects invalid prices", () => {
  const harness = fixture();
  for (const maxBuy of [200, 950, 1000, 9900, 10000, 49750, 50000, 99500, 100000, 14999000]) {
    const { view } = harness.selection({ maxBuy });
    assert.equal(harness.getPlayerSnipeMaximum(view), maxBuy);
  }
  for (const maxBuy of [
    0,
    -200,
    150,
    201,
    1050,
    10100,
    50250,
    100500,
    15000000,
    NaN,
    Infinity,
    1000.5,
  ]) {
    const { view } = harness.selection({ maxBuy });
    assert.equal(harness.getPlayerSnipeMaximum(view), null, `rejects ${maxBuy}`);
  }
});

test("accepts revisions of the confirmed player and rejects different or unidentified items", () => {
  const harness = fixture();
  assert.equal(harness.isConfirmedPlayerSnipeItem(session(), item()), true);
  assert.equal(
    harness.isConfirmedPlayerSnipeItem(session(), item({ definitionId: 16777339 })),
    true,
  );
  assert.equal(
    harness.isConfirmedPlayerSnipeItem(
      session(),
      item({
        definitionId: undefined,
        itemData: { definitionId: 16777339 },
        databaseId: undefined,
      }),
    ),
    true,
  );
  for (const candidate of [
    null,
    {},
    item({ isPlayer: () => false }),
    item({ isPlayer: undefined }),
    item({ definitionId: 456, databaseId: 456 }),
    item({ definitionId: undefined, databaseId: undefined }),
  ]) {
    assert.equal(harness.isConfirmedPlayerSnipeItem(session(), candidate), false);
  }
});

test("accepts matching revision filters and rejects criteria for a different player", () => {
  const harness = fixture();
  const { view, controller } = harness.selection();
  for (const defId of [undefined, [], [123], [16777339], "123", [123, 16777339]]) {
    controller.viewmodel.searchCriteria.defId = defId;
    assert.doesNotThrow(() =>
      harness.validatePlayerSnipeFilterIdentity(view, controller, session().player),
    );
  }
  for (const defId of [[456], [123, 456], "456", [-1], ["invalid"], [123.5]]) {
    controller.viewmodel.searchCriteria.defId = defId;
    assert.throws(
      () => harness.validatePlayerSnipeFilterIdentity(view, controller, session().player),
      /Player ID/,
    );
  }
});

test("checks the currently entered Player ID before the control writes it to criteria", () => {
  const harness = fixture();
  const { view, controller } = harness.selection();
  for (const control of [{ getValue: () => "456" }, { getRootElement: () => ({ value: "456" }) }]) {
    view._playerId = control;
    assert.throws(
      () => harness.validatePlayerSnipeFilterIdentity(view, controller, session().player),
      /Player ID/,
    );
  }
  for (const value of ["", "  ", "123", "16777339"]) {
    view._playerId = { getValue: () => value };
    assert.doesNotThrow(() =>
      harness.validatePlayerSnipeFilterIdentity(view, controller, session().player),
    );
  }
});

test("search adapter applies initial zero minimums, confirmed maximum, and preserved market filters", async () => {
  const harness = fixture();
  const candidate = item();
  const { activeSession, observed, changes, priceUpdates, sentCriteria } = searchFixture(harness, {
    success: true,
    status: 200,
    data: { items: [candidate] },
  });
  const found = await harness.searchPlayerSnipeMarket(
    activeSession,
    { minBid: 0, minBuy: 0 },
    new AbortController().signal,
  );
  assert.deepEqual(found, [candidate]);
  assert.equal(sentCriteria.length, 1);
  assert.deepEqual(sentCriteria[0], {
    type: "player",
    maskedDefId: 123,
    league: 7,
    minBid: 0,
    minBuy: 0,
    maxBid: 0,
    maxBuy: 1000,
  });
  assert.equal(harness.requests.cacheClears, 1);
  assert.equal(harness.requests.snipeQueueClears, 1);
  assert.equal(
    changes.some((method) => /^e(?:Min|Max).*PriceChanged$/.test(method)),
    false,
    "price change handlers must not overwrite the explicitly applied search prices",
  );
  assert.deepEqual(priceUpdates, [
    { method: "setMinBidPrice", value: 0 },
    { method: "setMaxBidPrice", value: 0 },
    { method: "setMinBuyNowPrice", value: 0 },
    { method: "setMaxBuyNowPrice", value: 1000 },
  ]);
  assert.equal(observed.observers.size, 0);
  assert.equal(harness.bids.length, 0, "searching alone must not send a purchase");
});

test("search adapter returns only active offers of the confirmed player within its maximum", async () => {
  const harness = fixture();
  const exact = item();
  const cheaperRevision = item({ definitionId: 16777339, auction: { buyNowPrice: 900 } });
  const { activeSession } = searchFixture(harness, {
    success: true,
    data: {
      items: [
        item({ definitionId: 456, databaseId: 456 }),
        item({ auction: { buyNowPrice: 1100 } }),
        item({ auction: { _tradeState: "closed" } }),
        item({ isPlayer: () => false }),
        cheaperRevision,
        exact,
      ],
    },
  });
  const found = await harness.searchPlayerSnipeMarket(
    activeSession,
    { minBid: 150, minBuy: 250 },
    new AbortController().signal,
  );
  assert.deepEqual(found, [cheaperRevision, exact], "retains the native order of eligible offers");
  assert.equal(harness.bids.length, 0);
});

test("search adapter rejects server failures and malformed responses without buying", async () => {
  for (const response of [
    { success: false, status: 429 },
    { success: true, data: {} },
  ]) {
    const harness = fixture();
    const { activeSession, observed } = searchFixture(harness, response);
    await assert.rejects(
      harness.searchPlayerSnipeMarket(
        activeSession,
        { minBid: 0, minBuy: 0 },
        new AbortController().signal,
      ),
    );
    assert.equal(harness.bids.length, 0);
    assert.equal(observed.observers.size, 0);
  }
});

test("search adapter rejects a changed player or conflicting Player ID before sending a request", async () => {
  for (const change of [
    ({ view }) => {
      view._searchFilters.getPlayerNameSearch().getSelected = () => ({ id: 456, name: "Other" });
    },
    ({ view }) => {
      view._playerId = { getValue: () => "456" };
    },
  ]) {
    const harness = fixture();
    const { activeSession, sentCriteria } = searchFixture(harness, {
      success: true,
      data: { items: [] },
    });
    change(activeSession);
    await assert.rejects(
      harness.searchPlayerSnipeMarket(
        activeSession,
        { minBid: 0, minBuy: 0 },
        new AbortController().signal,
      ),
    );
    assert.equal(sentCriteria.length, 0);
    assert.equal(harness.requests.cacheClears, 0);
  }
});

test("submits exactly one buy at the confirmed maximum and records successful purchase", async () => {
  const harness = fixture();
  const candidate = item();
  const result = await harness.buyPlayerSnipeOffer(
    session(),
    candidate,
    new AbortController().signal,
  );
  assert.equal(result, true);
  assert.equal(harness.bids.length, 1);
  assert.equal(harness.bids[0].item, candidate);
  assert.equal(harness.bids[0].price, 1000);
  assert.equal(harness.bids[0].observable.observers.size, 0);
  assert.deepEqual(harness.dirty, ["purchased"]);
  assert.deepEqual(harness.events, [{ type: "snipeSuccess", item: candidate }]);
});

test("never sends a buy for a different player or a price outside the confirmed maximum", async () => {
  const harness = fixture();
  for (const candidate of [
    item({ definitionId: 456, databaseId: 456 }),
    item({ isPlayer: () => false }),
    item({ auction: { buyNowPrice: 1001 } }),
    item({ auction: { buyNowPrice: 0 } }),
    item({ auction: { buyNowPrice: -1 } }),
    item({ auction: { buyNowPrice: 999.5 } }),
    item({ auction: { buyNowPrice: "1000" } }),
  ]) {
    await assert.rejects(
      harness.buyPlayerSnipeOffer(session(), candidate, new AbortController().signal),
    );
  }
  assert.equal(harness.bids.length, 0);
  assert.equal(harness.events.length, 0);
});

test("does not submit a buy after Stop or when an offer is no longer active", async () => {
  const harness = fixture();
  const abort = new AbortController();
  abort.abort();
  assert.equal(await harness.buyPlayerSnipeOffer(session(), item(), abort.signal), false);
  assert.equal(
    await harness.buyPlayerSnipeOffer(
      session(),
      item({ auction: { _tradeState: "closed" } }),
      new AbortController().signal,
    ),
    false,
  );
  assert.equal(harness.bids.length, 0);
});

test("keeps observing a submitted buy after Stop and waits for its actual result", async () => {
  const harness = fixture();
  harness.setBidResponse(null);
  const abort = new AbortController();
  const pending = harness.buyPlayerSnipeOffer(session(), item(), abort.signal);
  let settled = false;
  pending.finally(() => {
    settled = true;
  });
  abort.abort();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(harness.bids.length, 1);
  assert.equal(harness.bids[0].observable.observers.size, 1);
  harness.bids[0].observable.emit({ success: true, status: 200 });
  assert.equal(await pending, true);
  assert.equal(harness.bids[0].observable.observers.size, 0);
});

test("failed buy responses do not report a purchased player", async () => {
  for (const response of [
    null,
    { success: false, status: 461 },
    { success: true, status: 429 },
    { success: true, error: "failure" },
  ]) {
    const harness = fixture();
    harness.setBidResponse(response === null ? { success: false } : response);
    await assert.rejects(
      harness.buyPlayerSnipeOffer(session(), item(), new AbortController().signal),
      /buy the offer/,
    );
    assert.equal(harness.bids.length, 1);
    assert.equal(harness.dirty.length, 0);
    assert.equal(harness.events.length, 0);
    assert.equal(harness.bids[0].observable.observers.size, 0);
  }
});

test("confirmation modal displays the player, maximum, and exact Confirm and Back labels", () => {
  const harness = fixture();
  const { view } = harness.selection({ selected: { id: 123, name: "<b>Player</b>" } });
  harness.confirmPlayerSnipe(view);
  const dialog = harness.body.children[0];
  assert.equal(dialog.tagName, "dialog");
  assert.equal(dialog.open, true);
  assert.equal(dialog.children[1].textContent, "Player: <b>Player</b>");
  assert.match(dialog.children[2].textContent, /1000/);
  const [confirm, back] = dialog.children.at(-1).children;
  assert.equal(confirm.textContent, "Confirm");
  assert.equal(back.textContent, "Back");
  back.fire("click");
  assert.equal(dialog.removed, true);
  assert.equal(harness.getConfirmation(), null);
  assert.equal(harness.bids.length, 0);
});

test("Confirm starts only after rechecking the same selected player and maximum", () => {
  const harness = fixture();
  const { view } = harness.selection();
  const starts = [];
  harness.setStartHandler((...args) => starts.push(args));
  harness.confirmPlayerSnipe(view);
  const dialog = harness.body.children[0];
  dialog.children.at(-1).children[0].fire("click");
  assert.equal(starts.length, 1);
  assert.equal(starts[0][2].id, "123");
  assert.equal(starts[0][3], 1000);
  assert.equal(dialog.removed, true);
});

test("confirmation rejects a changed selection or changed maximum", () => {
  for (const change of [
    ({ search }) => {
      search.getSelected = () => ({ id: 456, name: "Other" });
    },
    ({ view }) => {
      view._maxBuyNowPriceRow._currencyInput._currencyInput.value = 1100;
    },
  ]) {
    const harness = fixture();
    const selected = harness.selection();
    let starts = 0;
    harness.setStartHandler(() => {
      starts++;
    });
    harness.confirmPlayerSnipe(selected.view);
    change(selected);
    harness.body.children[0].children.at(-1).children[0].fire("click");
    assert.equal(starts, 0);
    assert.equal(harness.errors.length, 1);
    assert.equal(harness.getConfirmation(), null);
  }
});

test("Escape closes confirmation without starting searches or purchases", () => {
  const harness = fixture();
  const { view } = harness.selection();
  let starts = 0;
  let prevented = false;
  harness.setStartHandler(() => {
    starts++;
  });
  harness.confirmPlayerSnipe(view);
  const dialog = harness.body.children[0];
  dialog.fire("cancel", {
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(starts, 0);
  assert.equal(harness.bids.length, 0);
  assert.equal(dialog.removed, true);
});
