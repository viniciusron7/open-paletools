/**
 * Show/hide helpers for DOM elements or EA views (resolved with `getDomElement`), for one target
 * or an iterable of them; used widely by plugins and patches.
 *
 * Invariants:
 * - `hideElements` sets an inline `display: none !important`; `showElements` only removes an
 *   inline `display` that contains `none`, so hiding done by CSS classes is not undone.
 * - Both return their input (undefined for a falsy input).
 */
import { isIterable } from "../core/collections.js";
import { getDomElement } from "../core/dom.js";

export function showElements(elementsOrViews) {
  if (elementsOrViews) {
    if (isIterable(elementsOrViews)) {
      for (let elementOrView of elementsOrViews) {
        showElement(elementOrView);
      }
    } else {
      showElement(elementsOrViews);
    }
    return elementsOrViews;
  }
  function showElement(elementOrView) {
    if ((elementOrView = getDomElement(elementOrView)).style.display.indexOf("none") > -1) {
      elementOrView.style.removeProperty("display");
    }
  }
}

export function hideElements(elementsOrViews) {
  if (elementsOrViews) {
    if (isIterable(elementsOrViews)) {
      for (let elementOrView of elementsOrViews) {
        hideElement(elementOrView);
      }
    } else {
      hideElement(elementsOrViews);
    }
    return elementsOrViews;
  }
  function hideElement(elementOrView) {
    getDomElement(elementOrView).style.setProperty("display", "none", "important");
  }
}
