/**
 * `LabelWithToggleControl`: `div.ut-label-with-toggle` holding a `LabelControl` and an EA
 * `UTToggleControl`; used by `appendToggle`, wide mode and grid mode.
 *
 * Invariants:
 * - Same old-style pattern as src/ui/controls/label-control.js (no prototype inheritance from
 *   `UTControl`, `_generate` during construction, unused constructor argument).
 * - The toggle is `init()`ed in `_generate`; its TAP target `_onToggled` forwards
 *   `(sender, eventType, {toggleState})` to the instance property `onToggle` set by callers.
 * - `toggle()` flips the state and fires TAP actions with `{toggleState}`; `toggle(false)` flips
 *   it silently (used to revert a vetoed change).
 */
import { addClasses, removeFromParentNode } from "../../core/dom.js";
import { LabelControl } from "./label-control.js";

const LabelWithToggleControlImpl = function (unusedArgument1) {
  UTControl.call(this);
};

LabelWithToggleControlImpl.prototype._generate = function () {
  if (!this.generated) {
    const root = document.createElement("div");
    addClasses(root, "ut-label-with-toggle");
    this._label = new LabelControl();
    this._toggle = new UTToggleControl();
    root.appendChild(this._label.getRootElement());
    root.appendChild(this._toggle.getRootElement());
    this._toggle.init();
    this._toggle.addTarget(this, this._onToggled, EventType.TAP);
    this.__root = root;
    this.generated = true;
  }
};

LabelWithToggleControlImpl.prototype.setLabelLocale = function (locale) {
  this._label.getRootElement().dataset.locale = locale;
};

LabelWithToggleControlImpl.prototype.setLabel = function (labelText) {
  this._label.setText(labelText);
};

LabelWithToggleControlImpl.prototype.setToggleId = function (toggleId) {
  this._toggle.getRootElement().id = toggleId;
};

LabelWithToggleControlImpl.prototype.toggle = function (shouldTriggerActions) {
  if (shouldTriggerActions !== false) {
    shouldTriggerActions = true;
  }
  this._toggle.toggle();
  if (shouldTriggerActions) {
    this._toggle._triggerActions(EventType.TAP, {
      toggleState: this._toggle.getToggleState(),
    });
  }
};

LabelWithToggleControlImpl.prototype.getToggleState = function () {
  return this._toggle.getToggleState();
};

LabelWithToggleControlImpl.prototype.destroyGeneratedElements = function () {
  removeFromParentNode(this.__root);
  this.__root = null;
};

LabelWithToggleControlImpl.prototype._onToggled = function (sender, eventType, data) {
  if (this.onToggle) {
    this.onToggle(sender, eventType, data);
  }
};

LabelWithToggleControlImpl.prototype.getRootElement = function () {
  return this.__root;
};

export const LabelWithToggleControl = LabelWithToggleControlImpl;
