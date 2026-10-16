/**
 * `ItemValueDisplay`: `div.item-value-container` with a caption (`.caption`, hidden until set)
 * and a value (`.item-value > .value`), shown on items for prices and grading scores
 * (src/webapp/patches.js, grading score, external market prices).
 *
 * Invariants:
 * - The class names are styled by src/styles/paletools.css.
 * - `setValue` stores the raw value and shows it through `formatNumber`; the constructor's value
 *   is shown unformatted and `getValue()` returns undefined until `setValue` is called.
 * - `setCaption` reveals the caption hidden with `hideElements`.
 *
 * Known issues (kept as-is):
 * - `setStyles(..., {display: "block !important"})` assigns `style.display`, which rejects values
 *   with `!important`, so it has no effect.
 */
import { appendElements, createElement, setStyles } from "../../core/dom.js";
import { formatNumber } from "../../i18n/translations.js";
import { hideElements, showElements } from "../visibility.js";

export class ItemValueDisplay {
  #v;
  #w;
  #T;
  #C;
  #A;
  constructor(initialValue, extraClassName = "") {
    this.#v = createElement("div", {
      className: "item-value-container " + extraClassName,
    });
    setStyles(this.#v, {
      display: "block !important",
    });
    this.#C = createElement("div", {
      className: "caption",
    });
    const itemValueElement = createElement("div", {
      className: "item-value",
    });
    this.#T = createElement("div", {
      className: "value",
    });
    this.#T.textContent = initialValue;
    appendElements(itemValueElement, this.#T);
    appendElements(this.#v, this.#C, itemValueElement);
    hideElements(this.#C);
  }
  ["setCaption"](caption) {
    showElements(this.#C);
    this.#C.textContent = caption;
  }
  ["setValue"](newValue) {
    this.#A = newValue;
    this.#T.textContent = formatNumber(newValue);
  }
  ["getValue"]() {
    return this.#A;
  }
  ["getRootElement"]() {
    return this.#v;
  }
}
