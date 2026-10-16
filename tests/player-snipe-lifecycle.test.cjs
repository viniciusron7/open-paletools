const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { loadSources } = require("./support/load-sources.cjs");
const {
  PLAYER_SNIPE_AND_BULK_BUY_INTEGRATION,
} = require("./support/market-automation-sources.cjs");

class Element {
  constructor() {
    this.children = [];
    this.listeners = new Map();
    this.classList = { add() {} };
  }
  append(...children) {
    this.children.push(...children);
  }
  setAttribute() {}
  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }
  removeEventListener(type) {
    this.listeners.delete(type);
  }
  remove() {
    this.removed = true;
  }
  focus() {}
}

function observable() {
  const observers = new Map();
  return {
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

function fixture(t, { omitMaskedDefId = false } = {}) {
  let current;
  let navigation;
  const intervalCallbacks = new Set();
  const timers = new Set();
  const requests = [];
  const body = new Element();
  const events = [];
  const cancelTag = Symbol("cancel native method");
  class Button {
    constructor() {
      this.root = new Element();
    }
    init() {}
    setText(value) {
      this.root.textContent = value;
    }
    addTarget() {}
    setInteractionState() {}
    getRootElement() {
      return this.root;
    }
    destroy() {}
  }
  class MarketFiltersView {
    constructor() {
      this.root = new Element();
      this.__searchContainer = new Element();
      const playerSearch = {
        getSelected: () => ({ id: 123, name: "Player" }),
        addTarget() {},
        removeTarget() {},
      };
      this._searchFilters = { getPlayerNameSearch: () => playerSearch };
      for (const [field, value] of [
        ["_minBidPriceRow", 0],
        ["_maxBidPriceRow", 0],
        ["_minBuyNowPriceRow", 0],
        ["_maxBuyNowPriceRow", 1000],
      ]) {
        this[field] = { _currencyInput: { _currencyInput: { value } } };
      }
    }
    _generate() {}
    getRootElement() {
      return this.root;
    }
    setFilters() {} // Native setFilters does not update the price inputs.
    changePrice(field, value, handler) {
      const input = this[field]._currencyInput._currencyInput;
      const previous = input.value;
      input.value = value;
      if (previous !== value && this.controller)
        this[handler](null, null, { delta: value - previous });
    }
    setMinBidPrice(value) {
      this.changePrice("_minBidPriceRow", value, "eMinBidPriceChanged");
    }
    setMaxBidPrice(value) {
      this.changePrice("_maxBidPriceRow", value, "eMaxBidPriceChanged");
    }
    setMinBuyNowPrice(value) {
      this.changePrice("_minBuyNowPriceRow", value, "eMinBuyPriceChanged");
    }
    setMaxBuyNowPrice(value) {
      this.changePrice("_maxBuyNowPriceRow", value, "eMaxBuyPriceChanged");
    }
    eMinBidPriceChanged() {
      const minBid = this._minBidPriceRow._currencyInput._currencyInput.value;
      const minBuy = this._minBuyNowPriceRow._currencyInput._currencyInput.value;
      if (minBuy !== 0 && minBuy <= minBid) this.setMinBuyNowPrice(minBid + 50);
      this.controller.viewmodel.searchCriteria.minBid = minBid;
    }
    eMaxBidPriceChanged() {
      this.controller.viewmodel.searchCriteria.maxBid =
        this._maxBidPriceRow._currencyInput._currencyInput.value;
    }
    eMinBuyPriceChanged() {
      const minBid = this._minBidPriceRow._currencyInput._currencyInput.value;
      const minBuy = this._minBuyNowPriceRow._currencyInput._currencyInput.value;
      if (minBuy !== 0 && minBuy <= minBid) this.setMinBidPrice(Math.max(0, minBuy - 50));
      this.controller.viewmodel.searchCriteria.minBuy = minBuy;
    }
    eMaxBuyPriceChanged() {
      this.controller.viewmodel.searchCriteria.maxBuy =
        this._maxBuyNowPriceRow._currencyInput._currencyInput.value;
    }
    updateSearchCriteria() {}
    eSearchButtonSelected() {
      this.controller.eSearchSelected();
    }
    destroyGeneratedElements() {}
  }
  class MarketFiltersController {
    constructor(view) {
      this.view = view;
      view.controller = this;
      this.viewmodel = {
        playerData: { id: 123, name: "Player" },
        searchCriteria: {
          type: "player",
          maskedDefId: 123,
          minBid: 0,
          minBuy: 0,
          maxBid: 0,
          maxBuy: 1000,
        },
      };
    }
    getView() {
      return this.view;
    }
    getNavigationController() {
      return navigation;
    }
    viewDidAppear() {
      const prices = this.viewmodel.searchCriteria;
      this.view.setMinBidPrice(prices.minBid);
      this.view.setMaxBidPrice(prices.maxBid);
      this.view.setMinBuyNowPrice(prices.minBuy);
      this.view.setMaxBuyNowPrice(prices.maxBuy);
    }
    eResetSelected() {}
    eSearchSelected() {
      const criteria = { ...this.viewmodel.searchCriteria };
      if (omitMaskedDefId) {
        delete criteria.maskedDefId;
        criteria.defId = [123];
      }
      return context.services.Item.searchTransferMarket(criteria);
    }
  }
  class MarketResultsController {
    getNavigationController() {
      return navigation;
    }
  }
  class MarketResultsSplitController extends MarketResultsController {}
  const context = vm.createContext({
    AbortController,
    DOMException,
    queueMicrotask,
    setTimeout(callback, milliseconds) {
      const timer = setTimeout(callback, milliseconds < 10000 ? 0 : milliseconds);
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) {
      timers.delete(timer);
      clearTimeout(timer);
    },
    setInterval(callback) {
      intervalCallbacks.add(callback);
      return callback;
    },
    clearInterval(callback) {
      intervalCallbacks.delete(callback);
    },
    configuration: { enabled: true },
    SearchType: { PLAYER: "player" },
    ItemIdMask: { DATABASE: 16777215 },
    ItemPile: { PURCHASED: "purchased" },
    AuctionTradeStateEnum: { ACTIVE: "active" },
    UTMarketSearchFiltersView: MarketFiltersView,
    UTMarketSearchFiltersViewController: MarketFiltersController,
    UTMarketSearchResultsViewController: MarketResultsController,
    UTMarketSearchResultsSplitViewController: MarketResultsSplitController,
    UTStandardButtonControl: Button,
    UTCurrencyInputControl: { getIncrementAboveVal: (value) => (value === 0 ? 150 : value + 50) },
    EventType: { TAP: "tap", CHANGE: "change" },
    getViewModel: (controller) => controller.viewmodel,
    getActiveController: () => current,
    getPriceRowValue: (row) => row._currencyInput._currencyInput.value,
    roundToValidPrice: (price) => Math.round(price / 50) * 50,
    getItemDatabaseId: (item) => item?.databaseId ?? item?.definitionId & 16777215,
    clearSnipeRequests() {},
    restoreNotificationQueue() {},
    showSuccessNotification: (message) => events.push(message),
    showNeutralNotification: (message) => events.push(message),
    showErrorNotification: (message) => events.push(message),
    formatNumber: String,
    services: {
      Item: {
        clearTransferMarketCache() {},
        searchTransferMarket(criteria) {
          const request = { criteria, observable: observable() };
          requests.push(request);
          return request.observable;
        },
      },
    },
    repositories: {
      Item: { getStaticDataByDefId: () => ({ id: 123, name: "Player" }), setDirty() {} },
    },
    paletoolsEvents: { APP_DISABLED: "disabled", APP_ENABLED: "enabled", SNIPE_SUCCESS: "bought" },
    listenForEvent() {},
    dispatchPaletoolsEvent() {},
    upsertStylesheet() {},
    addClasses() {},
    queryElement: (_selector, parent) => parent,
    appendElements: (parent, child) => parent.append(child.getRootElement?.() || child),
    document: { body, createElement: () => new Element() },
    hookPrototypeMethod(Type, name, before, after) {
      const original = Type.prototype[name];
      assert.equal(typeof original, "function", `${name} must be a native method`);
      Type.prototype[name] = function (...args) {
        const change = before?.call(this, ...args);
        if (Array.isArray(change) && change[0] === cancelTag) return change[1];
        const result = original.call(this, ...args);
        if (after) after.call(this, ...args, result);
        return result;
      };
    },
    prototypeOverride: { cancel: (value) => [cancelTag, value] },
  });
  loadSources(context, {
    modules: PLAYER_SNIPE_AND_BULK_BUY_INTEGRATION,
    epilogue: `
    globalThis.lifecycle = {
      run() { playerSnipePlugin.run(); }, startPlayerSnipe,
      setSession(session) { activePlayerSnipeSession = session; },
      getSession() { return activePlayerSnipeSession; },
    };
  `,
  });
  const view = new MarketFiltersView();
  const controller = new MarketFiltersController(view);
  current = controller;
  navigation = {
    getCurrentController: () => current,
    childViewControllers: [controller],
    popToViewController(target) {
      current = target;
      target.viewDidAppear?.();
    },
  };
  context.lifecycle.run();
  let stops = 0;
  let captures = 0;
  const session = {
    view,
    controller,
    navigation,
    player: { id: "123", name: "Player" },
    maxBuy: 1000,
    criteria: { ...controller.viewmodel.searchCriteria },
    phase: "searching",
    triggeringSearch: false,
    applyingFilters: false,
    runner: {
      stop() {
        stops++;
      },
    },
    pendingSearch: {
      prices: { minBid: 0, minBuy: 0 },
      captured: false,
      accept() {
        captures++;
        this.captured = true;
      },
    },
  };
  t.after(async () => {
    const active = context.lifecycle.getSession();
    if (active?.runner?.running) active.runner.stop();
    for (const timer of timers) clearTimeout(timer);
    await Promise.resolve();
  });
  return {
    ...context.lifecycle,
    context,
    view,
    controller,
    session,
    requests,
    intervalCallbacks,
    events,
    get stops() {
      return stops;
    },
    get captures() {
      return captures;
    },
    setCurrent(value) {
      current = value;
    },
  };
}

test("native search DTO without maskedDefId still belongs to the pending confirmed search", (t) => {
  const harness = fixture(t, { omitMaskedDefId: true });
  harness.session.triggeringSearch = true;
  harness.setSession(harness.session);
  harness.controller.eSearchSelected();
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].criteria.maskedDefId, undefined);
  assert.equal(harness.captures, 1);
  assert.equal(harness.stops, 0);
});

test("an unrelated concurrent native request does not cancel a pending player search", (t) => {
  const harness = fixture(t);
  harness.setSession(harness.session);
  harness.context.services.Item.searchTransferMarket({ maxBuy: 5000, minBuy: 0, minBid: 0 });
  assert.equal(harness.captures, 0);
  assert.equal(harness.stops, 0);
});

test("delayed native search-selected event does not cancel the pending search initiation", async (t) => {
  const harness = fixture(t);
  harness.setSession(harness.session);
  await Promise.resolve();
  harness.controller.eSearchSelected();
  assert.equal(harness.captures, 1);
  assert.equal(harness.stops, 0);
});

test("delayed native price notifications with unchanged confirmed values do not cancel searching", async (t) => {
  const harness = fixture(t);
  harness.setSession(harness.session);
  await Promise.resolve();
  for (const method of [
    "eMinBidPriceChanged",
    "eMaxBidPriceChanged",
    "eMinBuyPriceChanged",
    "eMaxBuyPriceChanged",
  ])
    harness.view[method]();
  assert.equal(harness.stops, 0);
});

test("filter appearance during its pending native search does not cancel the session", (t) => {
  const harness = fixture(t);
  harness.setSession(harness.session);
  harness.controller.viewDidAppear();
  assert.equal(harness.stops, 0);
});

test("native price restoration preserves equal bid and buy minimums during an active session", (t) => {
  const harness = fixture(t);
  harness.setSession(harness.session);
  harness.controller.viewmodel.searchCriteria.minBid = 150;
  harness.controller.viewmodel.searchCriteria.minBuy = 150;
  harness.session.pendingSearch.prices = { minBid: 150, minBuy: 150 };
  harness.controller.viewDidAppear();
  assert.equal(harness.view._minBidPriceRow._currencyInput._currencyInput.value, 150);
  assert.equal(harness.view._minBuyNowPriceRow._currencyInput._currencyInput.value, 150);
  assert.equal(harness.controller.viewmodel.searchCriteria.minBid, 150);
  assert.equal(harness.controller.viewmodel.searchCriteria.minBuy, 150);
});

test("native filter view teardown during a search does not act as the Stop button", (t) => {
  const harness = fixture(t);
  harness.setSession(harness.session);
  harness.view.destroyGeneratedElements();
  assert.equal(harness.stops, 0);
});

test("a transient missing controller during native navigation does not cancel a pending search", async (t) => {
  const harness = fixture(t);
  harness.startPlayerSnipe(harness.controller, harness.view, { id: "123", name: "Player" }, 1000);
  const active = harness.getSession();
  assert(active);
  for (let attempts = 0; attempts < 20 && !harness.requests.length; attempts++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(harness.requests.length, 1, `phase=${active.phase}; ${harness.events.join("; ")}`);
  harness.setCurrent(null);
  for (const watcher of harness.intervalCallbacks) watcher();
  assert.notEqual(active.phase, "stopping");
  active.runner.stop();
  await Promise.resolve();
});

test("starting a search applies zero minimums even when the visible inputs contained old values", async (t) => {
  const harness = fixture(t);
  harness.view.setMinBidPrice(300);
  harness.view.setMinBuyNowPrice(400);
  harness.controller.viewmodel.searchCriteria.minBid = 300;
  harness.controller.viewmodel.searchCriteria.minBuy = 400;
  harness.startPlayerSnipe(harness.controller, harness.view, { id: "123", name: "Player" }, 1000);
  for (let attempts = 0; attempts < 20 && !harness.requests.length; attempts++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].criteria.minBid, 0);
  assert.equal(harness.requests[0].criteria.minBuy, 0);
  assert.equal(harness.view._minBidPriceRow._currencyInput._currencyInput.value, 0);
  assert.equal(harness.view._minBuyNowPriceRow._currencyInput._currencyInput.value, 0);
  harness.getSession()?.runner.stop();
});

test("empty native results continue into the next minimum-price search until Stop", async (t) => {
  const harness = fixture(t, { omitMaskedDefId: true });
  harness.startPlayerSnipe(harness.controller, harness.view, { id: "123", name: "Player" }, 1000);
  const active = harness.getSession();
  for (let attempts = 0; attempts < 20 && !harness.requests.length; attempts++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(harness.requests.length, 1);
  harness.requests[0].observable.emit({ success: true, data: { items: [] } });
  for (let attempts = 0; attempts < 30 && harness.requests.length < 2; attempts++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(harness.requests.length, 2, "a search returning no offers must continue the loop");
  assert.equal(harness.requests[1].criteria.minBid, 0);
  assert.equal(harness.requests[1].criteria.minBuy, 150);
  assert.equal(harness.requests[1].criteria.maxBuy, 1000);
  active.runner.stop();
});

test("empty results navigate back to existing filters, rebuild their view, and search the next minimum", async (t) => {
  const harness = fixture(t, { omitMaskedDefId: true });
  const navigation = harness.session.navigation;
  const nativeSearch = harness.controller.eSearchSelected.bind(harness.controller);
  harness.controller.eSearchSelected = (...args) => {
    const request = nativeSearch(...args);
    const results = new harness.context.UTMarketSearchResultsViewController();
    navigation.childViewControllers = [harness.controller, results];
    harness.setCurrent(results);
    harness.controller.getView().destroyGeneratedElements();
    return request;
  };
  let returns = 0;
  const nativePop = navigation.popToViewController.bind(navigation);
  navigation.popToViewController = (controller) => {
    returns++;
    const rebuilt = new harness.context.UTMarketSearchFiltersView();
    rebuilt.controller = controller;
    controller.view = rebuilt;
    nativePop(controller);
  };
  harness.startPlayerSnipe(harness.controller, harness.view, { id: "123", name: "Player" }, 1000);
  const active = harness.getSession();
  for (let attempts = 0; attempts < 20 && !harness.requests.length; attempts++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(harness.requests.length, 1);
  assert(
    navigation.getCurrentController() instanceof
      harness.context.UTMarketSearchResultsViewController,
  );
  harness.requests[0].observable.emit({ success: true, data: { items: [] } });
  for (let attempts = 0; attempts < 30 && harness.requests.length < 2; attempts++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(returns, 1, "uses native popToViewController to return to the market filters");
  assert.equal(harness.requests.length, 2);
  assert.equal(harness.requests[1].criteria.minBid, 0);
  assert.equal(harness.requests[1].criteria.minBuy, 150);
  assert.equal(active.controller, harness.controller);
  assert.notEqual(active.view, harness.view, "uses the newly created native filter view");
  active.runner.stop();
});

test("native setters emitting CHANGE cannot alter the equal minimums at bid rollover", async (t) => {
  const harness = fixture(t, { omitMaskedDefId: true });
  harness.startPlayerSnipe(harness.controller, harness.view, { id: "123", name: "Player" }, 1000);
  const active = harness.getSession();
  for (let index = 0; index < 9; index++) {
    for (let attempts = 0; attempts < 30 && harness.requests.length <= index; attempts++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(harness.requests.length, index + 1, `search ${index + 1} must continue`);
    if (index < 8) harness.requests[index].observable.emit({ success: true, data: { items: [] } });
  }
  assert.equal(harness.requests[8].criteria.minBid, 150);
  assert.equal(harness.requests[8].criteria.minBuy, 150);
  assert.equal(harness.view._minBidPriceRow._currencyInput._currencyInput.value, 150);
  assert.equal(harness.view._minBuyNowPriceRow._currencyInput._currencyInput.value, 150);
  active.runner.stop();
});

test("the explicit Stop button cancels a pending native search", async (t) => {
  const harness = fixture(t);
  harness.startPlayerSnipe(harness.controller, harness.view, { id: "123", name: "Player" }, 1000);
  const active = harness.getSession();
  for (let attempts = 0; attempts < 20 && !harness.requests.length; attempts++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(harness.requests.length, 1);
  const panel = harness.context.document.body.children.find(
    (element) => element.className === "paletools-player-snipe-status",
  );
  const stop = panel.children[1];
  assert.match(stop.textContent, /^Stop$/);
  stop.listeners.get("click")();
  assert.equal(active.phase, "stopping");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.requests.length, 1);
});
