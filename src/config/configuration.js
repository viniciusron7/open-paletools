/**
 * Loads and persists the settings object: `loadConfiguration` (run once at module evaluation
 * and again by the backup import), `persistConfiguration` (called by the settings UI and
 * plugins after a change), the pristine `defaultConfiguration`, and `configuration`, the alias
 * of `configurationState` (src/config/defaults.js) that all modules import.
 *
 * Invariants:
 * - Storage: localStorage 'paletools:settings' holds base64(JSON) of the whole object; it is
 *   not scoped by season or persona (src/core/storage.js maps 'settings' to it and its
 *   `upgrade()` skips it).
 * - `defaultConfiguration` is a deep JSON clone taken before the first load; it is the fallback
 *   here. The settings view's reset action names it in a call to `updateConfiguration`, which is
 *   declared nowhere, so the reset never applies it.
 * - Loading deep-merges with `extendObject` into the existing objects: stored values win, keys
 *   absent from storage keep their current value, unknown stored keys are kept, arrays merge by
 *   index. Never replace `configurationState` or its nested objects.
 * - A missing or unreadable value (atob or JSON error) merges `defaultConfiguration` and
 *   persists at once.
 * - Because the first load runs at evaluation, every later module in the manifest already sees
 *   the stored settings while it is evaluated.
 * - Events: CONFIGURATION_LOADED after every load and CONFIGURATION_SAVED after every persist
 *   (detail: the object); a persist then calls `window.PaletoolsNative.saveConfiguration(obj)`
 *   when the native host provides it. The first events fire during evaluation, before any
 *   plugin listens.
 * - `configuration` and `configurationState` are the same object.
 *
 * Known issues (kept as-is):
 * - `btoa` accepts only Latin-1, so a setting containing other characters makes
 *   `persistConfiguration` throw.
 */
import { configurationState } from "./defaults.js";
import { dispatchPaletoolsEvent, paletoolsEvents } from "../core/events.js";
import { extendObject } from "../core/objects.js";

export const defaultConfiguration = JSON.parse(JSON.stringify(configurationState));

export function loadConfiguration() {
  try {
    const storedConfiguration = JSON.parse(atob(localStorage.getItem("paletools:settings")));
    extendObject(true, configurationState, storedConfiguration);
  } catch {
    extendObject(true, configurationState, defaultConfiguration);
    persistConfiguration();
  }
  dispatchPaletoolsEvent(paletoolsEvents.CONFIGURATION_LOADED, configurationState);
}

export function persistConfiguration() {
  localStorage.setItem("paletools:settings", btoa(JSON.stringify(configurationState)));
  dispatchPaletoolsEvent(paletoolsEvents.CONFIGURATION_SAVED, configurationState);
  if (window.PaletoolsNative?.saveConfiguration) {
    window.PaletoolsNative.saveConfiguration(configurationState);
  }
}

loadConfiguration();

export const configuration = configurationState;
