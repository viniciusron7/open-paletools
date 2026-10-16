/**
 * Feeds the IndexedDB tracked-players store (`paletoolsDatabase.trackedPlayers.add(definitionId,
 * owners)`) with player items the user sees; wired by src/bootstrap/boot.js to
 * UNASSIGNED_ITEM_ADDED, ITEM_MOVED, ITEM_WON, ITEM_DISCARDED and CLUB_INDEX_LOADED, and used for
 * the initial sync (club index, unassigned, SBC storage, transfer list and watchlist loaders).
 *
 * Invariants:
 * - Skips falsy entries, non-players, `isLimitedUse()` items, `concept` items and items flagged
 *   `isConceptPlayer`; store writes are awaited one after another.
 * - `trackPlayerItems`/`trackClubIndexPlayers` reject on store errors and the callers attach
 *   `notifyPlayerTrackingError` (translation `services.playerTracking.error`);
 *   `trackPlayersFromLoader` catches errors of the loader and the store itself.
 * - `trackClubIndexPlayers` resolves immediately unless the club index is ready.
 */
import { getClubIndexPlayers, isClubIndexReady } from "./club-index.js";
import { paletoolsDatabase } from "../db/database.js";
import { translate } from "../i18n/translations.js";
import { showErrorNotification } from "../ui/notifications.js";

export async function trackPlayerItems(items) {
  for (const item of items) {
    if (
      !(
        !item ||
        item.type !== ItemType.PLAYER ||
        item.isLimitedUse() ||
        item.concept ||
        item.isConceptPlayer
      )
    ) {
      await paletoolsDatabase.trackedPlayers.add(item.definitionId, item.owners);
    }
  }
}

export function trackClubIndexPlayers() {
  return isClubIndexReady() ? trackPlayerItems(getClubIndexPlayers()) : Promise.resolve();
}

export function notifyPlayerTrackingError() {
  showErrorNotification(translate("services.playerTracking.error"));
}

export async function trackPlayersFromLoader(loadItems) {
  try {
    await trackPlayerItems(await loadItems());
  } catch {
    notifyPlayerTrackingError();
  }
}
