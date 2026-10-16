/**
 * `LabelWithTextInputAndDropdownControl`: `div.ut-label-with-text-input-and-dropdown` holding a
 * `LabelControl`, an EA `UTTextInputControl` and a `DropdownControl`, the input first unless
 * `inputFirst` is false; used by the what's-new settings.
 *
 * Invariants:
 * - `_inputFirst` is assigned BEFORE `UTControl.call(this)`, because `_generate`, run by that
 *   call, reads it; keep that order.
 * - Otherwise the same old-style pattern as src/ui/controls/label-control.js (no prototype
 *   inheritance from `UTControl`). Input listeners receive the input DOM element; the dropdown
 *   methods delegate to the inner `DropdownControl`, initialized in `_generate`.
 */
import { addClasses, removeFromParentNode } from "../../core/dom.js";
import { listenForEvent } from "../../core/events.js";
import { DropdownControl } from "./dropdown-control.js";
import { LabelControl } from "./label-control.js";

const LabelWithTextInputAndDropdownControlImpl = function (inputFirst = true) {
  this._inputFirst = inputFirst;
  UTControl.call(this);
};

LabelWithTextInputAndDropdownControlImpl.prototype._generate = function () {
  if (!this.generated) {
    const rootElement = document.createElement("div");
    addClasses(rootElement, "ut-label-with-text-input-and-dropdown");
    this._label = new LabelControl();
    this._input = new UTTextInputControl();
    this._dropdown = new DropdownControl();
    rootElement.appendChild(this._label.getRootElement());
    if (this._inputFirst) {
      rootElement.appendChild(this._input.getRootElement());
      rootElement.appendChild(this._dropdown.getRootElement());
    } else {
      rootElement.appendChild(this._dropdown.getRootElement());
      rootElement.appendChild(this._input.getRootElement());
    }
    this._dropdown.init();
    this.__root = rootElement;
    this.generated = true;
  }
};

LabelWithTextInputAndDropdownControlImpl.prototype.setLabelLocale = function (locale) {
  this._label.getRootElement().dataset.locale = locale;
};

LabelWithTextInputAndDropdownControlImpl.prototype.setLabel = function (labelText) {
  this._label.setText(labelText);
};

LabelWithTextInputAndDropdownControlImpl.prototype.onInputKeyDown = function (listener) {
  listenForEvent(this._input.getRootElement(), "keydown", function (event) {
    listener(this);
  });
};

LabelWithTextInputAndDropdownControlImpl.prototype.onInputKeyUp = function (listener) {
  listenForEvent(this._input.getRootElement(), "keyup", function (event) {
    listener(this);
  });
};

LabelWithTextInputAndDropdownControlImpl.prototype.onInputChange = function (listener) {
  listenForEvent(this._input.getRootElement(), "change", function (event) {
    listener(this);
  });
};

LabelWithTextInputAndDropdownControlImpl.prototype.setInputType = function (inputType) {
  this._input.setType(inputType);
};

LabelWithTextInputAndDropdownControlImpl.prototype.setInputValue = function (inputValue) {
  this._input.setValue(inputValue);
};

LabelWithTextInputAndDropdownControlImpl.prototype.getInputValue = function () {
  return this._input.getValue();
};

LabelWithTextInputAndDropdownControlImpl.prototype.setDropDownOptions = function (dropdownOptions) {
  this._dropdown.setOptions(dropdownOptions);
};

LabelWithTextInputAndDropdownControlImpl.prototype.setDropDownValue = function (selectedValue) {
  return this._dropdown.setValue(selectedValue);
};

LabelWithTextInputAndDropdownControlImpl.prototype.getDropDownValue = function () {
  return this._dropdown.getValue();
};

LabelWithTextInputAndDropdownControlImpl.prototype.onDropDownChange = function (handler) {
  return this._dropdown.onChange(handler);
};

LabelWithTextInputAndDropdownControlImpl.prototype.destroyGeneratedElements = function () {
  removeFromParentNode(this.__root);
  this.__root = null;
};

LabelWithTextInputAndDropdownControlImpl.prototype.getRootElement = function () {
  return this.__root;
};

export const LabelWithTextInputAndDropdownControl = LabelWithTextInputAndDropdownControlImpl;
