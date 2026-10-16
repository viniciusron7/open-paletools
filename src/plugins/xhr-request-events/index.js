/**
 * XHR Request Events plugin (`xhrRequestEventsPlugin`), installed by the plugin list in
 * src/bootstrap/boot.js: instruments the page's XMLHttpRequest so the rest of Paletools can
 * observe Web App requests as Paletools events.
 *
 * Hooks:
 * - `run()` replaces `XMLHttpRequest.prototype.open` and `send` of the page window; both
 *   dispatch first, then call the original.
 *
 * Invariants:
 * - Events (namespaced `paletools:`, on the page window): `REQUEST_OPEN`
 *   `{xhr, method, url, async}`, `REQUEST_SEND` `{xhr, body}`, `REQUEST_FINISHED` `{xhr}` at
 *   `readyState === 4`, `REQUEST_ERROR` `{xhr}`. src/bootstrap/boot.js relies on
 *   `REQUEST_FINISHED` for the "SOFTBAN?" notification on HTTP 426/429/521.
 * - Every request gets `xhr.id = generateUuid()` in `open`.
 * - No settings and no enable check: always active. It has no `order`, so its position in the
 *   boot sort is not well-defined and depends on the JS engine.
 *
 * Known issues (kept as-is):
 * - `open` forwards only `(method, url, async)`: user/password are dropped, and a two-argument
 *   call reaches the original with an explicit `async` of `undefined` (converted to false).
 */
import { dispatchPaletoolsEvent, paletoolsEvents } from "../../core/events.js";
import { getPageWindow } from "../../core/page-window.js";
import { generateUuid } from "../../core/uuid.js";

let xhrRequestEventsPluginDefinition;

xhrRequestEventsPluginDefinition = {
  run: function () {
    const originalOpen = getPageWindow().XMLHttpRequest.prototype.open;
    getPageWindow().XMLHttpRequest.prototype.open = function (method, requestUrl, async) {
      this.id = generateUuid();
      const xhr = this;
      dispatchPaletoolsEvent(paletoolsEvents.REQUEST_OPEN, {
        xhr: xhr,
        method: method,
        url: requestUrl,
        async: async,
      });
      this.addEventListener(
        "readystatechange",
        function () {
          if (this.readyState === 4) {
            dispatchPaletoolsEvent(paletoolsEvents.REQUEST_FINISHED, {
              xhr: xhr,
            });
          }
        },
        false,
      );
      this.addEventListener("error", function () {
        dispatchPaletoolsEvent(paletoolsEvents.REQUEST_ERROR, {
          xhr: xhr,
        });
      });
      originalOpen.call(this, method, requestUrl, async);
    };
    const originalSend = getPageWindow().XMLHttpRequest.prototype.send;
    getPageWindow().XMLHttpRequest.prototype.send = function (body) {
      dispatchPaletoolsEvent(paletoolsEvents.REQUEST_SEND, {
        xhr: this,
        body: body,
      });
      originalSend.call(this, body);
    };
  },
};

export const xhrRequestEventsPlugin = xhrRequestEventsPluginDefinition;
