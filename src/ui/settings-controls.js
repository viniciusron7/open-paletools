/**
 * Builders for plugin settings menus: append a label + text input, label + toggle or label +
 * dropdown control to a container and return it. `translateLabel` translates a key and strips a
 * leading `*` marker. Used by nearly every plugin's `settings.menu`.
 *
 * Invariants:
 * - Labels are translation keys resolved with `translateLabel`.
 * - `appendToggle` sets the initial state with `toggle()` before assigning `onToggle`, so the
 *   callback is not called for the initial state; when the callback returns exactly `false` the
 *   toggle is flipped back with `toggle(false)` (no actions fired), which settings use to veto a
 *   change.
 * - `appendTextInput` wires the callback to keyup (it receives the input element);
 *   `appendTextInput` and `appendDropdown` ignore falsy initial values.
 */
import { appendElements } from "../core/dom.js";
import { translate } from "../i18n/translations.js";
import { LabelWithDropdownControl } from "./controls/label-with-dropdown-control.js";
import { LabelWithTextInputControl } from "./controls/label-with-text-input-control.js";
import { LabelWithToggleControl } from "./controls/label-with-toggle-control.js";

export function translateLabel(localeKey) {
  const translatedText = translate(localeKey);
  return translatedText.charAt(0) === "*" ? translatedText.substring(1) : translatedText;
}

export function appendTextInput(container, labelKey, onKeyUp, initialValue) {
  const textInputControl = new LabelWithTextInputControl();
  textInputControl.setLabel(translateLabel(labelKey));
  textInputControl.onKeyUp(onKeyUp);
  if (initialValue) {
    textInputControl.setInputValue(initialValue);
  }
  appendElements(container, textInputControl);
  return textInputControl;
}

export function appendToggle(container, labelKey, isInitiallyOn, onToggleChange, toggleId) {
  const toggleControl = new LabelWithToggleControl();
  toggleControl.setLabel(translateLabel(labelKey));
  if (toggleId) {
    toggleControl.setToggleId(toggleId);
  }
  if (isInitiallyOn) {
    toggleControl.toggle();
  }
  toggleControl.onToggle = (sender, eventType, eventData) => {
    if (onToggleChange && onToggleChange(eventData.toggleState) === false) {
      toggleControl.toggle(false);
    }
  };
  appendElements(container, toggleControl);
  return toggleControl;
}

export function appendDropdown(container, labelKey, dropdownOptions, selectedValue, onValueChange) {
  const dropdownControl = new LabelWithDropdownControl();
  dropdownControl.setLabel(translateLabel(labelKey));
  dropdownControl.setOptions(dropdownOptions);
  if (selectedValue) {
    dropdownControl.setValue(selectedValue);
  }
  if (onValueChange) {
    dropdownControl.onChange(onValueChange);
  }
  appendElements(container, dropdownControl);
  return dropdownControl;
}
