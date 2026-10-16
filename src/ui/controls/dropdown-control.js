/**
 * `DropdownControl`: UTControl-style native `<select>` with `setOptions`/`addOption`,
 * `getValue`/`setValue`, `clear` and `onChange` callbacks; used by the label-with-dropdown
 * controls, the settings jump menu, filter SBCs, my packs and the SBC auto-solver dialog.
 *
 * Invariants:
 * - Same old-style pattern as src/ui/controls/label-control.js (no prototype inheritance from
 *   `UTControl`, `_generate` during construction): `init()` borrows `UTControl.prototype.init`,
 *   and `dealloc` wraps `_removeListenersByName` in try/catch.
 * - `_onChangeCallbacks` and the native `change` listener are created in `_generate`; callbacks
 *   receive `select.value` (a string).
 * - `setOptions` appends `{label, value}` options without clearing; call `clear()` first to
 *   replace them.
 */
import { removeFromParentNode } from "../../core/dom.js";

const DropdownControlImpl = function () {
  UTControl.call(this);
};

DropdownControlImpl.prototype._generate = function () {
  if (!this.generated) {
    this._select = document.createElement("select");
    this.__root = this._select;
    this._onChangeCallbacks = [];
    this._select.addEventListener("change", () => {
      for (let changeCallback of this._onChangeCallbacks) {
        changeCallback(this._select.value);
      }
    });
    this.generated = true;
  }
};

DropdownControlImpl.prototype.destroyGeneratedElements = function () {
  removeFromParentNode(this.__root);
  this.__root = null;
};

DropdownControlImpl.prototype.clear = function () {
  this._select.length = 0;
};

DropdownControlImpl.prototype.getValue = function () {
  return this._select.value;
};

DropdownControlImpl.prototype.setValue = function (selectedValue) {
  this._select.value = selectedValue;
};

DropdownControlImpl.prototype.onChange = function (handler) {
  this._onChangeCallbacks.push(handler);
};

DropdownControlImpl.prototype.init = function () {
  UTControl.prototype.init.call(this);
};

DropdownControlImpl.prototype.setOptions = function (dropdownOptions) {
  for (let option of dropdownOptions) {
    this.addOption(option.label, option.value);
  }
};

DropdownControlImpl.prototype.addOption = function (label, optionValue) {
  const optionElement = document.createElement("option");
  optionElement.value = optionValue;
  optionElement.text = label;
  this._select.appendChild(optionElement);
};

DropdownControlImpl.prototype.dealloc = function () {
  try {
    this._removeListenersByName(EventType.CHANGE);
  } catch {}
};

DropdownControlImpl.prototype.getRootElement = function () {
  return this.__root;
};

export const DropdownControl = DropdownControlImpl;
