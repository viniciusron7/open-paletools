/**
 * Legacy snipe request queue, shared by the snipe plugin, src/webapp/patches.js (manual search,
 * compare price, find related and slot market-search taps clear it) and Player snipe (cleared
 * before each automated search).
 *
 * Invariants:
 * - `pendingSnipeRequests` holds `[onResult, goBack]` pairs consumed by the snipe result
 *   validator; `clearSnipeRequests` empties the shared array in place.
 * - `getPageWindow().paletools.goBackDelay;` is a no-op read kept for evaluation order; it needs
 *   src/core/page-window.js (which creates `paletools`) evaluated first.
 *
 * Known issues (kept as-is):
 * - `snipePendingShowControllerCallbacks` is never filled, so the snipe `_showController` branch
 *   never runs.
 */
import { debugLog } from "../../core/logger.js";
import { getPageWindow } from "../../core/page-window.js";

export const pendingSnipeRequests = [];

export function clearSnipeRequests() {
  pendingSnipeRequests.length = 0;
  debugLog("Snipe requests cleared");
}

getPageWindow().paletools.goBackDelay;

export const snipePendingShowControllerCallbacks = [];
