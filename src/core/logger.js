/**
 * Debug logging. `debugLog` would prefix an ISO timestamp, write to the console and dispatch the
 * LOG Paletools event, but only when the constant `isDebugLoggingEnabled` is true; it is false,
 * so `debugLog` is a no-op. Used by the database stores, the snipe plugin and
 * src/bootstrap/boot.js.
 *
 * Invariants:
 * - At module evaluation it sets `getPageWindow().logMessages = []`, a page-global array that
 *   nothing in this code base writes to.
 * - Error paths that only call `debugLog` (e.g. the database init in src/bootstrap/boot.js) are
 *   silent.
 */
import { dispatchPaletoolsEvent, paletoolsEvents } from "./events.js";
import { getPageWindow } from "./page-window.js";

getPageWindow().logMessages = [];

const isDebugLoggingEnabled = false;

export function debugLog(message) {
  if (isDebugLoggingEnabled) {
    message = new Date().toISOString() + ": " + message;
    console.log(message);
    dispatchPaletoolsEvent(paletoolsEvents.LOG, message);
  }
}
