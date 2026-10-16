/**
 * `GridLayout`: div-based layout builder (container, `div.row` rows, column divs), each part
 * appended to its parent when created; used by the SBC builder enhancer and the SBC template
 * builder.
 *
 * Invariants:
 * - Column class by span: 1 `column`, 2 `double-column`, more than 2 `tripe-column`; `empty()`
 *   clears the container's innerHTML.
 * - Container attributes go through `createElement`, so falsy attribute values are dropped.
 *
 * Known issues (kept as-is):
 * - The span > 2 class is spelled `tripe-column` while src/styles/paletools.css defines
 *   `.triple-column`, so wide columns get no flex rule.
 */
import { appendElements, createElement } from "../../core/dom.js";

export class GridLayout {
  #k;
  constructor(parentContainer, attributes) {
    this.#k = createElement("div", attributes);
    appendElements(parentContainer, this.#k);
  }
  ["addRow"]() {
    return new GridLayoutRow(this.#k);
  }
  ["getRootElement"]() {
    return this.#k;
  }
  ["empty"]() {
    this.#k.innerHTML = "";
  }
}

class GridLayoutRow {
  #H;
  constructor(parentContainer) {
    this.#H = createElement("div", {
      className: "row",
    });
    appendElements(parentContainer, this.#H);
  }
  ["addColumn"](columnSpan = 1) {
    return new GridLayoutColumn(this.#H, columnSpan);
  }
  ["getRootElement"]() {
    return this.#H;
  }
}

class GridLayoutColumn {
  #W;
  constructor(parentContainer, columnSpan) {
    this.#W = createElement("div", {
      className: columnSpan > 2 ? "tripe-column" : columnSpan > 1 ? "double-column" : "column",
    });
    appendElements(parentContainer, this.#W);
  }
  ["getRootElement"]() {
    return this.#W;
  }
}
