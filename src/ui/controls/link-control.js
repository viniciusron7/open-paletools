/**
 * `LinkControl`: UTControl-style `<a>` with `setText`/`setUrl`; used by `LabelWithLinkControl`.
 *
 * Invariants:
 * - Same old-style pattern as src/ui/controls/label-control.js: `UTControl.call(this)` without
 *   prototype inheritance, `_generate` (guarded by `generated`) runs during construction, and the
 *   constructor argument is unused. `LinkControl` is the exported alias.
 */
import { removeFromParentNode } from "../../core/dom.js";

const LinkControlImpl = function (unusedArgument1) {
  UTControl.call(this);
};

LinkControlImpl.prototype._generate = function () {
  if (!this.generated) {
    this._link = document.createElement("a");
    this.__root = this._link;
    this.generated = true;
  }
};

LinkControlImpl.prototype.setText = function (linkText) {
  this._link.textContent = linkText;
};

LinkControlImpl.prototype.setUrl = function (href) {
  this._link.href = href;
};

LinkControlImpl.prototype.destroyGeneratedElements = function () {
  removeFromParentNode(this.__root);
  this.__root = null;
};

LinkControlImpl.prototype.getRootElement = function () {
  return this.__root;
};

export const LinkControl = LinkControlImpl;
