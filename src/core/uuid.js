/**
 * `generateUuid()` returns the page window's `crypto.randomUUID()` when available, otherwise a
 * version-4-shaped string built from `Date`, `performance.now()` and `Math.random()`. Used by
 * the XHR request events plugin (`xhr.id`) and the SBC template builder (ids of new and
 * duplicated global templates and of item search views).
 */
import { getPageWindow } from "./page-window.js";

export function generateUuid() {
  if (getPageWindow().crypto.randomUUID) {
    return getPageWindow().crypto.randomUUID();
  }
  var time = new Date().getTime();
  var performanceTime =
    (typeof performance !== "undefined" && performance.now && 1000 * performance.now()) || 0;
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (placeholderChar) {
    var randomNibble = 16 * Math.random();
    if (time > 0) {
      randomNibble = ((time + randomNibble) % 16) | 0;
      time = Math.floor(time / 16);
    } else {
      randomNibble = ((performanceTime + randomNibble) % 16) | 0;
      performanceTime = Math.floor(performanceTime / 16);
    }
    return (placeholderChar === "x" ? randomNibble : (3 & randomNibble) | 8).toString(16);
  });
}
