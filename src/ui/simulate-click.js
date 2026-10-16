/**
 * Simulates a click by dispatching bubbling, cancelable `mousedown` then `mouseup` MouseEvents
 * (with the page window as `view`); used by the snipe plugin's keyboard shortcuts to press EA
 * buttons.
 *
 * Invariants:
 * - No `click` event is dispatched.
 * - Returns false for a missing element, otherwise true; with `delay` and an element it
 *   returns a Promise of that result after `setTimeout(delay)`, but a missing element still
 *   returns a plain false (not a Promise) even with `delay`.
 */
import { getPageWindow } from "../core/page-window.js";

function dispatchMouseEvent(element, eventType) {
  if (!element) {
    return false;
  }
  const mouseEvent = new MouseEvent(eventType, {
    bubbles: true,
    cancelable: true,
    view: getPageWindow(),
  });
  element.dispatchEvent(mouseEvent);
  return true;
}

export function simulateClick(element, delay) {
  return (
    !!element &&
    (delay
      ? new Promise((resolve) => {
          setTimeout(() => {
            resolve(simulateClick(element));
          }, delay);
        })
      : (function (target) {
          return dispatchMouseEvent(target, "mousedown");
        })(element) &&
        (function (target) {
          return dispatchMouseEvent(target, "mouseup");
        })(element))
  );
}
