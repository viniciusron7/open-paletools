/**
 * Paletools event bus, used by nearly every module: `listenForEvent`, `dispatchPaletoolsEvent`
 * and the name tables `paletoolsEvents` and `mobileEvents`. Events are DOM `CustomEvent`s
 * (bubbling, payload in `detail`) on the page window returned by `getPageWindow()`.
 *
 * Invariants:
 * - Names are namespaced by value in `namespaceEventName`: a `paletoolsEvents` value becomes
 *   'paletools:<value>', a `mobileEvents` value 'paletools-mobile:<value>', anything else is
 *   used as-is. Constants and raw strings ('appEnabled') are interchangeable and the values are
 *   the DOM event names, so changing one breaks the matching listeners or dispatchers.
 * - The `mobileEvents` events are never dispatched in this code; they come from outside the
 *   script (src/bootstrap/boot.js listens for BACK_BUTTON_PRESSED).
 * - `listenForEvent(name, listener, options)` listens on the page window; with an explicit
 *   target first it accepts an element, an EA view/control or an iterable of elements. 'click'
 *   becomes 'pointerdown' when `isPhone()`. `stopListeningForEvent` takes the same arguments and
 *   removes the listener with the same name mapping; both must stay in sync.
 * - `importModule.r(moduleExports)` is webpack's ES-module marker for module 723 (`__esModule`,
 *   `Symbol.toStringTag`), kept at the place the original bundle had it. Nothing reads module
 *   723's exports, so it has no visible effect, but it is part of the original evaluation.
 * - The name tables are `const`s initialized when this module is evaluated, early in the
 *   manifest; namespacing an event before that would hit the temporal dead zone.
 */
import { isIterable } from "./collections.js";
import { getDomElement } from "./dom.js";
import { getPageWindow } from "./page-window.js";

export function listenForEvent(target, eventName, listener, listenerOptions) {
  if (typeof target === "string") {
    listenerOptions = listener;
    listener = eventName;
    eventName = target;
    target = getPageWindow();
  }
  if ((eventName = namespaceEventName(eventName)) === "click" && isPhone()) {
    eventName = "pointerdown";
  }
  if (isIterable(getDomElement(target))) {
    for (let element of getDomElement(target)) {
      element.addEventListener(eventName, listener, listenerOptions);
    }
  } else {
    getDomElement(target).addEventListener(eventName, listener, listenerOptions);
  }
}

export function stopListeningForEvent(target, eventName, listener, listenerOptions) {
  if (typeof target === "string") {
    listenerOptions = listener;
    listener = eventName;
    eventName = target;
    target = getPageWindow();
  }
  if ((eventName = namespaceEventName(eventName)) === "click" && isPhone()) {
    eventName = "pointerdown";
  }
  if (isIterable(getDomElement(target))) {
    for (let element of getDomElement(target)) {
      element.removeEventListener(eventName, listener, listenerOptions);
    }
  } else {
    getDomElement(target).removeEventListener(eventName, listener, listenerOptions);
  }
}

export function dispatchPaletoolsEvent(eventName, detail) {
  eventName = namespaceEventName(eventName);
  getPageWindow().dispatchEvent(
    new CustomEvent(eventName, {
      bubbles: true,
      detail: detail,
    }),
  );
}

importModule.r(moduleExports);

function namespaceEventName(eventName) {
  return Object.values(paletoolsEvents).indexOf(eventName) > -1
    ? "paletools:" + eventName
    : Object.values(mobileEvents).indexOf(eventName) > -1
      ? "paletools-mobile:" + eventName
      : eventName;
}

export const paletoolsEvents = {
  APP_ENABLED: "appEnabled",
  APP_DISABLED: "appDisabled",
  APP_STARTED: "appStarted",
  CONFIGURATION_SAVED: "configurationSaved",
  CONFIGURATION_LOADED: "configurationLoaded",
  APP_LOADED: "appLoaded",
  SNIPE_SUCCESS: "snipeSuccess",
  SNIPE_FAILED: "snipeFailed",
  SNIPE_GOBACK: "snipeGoBack",
  SNIPE_EXECUTE: "snipeExecute",
  REQUEST_OPEN: "requestOpen",
  REQUEST_SEND: "requestSend",
  REQUEST_FINISHED: "requestFinished",
  REQUEST_ERROR: "requestError",
  REQUEST_PROGRESS: "requestProgress",
  LOG: "logMessage",
  ITEM_WON: "itemWon",
  ITEMS_WON: "itemsWon",
  ITEMS_SOLD: "itemsSold",
  ITEM_MOVED: "itemMoved",
  ITEM_DISCARDED: "itemDiscarded",
  SBC_SUBMITTED: "sbcSubmitted",
  CLUB_INDEX_LOADED: "clubIndexLoaded",
  TRANSACTIONS_RELOADED: "transactionsReindex",
  REQUEST_UNASSIGNED: "requestUnassigned",
  UNASSIGNED_ITEM_ADDED: "unassignedItemAdded",
  SMART_BUILDER_ENABLED: "smartBuilderEnabled",
  SBC_AUTO_SOLVER_ENABLED: "sbcAutoSolverEnabled",
  WEB_APP_LOADED: "webAppLoaded",
};

export const mobileEvents = {
  BACK_BUTTON_PRESSED: "backButtonPressed",
  COMMAND_EXECUTED: "commandExecuted",
};
