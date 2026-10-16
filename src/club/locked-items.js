/**
 * Lock state of club items for the lock-players feature: manual locks persisted per card
 * definition, rule locks from `configuration.plugins.lockPlayers` (nation/team/league/rarity id
 * lists) and per-item unlock overrides. Read by the SBC solvers and builders, the club index
 * (`hideLocked`) and src/webapp/patches.js; changed by src/plugins/lock-players/index.js and
 * src/plugins/player-actions/lock-player.js.
 *
 * Invariants:
 * - Persisted keys (`paletoolsStorage`, localStorage, stored as
 *   `paletools:<APP_YEAR>:<persona>:<key>`; nothing is read or written without a persona):
 *   - `lockedItems`: JSON array of lock keys = `definitionId` (number), or the string
 *     `<definitionId>u` for items with `upgrades` (evolutions).
 *   - `unlockedItemIds`: JSON array of item ids as strings (`item.id ?? itemData.id`) whose rule
 *     lock is overridden.
 * - The `lockedItemKeys`/`unlockOverrideIds` Maps load from storage lazily, only while empty; each
 *   change rewrites the whole stored array. Map lookups are type-sensitive, so stored lock keys
 *   must keep their number/string types.
 * - `getStoredLockedItemKeys()` returns `[]` while `lockPlayers.enabled` is false, so a `lockItem`
 *   in that state would persist a list holding only the new key.
 * - `isItemLocked` = has a definitionId, no unlock override, and a manual or rule lock.
 *   `isItemLockedByRules` does not check `lockPlayers.enabled`; item ids are parseInt'ed and
 *   looked up in the numeric rule lists.
 * - `lockItem` drops the item's unlock override; `unlockItem` removes the manual lock and records
 *   an override only when a rule still locks the item.
 * - `getItemLockKey`/`getItemLockOverrideId` values are written to the DOM as `data-lockable-id`/
 *   `data-lock-override-id` by the lock-players plugin; keep the formats in sync.
 * - `lockedItemKeys` is exported mutable state: the lock-players plugin clears it and then calls
 *   `saveLockedItemKeys()`.
 */
import { configuration } from "../config/configuration.js";
import { paletoolsStorage } from "../core/storage.js";

const lockedItemsStorageKey = "lockedItems";

const unlockedItemIdsStorageKey = "unlockedItemIds";

export const lockedItemKeys = new Map();

const unlockOverrideIds = new Map();

export function saveLockedItemKeys() {
  paletoolsStorage.set(lockedItemsStorageKey, Array.from(lockedItemKeys.keys()), true);
}

function saveUnlockOverrideIds() {
  paletoolsStorage.set(unlockedItemIdsStorageKey, Array.from(unlockOverrideIds.keys()), true);
}

export function getItemLockKey(item) {
  if (!item || !item.definitionId) {
    return;
  }
  let lockKey = item.definitionId;
  if (item.upgrades) {
    lockKey = lockKey + "u";
  }
  return lockKey;
}

export function getItemLockOverrideId(item) {
  const itemId = item?.id ?? item?.itemData?.id;
  return itemId == null ? null : String(itemId);
}

export function getStoredLockedItemKeys() {
  return (
    (configuration.plugins.lockPlayers.enabled && paletoolsStorage.get(lockedItemsStorageKey)) || []
  );
}

export function getLockedItemKeys() {
  if (lockedItemKeys.size === 0) {
    const storedKeys = getStoredLockedItemKeys();
    for (let lockKey of storedKeys) {
      lockedItemKeys.set(lockKey, true);
    }
  }
  return lockedItemKeys;
}

function getUnlockOverrideIds() {
  if (unlockOverrideIds.size === 0) {
    for (const overrideId of paletoolsStorage.get(unlockedItemIdsStorageKey) || []) {
      unlockOverrideIds.set(String(overrideId), true);
    }
  }
  return unlockOverrideIds;
}

function isIdInList(id, ids) {
  if (!ids || ids.length === 0) {
    return false;
  }
  if (id == null) {
    return false;
  }
  const numericId = typeof id === "string" ? parseInt(id, 10) : id;
  return !isNaN(numericId) && ids.indexOf(numericId) > -1;
}

export function lockItem(item) {
  if (!item || !item.definitionId) {
    return;
  }
  const lockKey = getItemLockKey(item);
  removeUnlockOverride(item);
  const lockedKeys = getLockedItemKeys();
  if (!lockedKeys.has(lockKey)) {
    lockedKeys.set(lockKey, true);
    saveLockedItemKeys();
  }
}

export function unlockItem(item) {
  if (!item || !item.definitionId) {
    return;
  }
  const lockKey = getItemLockKey(item);
  const lockedKeys = getLockedItemKeys();
  if (lockedKeys.has(lockKey)) {
    lockedKeys.delete(lockKey);
    saveLockedItemKeys();
  }
  if (isItemLockedByRules(item)) {
    (function (targetItem) {
      const overrideId = getItemLockOverrideId(targetItem);
      if (!overrideId) {
        return;
      }
      const overrideIds = getUnlockOverrideIds();
      if (!overrideIds.has(overrideId)) {
        overrideIds.set(overrideId, true);
        saveUnlockOverrideIds();
      }
    })(item);
  }
}

export function removeUnlockOverride(item) {
  const overrideId = getItemLockOverrideId(item);
  if (overrideId && getUnlockOverrideIds().delete(overrideId)) {
    saveUnlockOverrideIds();
  }
}

export function hasUnlockOverride(item) {
  const overrideId = getItemLockOverrideId(item);
  return !!overrideId && getUnlockOverrideIds().has(overrideId);
}

export function isItemLocked(item) {
  return (
    !(!item || !item.definitionId) &&
    !hasUnlockOverride(item) &&
    (isItemManuallyLocked(item) || isItemLockedByRules(item))
  );
}

export function isItemManuallyLocked(item) {
  if (!item || !item.definitionId) {
    return false;
  }
  let lockKey = getItemLockKey(item);
  return getLockedItemKeys().has(lockKey);
}

export function isItemLockedByRules(item) {
  const lockPlayersSettings = configuration.plugins.lockPlayers;
  return (
    !!lockPlayersSettings &&
    (isIdInList(item.nationId ?? item.nation, lockPlayersSettings.lockByNationIds) ||
      isIdInList(item.teamId ?? item.clubId ?? item.club, lockPlayersSettings.lockByTeamIds) ||
      isIdInList(item.leagueId ?? item.league, lockPlayersSettings.lockByLeagueIds) ||
      isIdInList(item.rareflag, lockPlayersSettings.lockByRarityIds))
  );
}
