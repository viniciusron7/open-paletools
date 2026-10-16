const vm = require("node:vm");
const { after } = require("node:test");
const { loadSources } = require("./load-sources.cjs");
const {
  BULK_BUY_CORE,
  MARKET_HELPERS,
  PLAYER_SNIPE_AND_BULK_BUY_INTEGRATION,
} = require("./market-automation-sources.cjs");

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toLowerCase();
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.dataset = {};
    this.textContent = "";
    this.value = "";
    this.className = "";
    this.classList = {
      add: (...classes) => {
        this.className = [...new Set([...this.className.split(/\s+/), ...classes])]
          .filter(Boolean)
          .join(" ");
      },
      remove: (...classes) => {
        this.className = this.className
          .split(/\s+/)
          .filter((name) => !classes.includes(name))
          .join(" ");
      },
      contains: (name) => this.className.split(/\s+/).includes(name),
    };
  }
  append(...children) {
    for (const child of children) {
      const element =
        typeof child === "string"
          ? Object.assign(new FakeElement("text"), { textContent: child })
          : child;
      element.parentElement = this;
      this.children.push(element);
    }
  }
  appendChild(child) {
    this.append(child);
    return child;
  }
  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }
  remove() {
    this.removed = true;
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = String(value);
    if (name === "id") this.id = String(value);
    if (name === "disabled") this.disabled = true;
    if (name.startsWith("data-"))
      this.dataset[name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] =
        String(value);
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  removeAttribute(name) {
    delete this.attributes[name];
    if (name === "disabled") this.disabled = false;
  }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  removeEventListener(type, callback) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter((listener) => listener !== callback),
    );
  }
  fire(type, details = {}) {
    if (type === "click" && this.disabled) return;
    const event = {
      target: this,
      currentTarget: this,
      preventDefault() {},
      stopPropagation() {
        this.stopped = true;
      },
      ...details,
    };
    for (let element = this; element; element = event.stopped ? null : element.parentElement) {
      event.currentTarget = element;
      for (const callback of element.listeners.get(type) || []) callback(event);
      if (event.bubbles === false) break;
    }
    return event;
  }
  click() {
    return this.fire("click");
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  focus() {
    this.focused = true;
  }
  get valueAsNumber() {
    return Number(this.value);
  }
  getRootElement() {
    return this;
  }
  querySelectorAll(selector) {
    const all = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (matches(child, selector)) all.push(child);
        visit(child);
      }
    };
    visit(this);
    return all;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  closest(selector) {
    for (let element = this; element; element = element.parentElement)
      if (matches(element, selector)) return element;
    return null;
  }
}

function matches(element, selector) {
  return selector.split(",").some((part) => {
    const value = part.trim();
    if (value.startsWith(".")) return element.classList.contains(value.slice(1));
    if (value.startsWith("#")) return element.id === value.slice(1);
    const attribute = value.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
    if (attribute)
      return attribute[2] == null
        ? element.getAttribute(attribute[1]) != null
        : element.getAttribute(attribute[1]) === attribute[2];
    return element.tagName === value.toLowerCase();
  });
}

function observable() {
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

function loadBulkBuyHarness(exportNames, { fastTimers = false } = {}) {
  const body = new FakeElement("body");
  const user = {
    coins: {
      amount: 100000,
      value() {
        return this.amount;
      },
    },
  };
  user.getCurrency = () => user.coins;
  const currencyObservers = new Map();
  const currencyRequests = [];
  const timers = new Set();
  const bids = [];
  const searches = [];
  const events = [];
  const notifications = [];
  const dirty = [];
  const staticPlayers = new Map();
  let current;
  let bidResponse = { success: true, status: 200 };
  let currencyResponse = { success: true, status: 200 };
  const calls = { cacheClears: 0, snipeQueueClears: 0 };
  const captureBid = (item, price, origin) => {
    const request = { item, price, origin, observable: observable() };
    bids.push(request);
    if (bidResponse !== null) queueMicrotask(() => request.observable.emit(bidResponse));
    return request.observable;
  };
  class MarketFiltersController {
    constructor(view = {}) {
      this.view = view;
      this.viewmodel = {
        playerData: { id: 123, name: "Player" },
        searchCriteria: { type: "player", maskedDefId: 123 },
      };
    }
    getView() {
      return this.view;
    }
    getNavigationController() {
      return this.navigation;
    }
  }
  class StandardButton {
    constructor() {
      this.root = new FakeElement("button");
    }
    init() {}
    setText(value) {
      this.root.textContent = value;
    }
    addTarget(owner, callback) {
      this.root.addEventListener("click", () => callback.call(owner));
    }
    setInteractionState(value) {
      this.root.disabled = !value;
    }
    getRootElement() {
      return this.root;
    }
    destroy() {
      this.root.remove();
    }
  }
  const context = vm.createContext({
    AbortController,
    DOMException,
    queueMicrotask,
    setInterval,
    clearInterval,
    setTimeout(callback, milliseconds) {
      const timer = setTimeout(callback, fastTimers && milliseconds < 10000 ? 0 : milliseconds);
      timers.add(timer);
      return timer;
    },
    clearTimeout(timer) {
      timers.delete(timer);
      clearTimeout(timer);
    },
    configuration: { enabled: true, requests: { maxItemsCount: 50 } },
    numItemsPerPage: 20,
    SearchType: { PLAYER: "player" },
    SearchSortType: { VALUE: "value" },
    SearchSortOrder: { ASCENDING: "asc" },
    ItemPile: { PURCHASED: "purchased" },
    ItemIdMask: { DATABASE: 16777215 },
    GameCurrency: { COINS: "COINS" },
    AuctionTradeStateEnum: { ACTIVE: "active" },
    UTMarketSearchFiltersViewController: MarketFiltersController,
    UTMarketSearchResultsViewController: class {},
    UTMarketSearchResultsSplitViewController: class {},
    UTStandardButtonControl: StandardButton,
    UTSearchCriteriaDTO: class {},
    EAConfigurationRepository: {
      KEY_ITEMS_PER_PAGE: "itemsPerPage",
      ITEMS_PER_PAGE: { TRANSFER_MARKET: "market" },
    },
    getAppMain: () => ({
      getConfigRepository: () => ({ getConfigObject: () => ({ market: 20 }) }),
    }),
    UTCurrencyInputControl: {
      PRICE_TIERS: [
        { min: 100000, inc: 1000 },
        { min: 50000, inc: 500 },
        { min: 10000, inc: 250 },
        { min: 1000, inc: 100 },
        { min: 0, inc: 50 },
      ],
      getIncrementAboveVal: (value) => (value === 0 ? 150 : value + 50),
    },
    JSUtils: { find: (values, predicate) => values.find(predicate) },
    getViewModel: (controller) =>
      controller._viewmodel || controller.viewmodel || controller.viewModel,
    getActiveController: () => current,
    clearSnipeRequests: () => {
      calls.snipeQueueClears++;
    },
    restoreNotificationQueue() {},
    showSuccessNotification: (message) => notifications.push(message),
    showNeutralNotification: (message) => notifications.push(message),
    showErrorNotification: (message) => notifications.push(message),
    formatNumber: String,
    repositories: {
      Item: {
        getStaticDataByDefId: (id) => staticPlayers.get(Number(id)),
        setDirty: (pile) => dirty.push(pile),
      },
    },
    sharedItemActionController: {
      bid: (item, price) => captureBid(item, price, "action-controller"),
    },
    services: {
      User: {
        getUser: () => user,
        requestCurrencies() {
          const result = observable();
          currencyRequests.push(result);
          if (currencyResponse !== null) queueMicrotask(() => result.emit(currencyResponse));
          return result;
        },
      },
      Item: {
        bid: (item, price) => captureBid(item, price, "item-service"),
        clearTransferMarketCache() {
          calls.cacheClears++;
        },
        searchTransferMarket(criteria, page) {
          const request = { criteria: { ...criteria }, page, observable: observable() };
          searches.push(request);
          return request.observable;
        },
      },
    },
    paletoolsEvents: {
      SNIPE_SUCCESS: "snipeSuccess",
      APP_ENABLED: "enabled",
      APP_DISABLED: "disabled",
    },
    AppNotification: { USER_CURRENCY_UPDATE: "currencyUpdate" },
    getDefaultDispatcher: () => ({
      addObserver(type, owner, callback) {
        currencyObservers.set(owner, callback);
      },
      removeObserver(type, owner) {
        currencyObservers.delete(owner);
      },
    }),
    dispatchPaletoolsEvent: (type, data) => events.push({ type, data }),
    document: { body, createElement: (tagName) => new FakeElement(tagName) },
    EventType: { TAP: "tap", CHANGE: "change" },
    addClasses: (element, ...classes) =>
      (element.getRootElement?.() || element).classList.add(...classes),
    appendElements: (parent, ...children) =>
      (parent.getRootElement?.() || parent).append(
        ...children.map((child) => child.getRootElement?.() || child),
      ),
    queryElement: (selector, parent) => parent?.querySelector(selector),
  });
  loadSources(context, {
    functions: MARKET_HELPERS,
    modules: [BULK_BUY_CORE, ...PLAYER_SNIPE_AND_BULK_BUY_INTEGRATION],
    epilogue: `
    globalThis.integration = {
      ${exportNames.join(", ")},
      setPlayerSnipeSession(session) { activePlayerSnipeSession = session; },
      setPlayerSnipeConfirmation(confirmation) { playerSnipeConfirmation = confirmation; },
      setBulkBuySession(session) { activeBulkBuySession = session; },
      getBulkBuySession() { return activeBulkBuySession; },
      getPlayerSnipeSession() { return activePlayerSnipeSession; },
      getBulkBuyConfirmation() { return bulkBuyConfirmation; },
      setStartBulkBuyHandler(handler) { startBulkBuy = handler; },
    };
  `,
  });
  const cleanup = async () => {
    const active = context.integration.getBulkBuySession();
    active?.runner?.stop();
    context.integration.getBulkBuyConfirmation()?.close();
    if (active?.task) await active.task.catch(() => {});
    for (const timer of timers) clearTimeout(timer);
  };
  after(cleanup);
  return {
    ...context.integration,
    context,
    body,
    user,
    bids,
    searches,
    events,
    notifications,
    dirty,
    staticPlayers,
    calls,
    FakeElement,
    MarketFiltersController,
    currencyRequests,
    cleanup,
    setCurrent(controller) {
      current = controller;
    },
    setBidResponse(response) {
      bidResponse = response;
    },
    setCurrencyResponse(response) {
      currencyResponse = response;
    },
    setCoins(amount) {
      user.coins.amount = amount;
      for (const callback of currencyObservers.values()) callback();
    },
  };
}

function descendants(element, predicate) {
  return element.children
    .flatMap((child) => [child, ...descendants(child, predicate)])
    .filter(predicate);
}

function text(element) {
  return element.textContent + element.children.map(text).join(" ");
}

module.exports = { loadBulkBuyHarness, FakeElement, observable, descendants, text };
