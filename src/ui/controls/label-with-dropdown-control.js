/**
 * `LabelWithDropdownControl`: `div.ut-label-with-dropdown` holding a `LabelControl` and a
 * `DropdownControl` (initialized in `_generate`); used by `appendDropdown` in
 * src/ui/settings-controls.js.
 *
 * Invariants:
 * - Same old-style pattern as src/ui/controls/label-control.js (no prototype inheritance from
 *   `UTControl`, `_generate` during construction, unused constructor argument).
 * - Options, value and change callbacks are delegated to the inner `DropdownControl` (string
 *   values; `setOptions` appends).
 * - The `ut-label-with-dropdown` class is styled by the settings view CSS.
 */
import { addClasses, removeFromParentNode } from "../../core/dom.js";
import { DropdownControl } from "./dropdown-control.js";
import { LabelControl } from "./label-control.js";

const LabelWithDropdownControlImpl = function (unusedArgument1) {
  UTControl.call(this);
};

LabelWithDropdownControlImpl.prototype._generate = function () {
  if (!this.generated) {
    const rootElement = document.createElement("div");
    addClasses(rootElement, "ut-label-with-dropdown");
    this._label = new LabelControl();
    this._dropdown = new DropdownControl();
    rootElement.appendChild(this._label.getRootElement());
    rootElement.appendChild(this._dropdown.getRootElement());
    this._dropdown.init();
    this.__root = rootElement;
    this.generated = true;
  }
};

LabelWithDropdownControlImpl.prototype.setLabelLocale = function (locale) {
  this._label.getRootElement().dataset.locale = locale;
};

LabelWithDropdownControlImpl.prototype.setLabel = function (labelText) {
  this._label.setText(labelText);
};

LabelWithDropdownControlImpl.prototype.setOptions = function (dropdownOptions) {
  this._dropdown.setOptions(dropdownOptions);
};

LabelWithDropdownControlImpl.prototype.setValue = function (selectedValue) {
  return this._dropdown.setValue(selectedValue);
};

LabelWithDropdownControlImpl.prototype.getValue = function () {
  return this._dropdown.getValue();
};

LabelWithDropdownControlImpl.prototype.onChange = function (handler) {
  return this._dropdown.onChange(handler);
};

LabelWithDropdownControlImpl.prototype.destroyGeneratedElements = function () {
  removeFromParentNode(this.__root);
  this.__root = null;
};

LabelWithDropdownControlImpl.prototype.getRootElement = function () {
  return this.__root;
};

export const LabelWithDropdownControl = LabelWithDropdownControlImpl;
