/**
 * `AutoSnipeView` (extends `EAView`): the Auto Snipe screen (added in 27.2.1). It embeds a
 * native `UTMarketSearchFiltersView` for the search filters, four `NumericSpinnerControl`
 * fields, Start/Stop buttons, a status line and the list of bought cards. Created by
 * `AutoSnipeViewController` (src/plugins/auto-snipe/controller.js).
 *
 * Invariants:
 * - `_generate` runs once (`generated`) and upserts the stylesheet `paletools-auto-snipe`
 *   (which also hides the filters' holographic toggle and button container).
 * - The embedded filters are driven by their own `UTBucketedItemSearchViewModel` (market search,
 *   PLAYER type, maxBuy preset from `configuration.plugins.autoSnipe.maxPrice`). Their events
 *   call the `UTMarketSearchFiltersViewController.prototype` handlers listed in `filterBindings`,
 *   plus `ePlayerNameChanged` and `eSearchCategoryChanged`, with `filterOwner`
 *   (`{ viewmodel, getView }`) as `this`, so the market-search-filters hooks run for them too.
 *   Reset resets the view model, filters and prices; the native Search button is hidden.
 * - Fields and limits: delay 1000..2 147 483 447 ms, maxSnipes and maxCards 1..MAX_SAFE_INTEGER,
 *   buyDelay 1000..2 147 483 447 ms; initial values from `configuration.plugins.autoSnipe`.
 * - `getOptions()` returns `null` for invalid input (maxBuy not a safe integer in
 *   200..14 999 000, minBuy above maxBuy, minBid above maxBid, or a field outside its limits);
 *   otherwise `{ filters, playerId, maxPrice, delayMs, maxSnipes, maxCards, buyDelayMs }`, where
 *   `filters` is a copy of the search criteria (arrays copied) and `playerId` is `maskedDefId`
 *   when positive.
 * - `setRunning(true)` disables Start, the filters fieldset (`disabled` and `inert`) and the
 *   fields (ending any press-and-hold repeat) and enables Stop; `setRunning(false)` reverses it.
 * - `addPurchase` prepends a large item view with the price paid; `destroyGeneratedElements`
 *   removes the click listeners, destroys the fields, item views and embedded filters, removes
 *   their targets and deallocs their view model.
 */
import { configuration } from "../../config/configuration.js";
import {
  accessAttribute,
  appendElements,
  createElement,
  prependElements,
  setStyles,
} from "../../core/dom.js";
import { listenForEvent, stopListeningForEvent } from "../../core/events.js";
import { translate } from "../../i18n/translations.js";
import { NumericSpinnerControl } from "../../ui/controls/numeric-spinner-control.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import autoSnipeCss from "./auto-snipe.css";

const translateAutoSnipeViewText = (translationKey) =>
  translate("plugins.autoSnipe." + translationKey);

const AutoSnipeViewImpl = function () {
  EAView.call(this);
  this.onStartClicked = new EAObservable();
  this.onStopClicked = new EAObservable();
};

JSUtils.inherits(AutoSnipeViewImpl, EAView);

AutoSnipeViewImpl.prototype._generate = function () {
  if (this.generated) {
    return;
  }
  upsertStylesheet("paletools-auto-snipe", autoSnipeCss);
  const autoSnipeSettings = configuration.plugins.autoSnipe;
  const root = createElement("div", {
    className: "ut-content auto-snipe-view",
  });
  const filterViewModel = new UTBucketedItemSearchViewModel();
  filterViewModel.searchFeature = ItemSearchFeature.MARKET;
  filterViewModel.defaultSearchCriteria.type = SearchType.PLAYER;
  const initialSearchCriteria = new UTSearchCriteriaDTO();
  initialSearchCriteria.type = SearchType.PLAYER;
  initialSearchCriteria.maxBuy = autoSnipeSettings.maxPrice;
  filterViewModel.updateSearchCriteria(initialSearchCriteria);
  const marketFilters = new UTMarketSearchFiltersView();
  marketFilters.init();
  marketFilters.initTabMenuComponent();
  marketFilters.setFilters(filterViewModel, false);
  marketFilters.toggleEvolutionStatusFilter(false);
  marketFilters.setMaxBuyNowPrice(autoSnipeSettings.maxPrice);
  const filterOwner = {
    viewmodel: filterViewModel,
    getView: () => marketFilters,
  };
  const filtersControllerPrototype = UTMarketSearchFiltersViewController.prototype;
  const filterBindings = [
    ["FILTER_CHANGE", "eFilterChanged"],
    ["MIN_BID_PRICE_CHANGE", "eMinBidPriceChanged"],
    ["MAX_BID_PRICE_CHANGE", "eMaxBidPriceChanged"],
    ["MIN_BUY_PRICE_CHANGE", "eMinBuyPriceChanged"],
    ["MAX_BUY_PRICE_CHANGE", "eMaxBuyPriceChanged"],
  ];
  filterBindings.forEach(([eventName, handlerName]) =>
    marketFilters.addTarget(
      filterOwner,
      filtersControllerPrototype[handlerName],
      UTMarketSearchFiltersView.Event[eventName],
    ),
  );
  marketFilters
    .getPlayerNameSearch()
    ?.addTarget(filterOwner, filtersControllerPrototype.ePlayerNameChanged, EventType.CHANGE);
  marketFilters.getTabMenuComponent().setActiveTab(filterViewModel.searchBucket);
  marketFilters
    .getTabMenuComponent()
    .addTarget(filterOwner, filtersControllerPrototype.eSearchCategoryChanged, EventType.TAP);
  marketFilters.addTarget(
    filterOwner,
    () => {
      filterViewModel.resetSearch();
      marketFilters.setFilters(filterViewModel, false);
      marketFilters.resetPrices();
    },
    UTMarketSearchFiltersView.Event.RESET,
  );
  accessAttribute(marketFilters._searchButton, "hidden", "hidden");
  const filterContainer = createElement("fieldset", {
    className: "auto-snipe-filters",
  });
  appendElements(filterContainer, marketFilters);
  appendElements(root, filterContainer);
  this.marketFilters = marketFilters;
  this.filterModel = filterViewModel;
  this.filterContainer = filterContainer;
  this.filterOwner = filterOwner;
  this.filterBindings = filterBindings;
  const controls = createElement("div", {
    className: "auto-snipe-controls",
  });
  appendElements(root, controls);
  const hint = createElement("p");
  hint.textContent = translateAutoSnipeViewText("hint");
  appendElements(controls, hint);
  const numericFieldsContainer = createElement("div", {
    className: "auto-snipe-numeric-fields",
  });
  appendElements(controls, numericFieldsContainer);
  const numericFields = [];
  function createNumericField(labelKey, minValue, maxValue, initialValue) {
    const label = createElement("label");
    label.textContent = translateAutoSnipeViewText(labelKey);
    setStyles(label, {
      display: "block",
    });
    const spinner = new NumericSpinnerControl();
    spinner.init();
    spinner.setLimits(minValue, maxValue);
    spinner.setValue(initialValue);
    appendElements(label, spinner);
    appendElements(numericFieldsContainer, label);
    numericFields.push(spinner);
    return spinner;
  }
  const delayField = createNumericField("delay", 1000, 2147483447, autoSnipeSettings.delayMs);
  const maxSnipesField = createNumericField(
    "maxSnipes",
    1,
    Number.MAX_SAFE_INTEGER,
    autoSnipeSettings.maxSnipes,
  );
  const maxCardsField = createNumericField(
    "maxCards",
    1,
    Number.MAX_SAFE_INTEGER,
    autoSnipeSettings.maxCards,
  );
  const buyDelayField = createNumericField(
    "buyDelay",
    1000,
    2147483447,
    autoSnipeSettings.buyDelayMs,
  );
  this.numericFields = numericFields;
  const status = createElement("p", {
    role: "status",
  });
  appendElements(controls, status);
  const startButton = createElement("button", {
    className: "btn-standard",
  });
  startButton.textContent = translateAutoSnipeViewText("start");
  const buttons = createElement("div", {
    className: "auto-snipe-buttons",
  });
  appendElements(controls, buttons);
  const stopButton = createElement("button", {
    className: "btn-standard",
  });
  stopButton.textContent = translateAutoSnipeViewText("stop");
  stopButton.disabled = true;
  this.stopClickHandler = () => this.onStopClicked.notify();
  listenForEvent(stopButton, "click", this.stopClickHandler);
  appendElements(buttons, startButton, stopButton);
  this.startClickHandler = () => this.onStartClicked.notify();
  listenForEvent(startButton, "click", this.startClickHandler);
  const purchases = createElement("section", {
    className: "auto-snipe-purchases",
  });
  const purchasesTitle = createElement("h2");
  purchasesTitle.textContent = translateAutoSnipeViewText("purchases");
  const purchaseList = createElement("div", {
    className: "auto-snipe-purchase-list",
    "aria-live": "polite",
  });
  appendElements(purchases, purchasesTitle, purchaseList);
  appendElements(controls, purchases);
  this.itemViews = [];
  this.inputs = {
    delay: delayField,
    limit: maxSnipesField,
    cards: maxCardsField,
    buyDelay: buyDelayField,
    start: startButton,
    stop: stopButton,
    status: status,
    purchaseList: purchaseList,
  };
  this.__root = root;
  this.generated = true;
};

AutoSnipeViewImpl.prototype.getOptions = function () {
  const {
    delay: delayField,
    limit: maxSnipesField,
    cards: maxCardsField,
    buyDelay: buyDelayField,
  } = this.inputs;
  const filters = Object.fromEntries(
    Object.entries(this.filterModel.searchCriteria).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value,
    ]),
  );
  const maxPrice = Number(filters.maxBuy);
  return !Number.isSafeInteger(maxPrice) ||
    maxPrice < 200 ||
    maxPrice > 14999000 ||
    (filters.minBuy > 0 && filters.minBuy > maxPrice) ||
    (filters.minBid > 0 && filters.maxBid > 0 && filters.minBid > filters.maxBid) ||
    !this.numericFields.every((field) => {
      const value = Number(field.getValue());
      return (
        Number.isSafeInteger(value) && value >= field.getMinValue() && value <= field.getMaxValue()
      );
    })
    ? null
    : {
        filters: filters,
        playerId: filters.maskedDefId > 0 ? Number(filters.maskedDefId) : undefined,
        maxPrice: maxPrice,
        delayMs: Number(delayField.getValue()),
        maxSnipes: Number(maxSnipesField.getValue()),
        maxCards: Number(maxCardsField.getValue()),
        buyDelayMs: Number(buyDelayField.getValue()),
      };
};

AutoSnipeViewImpl.prototype.addPurchase = function ({ item, price }) {
  const purchase = createElement("article", {
    className: "auto-snipe-purchase",
  });
  const itemView = UTItemViewFactory.createLargeItem(item);
  if (itemView) {
    itemView.init();
    itemView.render(item);
    this.itemViews.push(itemView);
    appendElements(purchase, itemView);
  }
  const paidPrice = createElement("p", {
    className: "auto-snipe-paid-price",
  });
  paidPrice.textContent =
    translateAutoSnipeViewText("paidPrice") + ": " + services.Localization.localizeNumber(price);
  appendElements(purchase, paidPrice);
  prependElements(this.inputs.purchaseList, purchase);
};

AutoSnipeViewImpl.prototype.setStatus = function (statusText) {
  this.inputs.status.textContent = statusText;
};

AutoSnipeViewImpl.prototype.setRunning = function (isRunning) {
  const { start: startButton, stop: stopButton } = this.inputs;
  startButton.disabled = isRunning;
  this.filterContainer.disabled = isRunning;
  this.filterContainer.inert = isRunning;
  this.numericFields.forEach((field) => {
    field.endIncrease();
    field.endDecrease();
    field.setInteractionState(!isRunning);
  });
  stopButton.disabled = !isRunning;
};

AutoSnipeViewImpl.prototype.destroyGeneratedElements = function () {
  if (this.inputs) {
    stopListeningForEvent(this.inputs.start, "click", this.startClickHandler);
    stopListeningForEvent(this.inputs.stop, "click", this.stopClickHandler);
  }
  this.numericFields?.forEach((field) => {
    field.endIncrease();
    field.endDecrease();
    field.destroy();
  });
  this.numericFields = [];
  this.itemViews?.forEach((itemView) => itemView.destroy());
  this.itemViews = [];
  if (this.marketFilters) {
    const filtersControllerPrototype = UTMarketSearchFiltersViewController.prototype;
    this.filterBindings.forEach(([eventName, handlerName]) =>
      this.marketFilters.removeTarget(
        this.filterOwner,
        filtersControllerPrototype[handlerName],
        UTMarketSearchFiltersView.Event[eventName],
      ),
    );
    this.marketFilters
      .getPlayerNameSearch()
      ?.removeTarget(
        this.filterOwner,
        filtersControllerPrototype.ePlayerNameChanged,
        EventType.CHANGE,
      );
    this.marketFilters
      .getTabMenuComponent()
      .removeTarget(
        this.filterOwner,
        filtersControllerPrototype.eSearchCategoryChanged,
        EventType.TAP,
      );
    this.marketFilters.destroy();
    this.filterModel.dealloc();
    this.marketFilters = null;
  }
  EAView.prototype.destroyGeneratedElements.call(this);
};

export const AutoSnipeView = AutoSnipeViewImpl;
