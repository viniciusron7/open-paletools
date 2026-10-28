/**
 * Builds EA-hub-style tile grids: `div.layout-hub.grid` holding tiles
 * `div.tile.col-<span>-<columns>` with a header `h1.tileHeader` and a `div.tileContent`; used by
 * the backup settings view.
 *
 * Invariants:
 * - `addTile()` renders and appends the tile root immediately and returns the fluent tile;
 *   `title()` and `content()` still work afterwards because they change elements already inside
 *   that root.
 *
 * Known issues (kept as-is):
 * - `span()` after `addTile()` has no effect: the `col-*` class is computed when the root is
 *   rendered (no caller uses `span()` today).
 */
import { addClasses, appendElements, createElement } from "../core/dom.js";

export class LayoutHubGrid {
  #P;
  #k = createElement("div", {
    className: "layout-hub grid",
  });
  constructor(columns) {
    this.#P = columns;
  }
  ["addClass"](className) {
    addClasses(this.#k, className);
  }
  ["addTile"]() {
    const tile = new LayoutHubTile(this.#P);
    appendElements(this.#k, tile.getRootElement());
    return tile;
  }
  ["getRootElement"]() {
    return this.#k;
  }
}

class LayoutHubTile {
  #I = createElement("h1", {
    className: "tileHeader",
  });
  #E = createElement("div", {
    className: "tileContent",
  });
  #x = 1;
  #_ = 1;
  constructor(columns = 1) {
    this.#_ = columns;
  }
  ["title"](titleText) {
    this.#I.textContent = titleText;
    return this;
  }
  ["span"](span) {
    this.#x = span;
    return this;
  }
  ["content"](...elements) {
    appendElements(this.#E, ...elements);
    return this;
  }
  ["getRootElement"]() {
    const root = createElement("div", {
      className: "tile col-" + this.#x + "-" + this.#_,
    });
    const header = createElement("header", {});
    appendElements(header, this.#I);
    appendElements(root, header, this.#E);
    return root;
  }
}
