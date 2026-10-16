/**
 * `LabelWithTextInputControl`: `div.ut-label-with-text-input` holding a `LabelControl` and an EA
 * `UTTextInputControl`, with helpers for type, attributes, styles and keydown/keyup/change
 * listeners; used by `appendTextInput`, the SBC builder enhancer and the SBC template builder.
 *
 * Invariants:
 * - Same old-style pattern as src/ui/controls/label-control.js (no prototype inheritance from
 *   `UTControl`, `_generate` during construction); `init()` only initializes the inner input and
 *   `addTarget` is delegated to it.
 * - `onKeyDown`/`onKeyUp`/`onChange` listeners receive the input DOM element (the handler's
 *   `this`), not the control.
 *
 * Known issues (kept as-is):
 * - `setInputType` is defined twice; the later definition (`_input.setType`) replaces the one
 *   that set the root element's `type`.
 * - Both constructor parameters are unused (the default `"text"` has no effect).
 */
import { addClasses, removeFromParentNode, setStyles } from "../../core/dom.js";
import { listenForEvent } from "../../core/events.js";
import { LabelControl } from "./label-control.js";

const LabelWithTextInputControlImpl = function (unusedArgument1, unusedArgument2 = "text") {
  UTControl.call(this);
};

LabelWithTextInputControlImpl.prototype.setInputType = function (type) {
  this._input.getRootElement().type = type;
};

LabelWithTextInputControlImpl.prototype.setInputAttrs = function (attributes) {
  for (const attributeName of Object.keys(attributes)) {
    this._input.getRootElement().setAttribute(attributeName, attributes[attributeName]);
  }
};

LabelWithTextInputControlImpl.prototype._generate = function () {
  if (!this.generated) {
    const root = document.createElement("div");
    addClasses(root, "ut-label-with-text-input");
    this._label = new LabelControl();
    this._input = new UTTextInputControl();
    root.appendChild(this._label.getRootElement());
    root.appendChild(this._input.getRootElement());
    this._onInputChangeCallbacks = [];
    this.__root = root;
    this.generated = true;
  }
};

LabelWithTextInputControlImpl.prototype.init = function () {
  this._input.init();
};

LabelWithTextInputControlImpl.prototype.addTarget = function (target, handler, eventType) {
  this._input.addTarget(target, handler, eventType);
};

LabelWithTextInputControlImpl.prototype.setInputStyle = function (inputStyles) {
  setStyles(this._input, inputStyles);
};

LabelWithTextInputControlImpl.prototype.onKeyDown = function (listener) {
  listenForEvent(this._input.getRootElement(), "keydown", function (event) {
    listener(this);
  });
};

LabelWithTextInputControlImpl.prototype.onKeyUp = function (listener) {
  listenForEvent(this._input.getRootElement(), "keyup", function (event) {
    listener(this);
  });
};

LabelWithTextInputControlImpl.prototype.onChange = function (listener) {
  listenForEvent(this._input.getRootElement(), "change", function (event) {
    listener(this);
  });
};

LabelWithTextInputControlImpl.prototype.setLabelLocale = function (locale) {
  this._label.getRootElement().dataset.locale = locale;
};

LabelWithTextInputControlImpl.prototype.setLabel = function (labelText) {
  this._label.setText(labelText);
};

LabelWithTextInputControlImpl.prototype.setInputType = function (inputType) {
  this._input.setType(inputType);
};

LabelWithTextInputControlImpl.prototype.setInputValue = function (inputValue) {
  this._input.setValue(inputValue);
};

LabelWithTextInputControlImpl.prototype.getInputValue = function () {
  return this._input.getValue();
};

LabelWithTextInputControlImpl.prototype.destroyGeneratedElements = function () {
  removeFromParentNode(this.__root);
  this.__root = null;
};

LabelWithTextInputControlImpl.prototype.getRootElement = function () {
  return this.__root;
};

export const LabelWithTextInputControl = LabelWithTextInputControlImpl;
