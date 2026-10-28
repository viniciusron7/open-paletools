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
  #S;
  #w;
  #C;
  #T;
  #A;
  constructor(initialValue, extraClassName = "") {
    this.#S = createElement("div", {
      className: "item-value-container " + extraClassName,
    });
    setStyles(this.#S, {
      display: "block !important",
    });
    this.#T = createElement("div", {
      className: "caption",
    });
    const itemValueElement = createElement("div", {
      className: "item-value",
    });
    this.#C = createElement("div", {
      className: "value",
    });
    this.#C.textContent = initialValue;
    appendElements(itemValueElement, this.#C);
    appendElements(this.#S, this.#T, itemValueElement);
    hideElements(this.#T);
  }
  ["setCaption"](caption) {
    showElements(this.#T);
    this.#T.textContent = caption;
  }
  ["setValue"](newValue) {
    this.#A = newValue;
    this.#C.textContent = formatNumber(newValue);
  }
  ["getValue"]() {
    return this.#A;
  }
  ["getRootElement"]() {
    return this.#S;
  }
}
