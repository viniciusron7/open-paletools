/**
 * `LabelWithLinkControl`: `div.ut-label-with-link` holding a `LabelControl` and a `LinkControl`;
 * used by the import-SBC settings for the export link.
 *
 * Invariants:
 * - Same old-style pattern as src/ui/controls/label-control.js (no prototype inheritance from
 *   `UTControl`, `_generate` during construction, unused constructor argument); the children
 *   created in `_generate` back `setLabel`, `setLinkText` and `setLinkUrl`.
 */
import { addClasses, removeFromParentNode } from "../../core/dom.js";
import { LabelControl } from "./label-control.js";
import { LinkControl } from "./link-control.js";

const LabelWithLinkControlImpl = function (unusedArgument1) {
  UTControl.call(this);
};

LabelWithLinkControlImpl.prototype._generate = function () {
  if (!this.generated) {
    const root = document.createElement("div");
    addClasses(root, "ut-label-with-link");
    this._label = new LabelControl();
    this._link = new LinkControl();
    root.appendChild(this._label.getRootElement());
    root.appendChild(this._link.getRootElement());
    this.__root = root;
    this.generated = true;
  }
};

LabelWithLinkControlImpl.prototype.setLabel = function (labelText) {
  this._label.setText(labelText);
};

LabelWithLinkControlImpl.prototype.setLinkText = function (linkText) {
  this._link.setText(linkText);
};

LabelWithLinkControlImpl.prototype.setLinkUrl = function (linkUrl) {
  this._link.setUrl(linkUrl);
};

LabelWithLinkControlImpl.prototype.destroyGeneratedElements = function () {
  removeFromParentNode(this.__root);
  this.__root = null;
};

LabelWithLinkControlImpl.prototype.getRootElement = function () {
  return this.__root;
};

export const LabelWithLinkControl = LabelWithLinkControlImpl;
