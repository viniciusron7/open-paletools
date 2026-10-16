/**
 * Persistence helpers for the My Packs lock feature, imported by src/plugins/my-packs/index.js:
 * save, read and test the list of locked pack ids.
 *
 * Invariants:
 * - Stored through `paletoolsStorage` under key `lockedPacks` with `isPersistent = true`, i.e.
 *   localStorage key `paletools:<APP_YEAR>:<persona>:lockedPacks` (part of backups).
 * - `getMyPacksLockedPackIds()` returns [] whenever `configuration.plugins.myPacks.lock` is off,
 *   so every lock check is false while locking is disabled (the stored ids are kept).
 * - Ids are compared as integers: `isMyPacksPackLocked` parses its argument with `parseInt` and
 *   returns `undefined` for a falsy id.
 */
import { configuration } from "../../config/configuration.js";
import { paletoolsStorage } from "../../core/storage.js";

const myPacksLockedPacksStorageKey = "lockedPacks";

export function saveMyPacksLockedPackIds(lockedPackIds) {
  paletoolsStorage.set(myPacksLockedPacksStorageKey, lockedPackIds, true);
}

export function getMyPacksLockedPackIds() {
  return (
    (configuration.plugins.myPacks.lock && paletoolsStorage.get(myPacksLockedPacksStorageKey)) || []
  );
}

export function isMyPacksPackLocked(packId) {
  if (packId) {
    packId = parseInt(packId);
    return getMyPacksLockedPackIds().indexOf(packId) > -1;
  }
}
