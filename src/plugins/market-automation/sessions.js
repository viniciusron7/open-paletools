/**
 * Owns the Player snipe and Bulk buy state and their orchestration: dialogs, session start and
 * cleanup, the bulk-buy purchase and button availability. Imported by player-snipe/index.js and
 * bulk-buy/index.js, which only read the state and call the exported entry points.
 *
 * Invariants:
 * - State ownership: `activePlayerSnipeSession`, `playerSnipeConfirmation`,
 *   `activeBulkBuySession` and `bulkBuyConfirmation` are `export let` bindings, read-only for
 *   importers, so every function that assigns them must stay in this module; one owner gives both
 *   automations one consistent state to check.
 * - Mutual exclusion: at most one of the four is set. Both dialogs refuse while any is set;
 *   `startPlayerSnipe` refuses an active session or an open bulk dialog; `startBulkBuy` refuses
 *   when Paletools is disabled or any is set; Run re-checks after the balance refresh;
 *   `buyBulkBuyOffer` throws if a snipe became active. Every change refreshes both button sets
 *   (`refreshBulkBuyButtons`, `refreshPlayerSnipeButton` on `playerSnipeViews`).
 * - Snipe confirmation shows player and maximum; Confirm closes the dialog, then requires the
 *   same visible controller, selection id and maximum and a valid Player ID filter
 *   (`validatePlayerSnipeFilterIdentity`) before `startPlayerSnipe`.
 * - Snipe session: criteria snapshot with `maskedDefId = Number(player.id)`; `nextPrice` is
 *   `UTCurrencyInputControl.getIncrementAboveVal`; all pauses go through `beforeAction`
 *   (`waitForPlayerSnipe(nextDelay(action))`, the runner `wait` is a no-op) with one
 *   `createPlayerSnipeTiming()` per session. Cleanup calls `restoreNotificationQueue()`, removes
 *   the panel and clears the session only if it is still current.
 * - Bulk dialog: OVR / max price / quantity rows ('+' adds, the last row stays);
 *   `validateBulkBuyPlan` re-runs on input and on `AppNotification.USER_CURRENCY_UPDATE`
 *   (observer removed in `close()`). Run: validate, refresh coins
 *   (`services.User.requestCurrencies()`, aborted by Back/Escape), re-check exclusion, validate
 *   again, `close()` (must clear `bulkBuyConfirmation` first), then `startBulkBuy(plan)`
 *   validates once more.
 * - `startBulkBuy`: auction key `String(tradeId)`; one summary panel at a time
 *   (`lastBulkBuyPanel`); Stop stops the run, then 'Close' removes the panel.
 * - `buyBulkBuyOffer` returns `{ success: false }` (skipped, not counted) when aborted before
 *   sending, no longer `isBulkBuyCandidate` or `isBulkBuyAuctionUnavailable`; it throws when the
 *   price is not below the current coins. The `services.Item.bid` request is observed without the
 *   abort signal, so a sent purchase settles and is counted; success marks `ItemPile.PURCHASED`
 *   dirty.
 * - Dialogs stop keydown propagation (the snipe plugin's document.body shortcuts stay quiet) and
 *   turn Escape into `close()`; dialogs and bulk panel reuse player-snipe.css classes
 *   (`paletools-player-snipe-confirmation`, `paletools-player-snipe-status`,
 *   `player-snipe-actions`).
 * - tests/support/market-automation-sources.cjs lists the modules that the tests evaluate in one
 *   scope (via tests/support/load-sources.cjs); the integration tests reassign
 *   `startPlayerSnipe`/`startBulkBuy` (keep them function declarations called by name) and find
 *   buttons by the texts Confirm, Back, Run and '+'.
 */
import { configuration } from "../../config/configuration.js";
import { formatNumber } from "../../i18n/translations.js";
import { createBulkBuyRunner, validateBulkBuyPlan } from "../bulk-buy/core.js";
import {
  getBulkBuyCoins,
  isBulkBuyAuctionUnavailable,
  isBulkBuyCandidate,
  searchBulkBuyMarket,
} from "../bulk-buy/market.js";
import { renderBulkBuyStatus } from "../bulk-buy/status-panel.js";
import {
  observePlayerSnipeRequest,
  validatePlayerSnipeResponse,
  waitForPlayerSnipe,
} from "./requests.js";
import { createPlayerSnipeRunner, createPlayerSnipeTiming } from "../player-snipe/core.js";
import {
  buyPlayerSnipeOffer,
  returnToPlayerSnipeFilters,
  searchPlayerSnipeMarket,
  validatePlayerSnipeFilterIdentity,
} from "../player-snipe/market.js";
import { getPlayerSnipeMaximum, getPlayerSnipeSelection } from "../player-snipe/selection.js";
import { createPlayerSnipeStatus } from "../player-snipe/status-panel.js";
import {
  showErrorNotification,
  showNeutralNotification,
  showSuccessNotification,
} from "../../ui/notifications.js";
import { getActiveController, getViewModel } from "../../webapp/navigation.js";
import { restoreNotificationQueue } from "../../webapp/patches.js";

export let activePlayerSnipeSession = null;

export let playerSnipeConfirmation = null;

export const playerSnipeViews = new Set();

export let activeBulkBuySession = null;

export let bulkBuyConfirmation = null;

export const bulkBuyViews = new Set();

let lastBulkBuyPanel = null;

export function refreshPlayerSnipeButton(view) {
  const button = view._playerSnipeButton;
  if (!button) {
    return;
  }
  let controller;
  try {
    controller = getActiveController();
  } catch {
    return;
  }
  const available =
    controller instanceof UTMarketSearchFiltersViewController &&
    controller.getView() === view &&
    getPlayerSnipeSelection(view, controller) &&
    getPlayerSnipeMaximum(view) &&
    !activePlayerSnipeSession &&
    !playerSnipeConfirmation &&
    !activeBulkBuySession &&
    !bulkBuyConfirmation;
  button.setInteractionState(Boolean(available));
  button.getRootElement().title = "Select a player and fill in Buy Now Price Max to snipe.";
}

function startPlayerSnipe(controller, view, player, maxBuy) {
  if (activePlayerSnipeSession || activeBulkBuySession || bulkBuyConfirmation) {
    return;
  }
  const model = getViewModel(controller);
  const session = {
    controller,
    view,
    player,
    maxBuy,
    navigation: controller.getNavigationController(),
    criteria: {
      ...model.searchCriteria,
      maskedDefId: Number(player.id),
    },
    pendingSearch: null,
    triggeringSearch: false,
    phase: "idle",
    nextDelay: createPlayerSnipeTiming(),
  };
  session.runner = createPlayerSnipeRunner({
    maxBuy,
    nextPrice: (price) => UTCurrencyInputControl.getIncrementAboveVal(price),
    search: (prices, signal) => searchPlayerSnipeMarket(session, prices, signal),
    buy: (item, signal) => buyPlayerSnipeOffer(session, item, signal),
    returnToFilters: (signal) => returnToPlayerSnipeFilters(session, signal),
    wait: async () => {},
    beforeAction: (action, signal) => waitForPlayerSnipe(session.nextDelay(action), signal),
    onStatus: ({ phase, prices, attempts }) => {
      session.phase = phase;
      const label =
        phase === "buying"
          ? "Buying"
          : phase === "stopping"
            ? "Stopping; waiting for the current operation"
            : "Sniping";
      session.status.textContent =
        `${label}: ${player.name}. Search ${attempts}. ` +
        `Bid Price Min: ${formatNumber(prices.minBid)} · ` +
        `Buy Now Price Min: ${formatNumber(prices.minBuy)} · ` +
        `Buy Now Price Max: ${formatNumber(maxBuy)}`;
      session.stopButton.disabled = phase === "stopping";
    },
  });
  activePlayerSnipeSession = session;
  refreshBulkBuyButtons();
  createPlayerSnipeStatus(session);
  for (const filterView of playerSnipeViews) {
    refreshPlayerSnipeButton(filterView);
  }
  session.runner
    .start()
    .then((result) => {
      if (result.reason === "bought") {
        showSuccessNotification(
          `${player.name}: player bought for ` +
            `${formatNumber(result.item.getAuctionData().buyNowPrice)} coins.`,
        );
      } else if (result.reason === "error") {
        showErrorNotification(result.error.message);
      } else {
        showNeutralNotification("Sniping stopped.");
      }
    })
    .finally(() => {
      restoreNotificationQueue();
      session.panel.remove();
      if (activePlayerSnipeSession === session) {
        activePlayerSnipeSession = null;
      }
      refreshBulkBuyButtons();
      for (const filterView of playerSnipeViews) {
        refreshPlayerSnipeButton(filterView);
      }
    });
}

export function confirmPlayerSnipe(view) {
  if (
    playerSnipeConfirmation ||
    activePlayerSnipeSession ||
    activeBulkBuySession ||
    bulkBuyConfirmation
  ) {
    return;
  }
  const controller = getActiveController();
  if (!(controller instanceof UTMarketSearchFiltersViewController)) {
    return;
  }
  const player = getPlayerSnipeSelection(view, controller);
  const maxBuy = getPlayerSnipeMaximum(view);
  if (!player || !maxBuy) {
    return showErrorNotification("Select a player and enter a valid Buy Now Price Max.");
  }
  try {
    validatePlayerSnipeFilterIdentity(view, controller, player);
  } catch (error) {
    return showErrorNotification(error.message);
  }
  const dialog = document.createElement("dialog");
  dialog.className = "paletools-player-snipe-confirmation";
  dialog.setAttribute("aria-labelledby", "paletools-player-snipe-title");
  const title = document.createElement("h2");
  title.id = "paletools-player-snipe-title";
  title.textContent = "Snipe Player";
  const playerText = document.createElement("p");
  playerText.textContent = `Player: ${player.name}`;
  const maxPriceText = document.createElement("p");
  maxPriceText.textContent = `Buy Now Price Max: ${formatNumber(maxBuy)} coins`;
  const description = document.createElement("p");
  description.textContent =
    "When you confirm, the first active offer within this maximum will be bought automatically.";
  const actions = document.createElement("div");
  actions.className = "player-snipe-actions";
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.textContent = "Confirm";
  const back = document.createElement("button");
  back.type = "button";
  back.textContent = "Back";
  const close = () => {
    dialog.close();
    dialog.remove();
    playerSnipeConfirmation = null;
    refreshBulkBuyButtons();
    for (const filterView of playerSnipeViews) {
      refreshPlayerSnipeButton(filterView);
    }
    view._playerSnipeButton?.getRootElement().focus();
  };
  playerSnipeConfirmation = {
    close,
    view,
  };
  refreshBulkBuyButtons();
  confirm.addEventListener("click", () => {
    close();
    if (
      getActiveController() !== controller ||
      getPlayerSnipeSelection(view, controller)?.id !== player.id ||
      getPlayerSnipeMaximum(view) !== maxBuy
    ) {
      return showErrorNotification(
        "The selection or the price changed. Confirm the details again.",
      );
    }
    try {
      validatePlayerSnipeFilterIdentity(view, controller, player);
      startPlayerSnipe(controller, view, player, maxBuy);
    } catch (error) {
      showErrorNotification(error.message);
    }
  });
  back.addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  actions.append(confirm, back);
  dialog.append(title, playerText, maxPriceText, description, actions);
  document.body.append(dialog);
  dialog.showModal();
  back.focus();
  for (const filterView of playerSnipeViews) {
    refreshPlayerSnipeButton(filterView);
  }
}

async function buyBulkBuyOffer(session, row, item, signal) {
  if (signal.aborted) {
    return {
      success: false,
    };
  }
  if (activePlayerSnipeSession) {
    throw new Error("Stop sniping before running the bulk buy.");
  }
  if (!isBulkBuyCandidate(item, row)) {
    return {
      success: false,
    };
  }
  const price = item.getAuctionData().buyNowPrice;
  if (price >= getBulkBuyCoins()) {
    throw new Error(
      "The balance changed and no longer allows buying this offer while keeping the reserve.",
    );
  }
  // A submitted purchase must settle even after Stop, so count only its
  // confirmed result and keep observing the request without an abort signal.
  const response = await observePlayerSnipeRequest(services.Item.bid(item, price));
  if (isBulkBuyAuctionUnavailable(response)) {
    return {
      success: false,
    };
  }
  validatePlayerSnipeResponse(response, "buy the bulk buy offer");
  repositories.Item.setDirty(ItemPile.PURCHASED);
  return {
    success: true,
    price,
  };
}

export function refreshBulkBuyButtons() {
  const busy =
    activePlayerSnipeSession ||
    playerSnipeConfirmation ||
    activeBulkBuySession ||
    bulkBuyConfirmation;
  for (const view of bulkBuyViews) {
    view._bulkBuyButton?.setInteractionState(Boolean(configuration.enabled && !busy));
  }
}

function startBulkBuy(plan) {
  if (
    !configuration.enabled ||
    activeBulkBuySession ||
    activePlayerSnipeSession ||
    playerSnipeConfirmation ||
    bulkBuyConfirmation
  ) {
    return null;
  }
  const validated = validateBulkBuyPlan(plan.rows, getBulkBuyCoins());
  const session = {
    plan: validated,
    page: 0,
    nextDelay: createPlayerSnipeTiming(),
  };
  const panel = document.createElement("aside");
  panel.className = "paletools-player-snipe-status paletools-bulk-buy-status";
  const title = document.createElement("h2");
  title.textContent = "Bulk Buy";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const rows = document.createElement("ul");
  const stop = document.createElement("button");
  stop.type = "button";
  stop.textContent = "Stop";
  stop.setAttribute("aria-label", "Stop bulk buy");
  Object.assign(session, {
    panel,
    status,
    rows,
    stopButton: stop,
  });
  session.runner = createBulkBuyRunner({
    plan: validated,
    getCoins: getBulkBuyCoins,
    getAuctionKey: (item) => String(item.getAuctionData().tradeId),
    search: (row, request) => searchBulkBuyMarket(session, row, request),
    buy: (item, row, signal) => buyBulkBuyOffer(session, row, item, signal),
    wait: (signal, action) => waitForPlayerSnipe(session.nextDelay(action), signal),
    onStatus: (next) => renderBulkBuyStatus(session, next),
  });
  stop.addEventListener("click", () => {
    if (session.runner.running) {
      session.runner.stop();
    } else {
      panel.remove();
    }
  });
  panel.append(title, status, rows, stop);
  lastBulkBuyPanel?.remove();
  lastBulkBuyPanel = panel;
  document.body.append(panel);
  activeBulkBuySession = session;
  refreshBulkBuyButtons();
  for (const view of playerSnipeViews) {
    refreshPlayerSnipeButton(view);
  }
  session.task = session.runner
    .start()
    .then((result) => {
      renderBulkBuyStatus(session, {
        ...result,
        phase: result.reason,
      });
      if (result.reason === "error") {
        showErrorNotification(result.error.message);
      } else if (result.reason === "complete") {
        showSuccessNotification("Bulk buy complete.");
      } else if (result.reason === "unavailable") {
        showNeutralNotification(
          "Bulk buy finished with partial quantities: there are no more eligible offers.",
        );
      } else {
        showNeutralNotification("Bulk buy stopped.");
      }
      return result;
    })
    .finally(() => {
      if (activeBulkBuySession === session) {
        activeBulkBuySession = null;
      }
      stop.disabled = false;
      stop.textContent = "Close";
      stop.setAttribute("aria-label", "Close bulk buy summary");
      refreshBulkBuyButtons();
      for (const view of playerSnipeViews) {
        refreshPlayerSnipeButton(view);
      }
    });
  return session.task;
}

export function openBulkBuyDialog(view) {
  if (
    !configuration.enabled ||
    bulkBuyConfirmation ||
    activeBulkBuySession ||
    activePlayerSnipeSession ||
    playerSnipeConfirmation
  ) {
    return;
  }
  const controller = getActiveController();
  if (
    !(controller instanceof UTMarketSearchFiltersViewController) ||
    controller.getView() !== view
  ) {
    return;
  }
  const dialog = document.createElement("dialog");
  dialog.className = "paletools-player-snipe-confirmation paletools-bulk-buy-confirmation";
  dialog.setAttribute("aria-labelledby", "paletools-bulk-buy-title");
  const title = document.createElement("h2");
  title.id = "paletools-bulk-buy-title";
  title.textContent = "Bulk Buy";
  const description = document.createElement("p");
  description.textContent =
    "Set the exact OVR, the max price per player and the quantity. The combined max cost must be lower than the account balance.";
  const rowList = document.createElement("div");
  rowList.className = "bulk-buy-rows";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "bulk-buy-add";
  add.textContent = "+";
  add.setAttribute("aria-label", "Add another OVR");
  const coinsLabel = document.createElement("p");
  coinsLabel.className = "bulk-buy-coins";
  const total = document.createElement("p");
  total.className = "bulk-buy-total";
  total.setAttribute("aria-live", "polite");
  const error = document.createElement("p");
  error.className = "bulk-buy-error";
  error.setAttribute("role", "alert");
  const actions = document.createElement("div");
  actions.className = "player-snipe-actions";
  const execute = document.createElement("button");
  execute.type = "button";
  execute.className = "bulk-buy-execute";
  execute.textContent = "Run";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "bulk-buy-back";
  back.textContent = "Back";
  const abortController = new AbortController();
  const rows = [];
  let checking = false;
  let currencyDispatcher;
  const readRows = () =>
    rows.map((row) => ({
      ovr: Number(row.ovrInput.value),
      maxPrice: Number(row.maxPriceInput.value),
      quantity: Number(row.quantityInput.value),
    }));
  const update = () => {
    let sum = 0;
    for (const row of readRows()) {
      sum += row.maxPrice * row.quantity;
    }
    total.textContent = `Total max cost: ${Number.isSafeInteger(sum) && sum >= 0 ? formatNumber(sum) : "—"} coins`;
    try {
      const coins = getBulkBuyCoins();
      coinsLabel.textContent = `Account balance: ${formatNumber(coins)} coins`;
      validateBulkBuyPlan(readRows(), coins);
      error.textContent = "";
      execute.disabled = checking;
    } catch (failure) {
      error.textContent = failure.message;
      execute.disabled = true;
    }
    add.disabled = checking;
    for (const row of rows) {
      row.ovrInput.disabled = checking;
      row.maxPriceInput.disabled = checking;
      row.quantityInput.disabled = checking;
      row.removeButton.disabled = checking || rows.length === 1;
    }
  };
  const addRow = () => {
    if (checking) {
      return;
    }
    const rowElement = document.createElement("div");
    rowElement.className = "bulk-buy-row";
    const createNumberInput = (labelText, className, minimum, maximum, initialValue = "") => {
      const label = document.createElement("label");
      label.textContent = labelText;
      const field = document.createElement("input");
      field.type = "number";
      field.className = className;
      field.min = String(minimum);
      if (maximum !== undefined) {
        field.max = String(maximum);
      }
      field.step = "1";
      field.required = true;
      field.value = initialValue;
      field.addEventListener("input", update);
      field.addEventListener("change", update);
      label.append(field);
      rowElement.append(label);
      return field;
    };
    const ovrInput = createNumberInput("OVR", "bulk-buy-ovr", 1, 99);
    const maxPriceInput = createNumberInput(
      "Max price per player",
      "bulk-buy-max-price",
      200,
      14999000,
    );
    const quantityInput = createNumberInput("Quantity", "bulk-buy-quantity", 1, undefined, "1");
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "bulk-buy-remove";
    removeButton.textContent = "Remove";
    const row = {
      element: rowElement,
      ovrInput,
      maxPriceInput,
      quantityInput,
      removeButton,
    };
    removeButton.addEventListener("click", () => {
      if (checking || rows.length <= 1) {
        return;
      }
      rows.splice(rows.indexOf(row), 1);
      rowElement.remove();
      update();
    });
    rowElement.append(removeButton);
    rows.push(row);
    rowList.append(rowElement);
    update();
    return row;
  };
  const close = () => {
    abortController.abort();
    if (currencyDispatcher) {
      currencyDispatcher.removeObserver(AppNotification.USER_CURRENCY_UPDATE, state);
    }
    dialog.close();
    dialog.remove();
    if (bulkBuyConfirmation === state) {
      bulkBuyConfirmation = null;
    }
    refreshBulkBuyButtons();
    for (const filterView of playerSnipeViews) {
      refreshPlayerSnipeButton(filterView);
    }
    view._bulkBuyButton?.getRootElement().focus();
  };
  const state = {
    dialog,
    view,
    rows,
    addRow,
    update,
    close,
    execute,
    add,
    total,
    error,
    coinsLabel,
    back,
  };
  bulkBuyConfirmation = state;
  add.addEventListener("click", addRow);
  back.addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  execute.addEventListener("click", async () => {
    if (checking || activePlayerSnipeSession || activeBulkBuySession) {
      return;
    }
    let plan;
    try {
      plan = validateBulkBuyPlan(readRows(), getBulkBuyCoins());
      checking = true;
      execute.textContent = "Checking balance…";
      update();
      validatePlayerSnipeResponse(
        await observePlayerSnipeRequest(services.User.requestCurrencies(), abortController.signal),
        "refresh the coin balance",
      );
      if (abortController.signal.aborted || bulkBuyConfirmation !== state) {
        return;
      }
      if (!configuration.enabled || activePlayerSnipeSession || activeBulkBuySession) {
        throw new Error("Another operation is in progress. Wait and try again.");
      }
      plan = validateBulkBuyPlan(plan.rows, getBulkBuyCoins());
      close();
      try {
        startBulkBuy(plan);
      } catch (failure) {
        showErrorNotification(failure.message);
      }
    } catch (failure) {
      if (abortController.signal.aborted) {
        return;
      }
      checking = false;
      execute.textContent = "Run";
      update();
      error.textContent = failure.message;
    }
  });
  actions.append(execute, back);
  dialog.append(title, description, rowList, add, coinsLabel, total, error, actions);
  document.body.append(dialog);
  addRow();
  if (typeof getDefaultDispatcher === "function" && typeof AppNotification !== "undefined") {
    currencyDispatcher = getDefaultDispatcher();
    currencyDispatcher.addObserver(AppNotification.USER_CURRENCY_UPDATE, state, update);
  }
  refreshBulkBuyButtons();
  for (const filterView of playerSnipeViews) {
    refreshPlayerSnipeButton(filterView);
  }
  dialog.showModal();
  rows[0].ovrInput.focus();
}
