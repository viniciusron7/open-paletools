/**
 * Registry of custom keyboard shortcuts (plugin actions bound to a `KeyboardEvent.code`), filled
 * by plugins with `registerKeyboardShortcut`, edited in the snipe settings with
 * `reassignKeyboardShortcut` and listed by the keyboard-shortcut-hints plugin; the snipe plugin's
 * keydown handler reads `keyboardShortcutsByKeyCode` directly.
 *
 * Invariants:
 * - Entries are `{name, locale, action, getKeyCode, setKeyCode, cssSelector}` bucketed by key
 *   code; shortcuts without a key live under the sentinel `__not_set__` (`isUnassignedShortcut`).
 * - `registerKeyboardShortcut` is a no-op on phones (`isPhone()`) and de-duplicates by name
 *   within the key bucket, so hooks may call it repeatedly.
 * - `reassignKeyboardShortcut` moves the entry to the new bucket (an empty key means the
 *   sentinel), persists it with `setKeyCode(newKey)` and deletes emptied buckets.
 * - `isSearchFilterDropdownOpen` (`.inline-list-select.ut-search-filter-control.is-open`) lets
 *   shortcut handlers ignore keys while a filter list is open.
 */
import { queryElement } from "../core/dom.js";

export const keyboardShortcutsByKeyCode = {};

const unassignedShortcutKey = "__not_set__";

export function isUnassignedShortcut(keyCode) {
  return keyCode === unassignedShortcutKey;
}

export function registerKeyboardShortcut(
  shortcutName,
  getKeyCode,
  setKeyCode,
  localeKey,
  action,
  cssSelector,
) {
  if (isPhone()) {
    return;
  }
  const keyCode = getKeyCode() || unassignedShortcutKey;
  if (!keyboardShortcutsByKeyCode[keyCode]) {
    keyboardShortcutsByKeyCode[keyCode] = [];
  }
  if (!keyboardShortcutsByKeyCode[keyCode].find((shortcut) => shortcut.name === shortcutName)) {
    keyboardShortcutsByKeyCode[keyCode].push({
      name: shortcutName,
      locale: localeKey,
      action: action,
      getKeyCode: getKeyCode,
      setKeyCode: setKeyCode,
      cssSelector: cssSelector,
    });
  }
}

export function reassignKeyboardShortcut(oldKeyCode, shortcutName, newKeyCode) {
  if (
    (oldKeyCode = oldKeyCode || unassignedShortcutKey) ===
    (newKeyCode = newKeyCode || unassignedShortcutKey)
  ) {
    return;
  }
  let shortcutsForOldKey = keyboardShortcutsByKeyCode[oldKeyCode];
  if (shortcutsForOldKey) {
    for (let index = 0; index < shortcutsForOldKey.length; ) {
      if (shortcutsForOldKey[index].name === shortcutName) {
        const shortcut = shortcutsForOldKey.splice(index, 1)[0];
        if (newKeyCode) {
          if (keyboardShortcutsByKeyCode[newKeyCode]) {
            keyboardShortcutsByKeyCode[newKeyCode].push(shortcut);
          } else {
            keyboardShortcutsByKeyCode[newKeyCode] = [shortcut];
          }
          shortcut.setKeyCode(newKeyCode);
        }
      } else {
        index++;
      }
    }
    if (
      keyboardShortcutsByKeyCode[oldKeyCode] &&
      keyboardShortcutsByKeyCode[oldKeyCode].length === 0
    ) {
      delete keyboardShortcutsByKeyCode[oldKeyCode];
    }
  }
}

export function* iterateKeyboardShortcuts() {
  for (let keyCode in keyboardShortcutsByKeyCode) {
    for (let shortcut of keyboardShortcutsByKeyCode[keyCode]) {
      yield shortcut;
    }
  }
}

export function isSearchFilterDropdownOpen() {
  return !!queryElement(".inline-list-select.ut-search-filter-control.is-open");
}
