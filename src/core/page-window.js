/**
 * `getPageWindow()` returns the page's own window (`unsafeWindow` when the userscript manager
 * grants it, otherwise `window`). Paletools events, page globals, IndexedDB detection and the
 * XHR interception all go through it.
 *
 * Invariants:
 * - At module evaluation it creates the page-global namespace `getPageWindow().paletools` if
 *   missing; this must happen before src/plugins/snipe/state.js (next in the manifest), which
 *   reads `getPageWindow().paletools.goBackDelay` when evaluated.
 * - The function is hoisted into the shared bundle scope, so earlier modules (events, logger)
 *   may call it; only the namespace assignment depends on the manifest order.
 */
export function getPageWindow() {
  return typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
}

getPageWindow().paletools ||= {};
