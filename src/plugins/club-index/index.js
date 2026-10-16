/**
 * Club Index plugin `clubIndexPlugin` (order 19), installed by the plugin list in
 * src/bootstrap/boot.js: keeps the in-memory club index (src/club/club-index.js) in sync with
 * Paletools item events, builds it on APP_LOADED with a progress notification and exposes
 * `clubIndexDebug()` on the page window.
 *
 * Invariants:
 * - The ITEM_MOVED, ITEM_DISCARDED and SBC_SUBMITTED listeners and `clubIndexDebug` are installed
 *   once (`hasClubIndexStarted`); the listeners act only while `isClubIndexEnabled()`, whereas
 *   `clubIndexDebug()` always answers (reporting it as `enabled`).
 * - A non-loan player moved to the club is stored under `getClubIndexItemKey(item)`; while a
 *   build runs (`clubIndexBuildOverlay`) it goes to `addedByItemId` (and leaves
 *   `removedByItemId`) instead. Moves elsewhere, discards and SBC submissions remove the players.
 * - The APP_LOADED build is registered only if `clubIndex.enabled` when `run()` executes; boot
 *   dispatches APP_LOADED after every plugin ran.
 * - `loadClubIndexWithNotification` owns `clubIndexLoadingNotification` (static NEUTRAL
 *   notification, `plugins.clubIndex.notifications.loaded` with `{count}`), disposed in
 *   `finally`.
 * - Opening the settings menu force-enables and persists the index when sbcAutoSolver or
 *   sbcSmartBuilder is enabled; SMART_BUILDER_ENABLED / SBC_AUTO_SOLVER_ENABLED switch the toggle
 *   on and start a build.
 *
 * Known issues (kept as-is):
 * - Every build of the settings menu adds new SMART_BUILDER_ENABLED / SBC_AUTO_SOLVER_ENABLED
 *   listeners that are never removed.
 */
import {
  clubIndexBuildOverlay,
  clubIndexPlayersByItemKey,
  clubIndexRevisionDefinitionIdsByDatabaseId,
  getClubIndexItemKey,
  getClubIndexPlayers,
  isClubIndexEnabled,
  isClubIndexLoaded,
  loadClubIndex,
  removePlayerFromClubIndex,
  setClubIndexPlayer,
} from "../../club/club-index.js";
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { getPageWindow } from "../../core/page-window.js";
import { translate } from "../../i18n/translations.js";
import { createStaticNotification } from "../../ui/notifications.js";
import { appendToggle } from "../../ui/settings-controls.js";

let hasClubIndexStarted = false;

let clubIndexPluginDefinition;

const clubIndexSettings = configuration.plugins.clubIndex;

let clubIndexLoadingNotification = null;

function showClubIndexLoadedCount(loadedCount) {
  if (clubIndexLoadingNotification) {
    clubIndexLoadingNotification.message(
      translate("plugins.clubIndex.notifications.loaded").replace("{count}", loadedCount),
    );
  }
}

async function loadClubIndexWithNotification() {
  clubIndexLoadingNotification = createStaticNotification(UINotificationType.NEUTRAL);
  try {
    return await loadClubIndex(showClubIndexLoadedCount);
  } finally {
    if (clubIndexLoadingNotification) {
      clubIndexLoadingNotification.dispose();
      clubIndexLoadingNotification = null;
    }
  }
}

clubIndexPluginDefinition = {
  run: function () {
    if (!hasClubIndexStarted) {
      hasClubIndexStarted = true;
      getPageWindow().clubIndexDebug = () => {
        const players = getClubIndexPlayers();
        return {
          enabled: isClubIndexEnabled(),
          loaded: isClubIndexLoaded,
          count: players.length,
          players: players,
          byItemId: clubIndexPlayersByItemKey,
          revisionDefinitionIdsByDatabaseId: clubIndexRevisionDefinitionIdsByDatabaseId,
          buildOverlay: clubIndexBuildOverlay,
        };
      };
      listenForEvent(paletoolsEvents.ITEM_MOVED, (event) => {
        if (isClubIndexEnabled() && event.detail.item.type === ItemType.PLAYER) {
          if (event.detail.itemPile === ItemPile.CLUB) {
            (function (item) {
              if (!item || item.type !== ItemType.PLAYER) {
                return;
              }
              if (item.loans > -1) {
                return;
              }
              const indexKey = getClubIndexItemKey(item);
              if (indexKey) {
                if (clubIndexBuildOverlay) {
                  clubIndexBuildOverlay.addedByItemId[indexKey] = item;
                  delete clubIndexBuildOverlay.removedByItemId[indexKey];
                } else {
                  setClubIndexPlayer(indexKey, item);
                }
              }
            })(event.detail.item);
          } else {
            removePlayerFromClubIndex(event.detail.item);
          }
          console.log(
            event.detail.item.getStaticData().name + " moved to " + ItemPile[event.detail.itemPile],
          );
        }
      });
      listenForEvent(paletoolsEvents.ITEM_DISCARDED, (event) => {
        if (isClubIndexEnabled() && event.detail.item.type === ItemType.PLAYER) {
          removePlayerFromClubIndex(event.detail.item);
          console.log(event.detail.item.getStaticData().name + " discarded");
        }
      });
      listenForEvent(paletoolsEvents.SBC_SUBMITTED, (event) => {
        if (isClubIndexEnabled()) {
          for (const player of event.detail.players || []) {
            removePlayerFromClubIndex(player);
            console.log(player.getStaticData().name + " sent to SBC");
          }
        }
      });
    }
    if (clubIndexSettings.enabled) {
      listenForEvent(paletoolsEvents.APP_LOADED, loadClubIndexWithNotification);
    }
  },
  order: 19,
  settings: {
    name: "club-index",
    title: "plugins.clubIndex.settings.title",
    menu: function () {
      if (
        configuration.plugins.sbcAutoSolver.enabled ||
        configuration.plugins.sbcSmartBuilder.enabled
      ) {
        clubIndexSettings.enabled = true;
        persistConfiguration();
      }
      const container = document.createElement("div");
      const enabledToggle = appendToggle(
        container,
        "enabled",
        clubIndexSettings.enabled,
        (enabled) => {
          clubIndexSettings.enabled = enabled;
          persistConfiguration();
          if (clubIndexSettings.enabled) {
            loadClubIndexWithNotification();
          }
        },
      );
      const ensureClubIndexEnabled = () => {
        if (!enabledToggle.getToggleState()) {
          enabledToggle.toggle();
          persistConfiguration();
          loadClubIndexWithNotification();
        }
      };
      listenForEvent(paletoolsEvents.SMART_BUILDER_ENABLED, ensureClubIndexEnabled);
      listenForEvent(paletoolsEvents.SBC_AUTO_SOLVER_ENABLED, ensureClubIndexEnabled);
      return container;
    },
  },
};

export const clubIndexPlugin = clubIndexPluginDefinition;
