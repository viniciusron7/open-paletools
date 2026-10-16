/**
 * `LabelWithKeyPressInputControl`: `div.ut-label-with-text-input-with-keypress` holding a
 * `LabelControl`, an EA `UTTextInputControl` and a clear icon (`i.fut_icon.icon_close`); captures
 * key codes for the snipe plugin's shortcut settings.
 *
 * Invariants:
 * - Same old-style pattern as src/ui/controls/label-control.js (no prototype inheritance from
 *   `UTControl`, `_generate` during construction, unused constructor argument).
 * - keydown is swallowed (preventDefault, stopPropagation, stopImmediatePropagation), so the key
 *   is never typed: listeners get `(inputElement, event.code, valueBeforeChange)` and write the
 *   new code themselves. The clear icon empties the input and calls listeners with
 *   `(UTTextInputControl, "", previousValue)`.
 *
 * Known issues (kept as-is):
 * - `addClearButton()` only stores `_addClearButton`, which nothing reads; the clear icon is
 *   always present.
 */
import { addClasses, removeFromParentNode } from "../../core/dom.js";
import { listenForEvent } from "../../core/events.js";
import { LabelControl } from "./label-control.js";

const LabelWithKeyPressInputControlImpl = function (unusedArgument1) {
  UTControl.call(this);
};

LabelWithKeyPressInputControlImpl.prototype._generate = function () {
  if (!this.generated) {
    const root = document.createElement("div");
    addClasses(root, "ut-label-with-text-input-with-keypress");
    this._label = new LabelControl();
    this._input = new UTTextInputControl();
    root.appendChild(this._label.getRootElement());
    root.appendChild(this._input.getRootElement());
    const clearIcon = document.createElement("i");
    clearIcon.classList.add("fut_icon");
    clearIcon.classList.add("icon_close");
    clearIcon.addEventListener("click", () => {
      const previousValue = this._input.getValue();
      this._input.setValue("");
      notifyInputChange(this._input, "", previousValue);
    });
    root.appendChild(clearIcon);
    this._onInputChangeCallbacks = [];
    let control = this;
    const notifyInputChange = (source, keyCode, inputValue) => {
      for (let listener of control._onInputChangeCallbacks) {
        listener(source, keyCode, inputValue);
      }
    };
    listenForEvent(this._input.getRootElement(), "keydown", function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      notifyInputChange(this, event.code, control._input.getValue());
      return false;
    });
    this.__root = root;
    this.generated = true;
  }
};

LabelWithKeyPressInputControlImpl.prototype.addClearButton = function (addClearButton) {
  this._addClearButton = addClearButton;
};

LabelWithKeyPressInputControlImpl.prototype.setLabelLocale = function (locale) {
  this._label.getRootElement().dataset.locale = locale;
};

LabelWithKeyPressInputControlImpl.prototype.setLabel = function (labelText) {
  this._label.setText(labelText);
};

LabelWithKeyPressInputControlImpl.prototype.setInputId = function (inputId) {
  this._input.getRootElement().id = inputId;
};

LabelWithKeyPressInputControlImpl.prototype.setInputValue = function (inputValue) {
  this._input.setValue(inputValue);
};

LabelWithKeyPressInputControlImpl.prototype.onInputChange = function (listener) {
  this._onInputChangeCallbacks.push(listener);
};

LabelWithKeyPressInputControlImpl.prototype.destroyGeneratedElements = function () {
  removeFromParentNode(this.__root);
  this.__root = null;
};

LabelWithKeyPressInputControlImpl.prototype.getRootElement = function () {
  return this.__root;
};

export const LabelWithKeyPressInputControl = LabelWithKeyPressInputControlImpl;
