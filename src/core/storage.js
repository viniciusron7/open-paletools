/**
 * Persona- and season-scoped Web Storage wrapper `paletoolsStorage` (JSON values) and
 * `StoredIdList`, a persisted id list whose storage key is computed on every access.
 * src/bootstrap/boot.js calls `upgrade()` before the plugins run; `get`/`set` are used by
 * plugins (my packs, club analyzer, SBC smart builder and builder enhancer, what's new) and by
 * src/club/locked-items.js.
 *
 * Invariants:
 * - Keys are 'paletools:<APP_YEAR>:<persona>:<key>' (persona = the user's `selectedPersona`);
 *   they are persisted names. 'settings' maps to the unscoped 'paletools:settings' owned by
 *   src/config/configuration.js, which stores base64, so `get('settings')` returns null.
 * - Without a selected persona `set` does nothing and `get` returns undefined.
 * - `set(key, data, true)` writes localStorage, otherwise sessionStorage; `get` reads
 *   sessionStorage first (missing, 'undefined' or 'NaN' fall back to localStorage) and returns
 *   null for invalid JSON.
 * - `upgrade()` runs only while 'paletools:storage:version' is absent: it moves every other
 *   unscoped 'paletools:...' key except 'paletools:settings' under the current persona prefix
 *   and then stores version '1'. It needs the selected persona.
 * - `StoredIdList` persists to localStorage, compares ids with `indexOf` (type-sensitive), and
 *   its `remove` always rewrites the list.
 *
 * Known issues (kept as-is):
 * - `upgrade()` also moves 'paletools:searchFilters', which the market search filters plugin
 *   reads unscoped, so filters saved there before the first upgrade are no longer read.
 */
import { getSelectedPersona } from "../webapp/user.js";

export class StoredIdList {
  #p;
  constructor(getStorageKey) {
    this.#p = getStorageKey;
  }
  ["contains"](id) {
    const storedIds = paletoolsStorageInstance.get(this.#p());
    return !!storedIds && storedIds.indexOf(id) > -1;
  }
  ["add"](id) {
    const storageKey = this.#p();
    let storedIds = paletoolsStorageInstance.get(storageKey);
    if (!storedIds) {
      storedIds = [];
    }
    if (!(storedIds.indexOf(id) > -1)) {
      storedIds.push(id);
      paletoolsStorageInstance.set(storageKey, storedIds, true);
    }
  }
  ["remove"](id) {
    const ids = this.all();
    const index = ids.indexOf(id);
    if (index > -1) {
      ids.splice(index, 1);
    }
    paletoolsStorageInstance.set(this.#p(), ids, true);
  }
  ["all"]() {
    let storedIds = paletoolsStorageInstance.get(this.#p());
    if (!storedIds) {
      storedIds = [];
    }
    return storedIds;
  }
  ["removeAll"]() {
    paletoolsStorageInstance.set(this.#p(), [], true);
  }
}

const paletoolsStorageInstance = new (class {
  ["set"](key, data, isPersistent) {
    if (getSelectedPersona()) {
      key =
        key === "settings"
          ? "paletools:settings"
          : "paletools:" + APP_YEAR + ":" + getSelectedPersona() + ":" + key;
      data = JSON.stringify(data);
      if (isPersistent) {
        localStorage.setItem(key, data);
      } else {
        sessionStorage.setItem(key, data);
      }
    }
  }
  ["get"](key) {
    if (!getSelectedPersona()) {
      return;
    }
    key =
      key === "settings"
        ? "paletools:settings"
        : "paletools:" + APP_YEAR + ":" + getSelectedPersona() + ":" + key;
    let storedJson = sessionStorage.getItem(key);
    if (storedJson === "undefined") {
      storedJson = undefined;
    }
    if (storedJson === "NaN") {
      storedJson = NaN;
    }
    if (!storedJson) {
      storedJson = localStorage.getItem(key);
    }
    try {
      if (storedJson) {
        return JSON.parse(storedJson);
      }
    } catch {
      return null;
    }
  }
  ["upgrade"]() {
    if (!localStorage.getItem("paletools:storage:version")) {
      for (let storageKey of Object.keys(localStorage)) {
        if (!storageKey.startsWith("paletools:")) {
          continue;
        }
        if (storageKey.startsWith("paletools:" + APP_YEAR + ":")) {
          continue;
        }
        if (storageKey === "paletools:settings") {
          continue;
        }
        const storedJson = localStorage.getItem(storageKey);
        const scopedKey = storageKey.replace(
          "paletools:",
          "paletools:" + APP_YEAR + ":" + getSelectedPersona() + ":",
        );
        localStorage.setItem(scopedKey, storedJson);
        localStorage.removeItem(storageKey);
      }
      localStorage.setItem("paletools:storage:version", "1");
    }
  }
})();

export const paletoolsStorage = paletoolsStorageInstance;
