/**
 * `LabelControl`: minimal UTControl-style `<label>` with `setText`; the building block of the
 * label-with-* controls in this folder.
 *
 * Invariants:
 * - Old-style constructor: `LabelControlImpl` calls `UTControl.call(this)` but its prototype is
 *   not linked to `UTControl` (no `JSUtils.inherits`), so only the methods defined here exist
 *   (no `init`, no `addTarget`). Rewriting it as `class extends UTControl` would change behavior.
 * - Callers use `getRootElement()` right after `new`, relying on the `UTControl` constructor to
 *   run `this._generate()`; `_generate` is guarded by `this.generated`.
 * - `LabelControl` is the exported alias kept from the original bundle.
 */
import { removeFromParentNode } from "../../core/dom.js";

const LabelControlImpl = function () {
  UTControl.call(this);
};

LabelControlImpl.prototype._generate = function () {
  if (!this.generated) {
    this._label = document.createElement("label");
    this.__root = this._label;
    this.generated = true;
  }
};

LabelControlImpl.prototype.setText = function (labelText) {
  this._label.textContent = labelText;
};

LabelControlImpl.prototype.destroyGeneratedElements = function () {
  removeFromParentNode(this.__root);
  this.__root = null;
};

LabelControlImpl.prototype.getRootElement = function () {
  return this.__root;
};

export const LabelControl = LabelControlImpl;
