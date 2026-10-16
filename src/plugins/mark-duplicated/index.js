/**
 * Mark Duplicated plugin (`markDuplicatedPlugin`, order 10), installed by the plugin list in
 * src/bootstrap/boot.js: adds the `club-duplicated` class to items the user already owns in market
 * search results, item table cells, the player search dropdown and SBC squad slots.
 *
 * Hooks (installed in `run()`, each after the original):
 * - pushes `markOwnedSearchResults` onto `marketSearchSetItemsHandlers`, which the
 *   `UTMarketSearchView.setItems` patch of src/webapp/patches.js calls after each result list.
 * - `UTSBCSquadOverviewView.prototype.setSquad`: marks squad slots whose item is a duplicate of
 *   an unassigned item (`duplicateId`).
 * - `UTItemTableCellView.prototype.render` (EA `duplicateId`) and
 *   `UTPlayerSearchControl.prototype.updateList` (owned players, plus `club-untradeable`).
 *
 * Invariants:
 * - Ownership comes from `findOwnedClubPlayers(items, 0, true)`, keyed by definition id; `run()`
 *   calls `loadClubPlayers()` without arguments when enabled at boot, which resolves `{}` and
 *   loads nothing (ownership is looked up lazily per search).
 * - The classes are styled by mark-duplicated.css, stylesheet id `paletools-markDuplicated`,
 *   added at boot when enabled and on `APP_ENABLED`, removed on `APP_DISABLED`.
 * - The squad hook caches the unassigned items on the view as `this.unnasignedItems`
 *   (misspelled, kept) and fetches them (`fetchUnassignedItems`) once per view instance.
 * - Setting `plugins.markDuplicated.enabled` (settings tile `mark-duplicated`).
 *
 * Known issues (kept as-is):
 * - The `setSquad` hook ignores `configuration.enabled` and `markDuplicated.enabled`.
 * - A no-op `CONFIGURATION_SAVED` listener is registered.
 */
import { findOwnedClubPlayers, loadClubPlayers } from "../../club/club-players-cache.js";
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { addClasses } from "../../core/dom.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { marketSearchSetItemsHandlers } from "../../market/search-hooks.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { removeStylesheet, upsertStylesheet } from "../../ui/stylesheets.js";
import { fetchUnassignedItems } from "../../webapp/item-piles.js";
import { findControllerOfType } from "../../webapp/navigation.js";
import markDuplicatedStyles from "./mark-duplicated.css";

let markDuplicatedPluginDefinition;

const markDuplicatedSettings = configuration.plugins.markDuplicated;

markDuplicatedPluginDefinition = {
  run: function () {
    var markOwnedSearchResults;
    if (configuration.enabled && markDuplicatedSettings.enabled) {
      loadClubPlayers();
    }
    markOwnedSearchResults = async (searchItems, currentController) => {
      if (!configuration.enabled || !markDuplicatedSettings.enabled) {
        return;
      }
      const clubItemsByDefinitionId = await findOwnedClubPlayers(searchItems, 0, true);
      const searchResultsView = findControllerOfType(UTMarketSearchResultsViewController).getView();
      for (let row of (searchResultsView._list && searchResultsView._list.listRows) || []) {
        if (clubItemsByDefinitionId[row.data.definitionId]) {
          addClasses(row.__entityContainer, "club-duplicated");
        }
      }
    };
    marketSearchSetItemsHandlers.push(markOwnedSearchResults);
    listenForEvent(paletoolsEvents.CONFIGURATION_SAVED, () => {});
    const originalSetSquad = UTSBCSquadOverviewView.prototype.setSquad;
    UTSBCSquadOverviewView.prototype.setSquad = function (...setSquadArguments) {
      function markDuplicatedSquadSlots(squadView, unassignedItems) {
        const squad = setSquadArguments[0];
        const duplicatedItemIds = [];
        for (let item of unassignedItems) {
          if (item.duplicateId !== 0) {
            duplicatedItemIds.push(item.id);
            duplicatedItemIds.push(item.duplicateId);
          }
        }
        for (let slot of squad.getPlayers()) {
          const item = slot.getItem();
          if (item.id > 0 && duplicatedItemIds.indexOf(item.id) > -1) {
            addClasses(
              squadView.slotViews
                .find((slotView) => slotView.getIndex() === slot.index)
                .getItemView(),
              "club-duplicated",
            );
          }
        }
      }
      originalSetSquad.call(this, ...setSquadArguments);
      if (this.unnasignedItems) {
        markDuplicatedSquadSlots(this, this.unnasignedItems);
      } else {
        fetchUnassignedItems().then((unassignedItems) => {
          this.unnasignedItems = unassignedItems;
          markDuplicatedSquadSlots(this, unassignedItems);
        });
      }
    };
    const originalRender = UTItemTableCellView.prototype.render;
    UTItemTableCellView.prototype.render = function (renderArgument1) {
      originalRender.call(this, renderArgument1);
      if (configuration.enabled && markDuplicatedSettings.enabled && this.data.duplicateId) {
        addClasses(this.__entityContainer, "club-duplicated");
      }
    };
    const originalUpdateList = UTPlayerSearchControl.prototype.updateList;
    UTPlayerSearchControl.prototype.updateList = function (updateListArgument1, players) {
      originalUpdateList.call(this, updateListArgument1, players);
      if (configuration.enabled && markDuplicatedSettings.enabled) {
        (async () => {
          const clubItemsByDefinitionId = await findOwnedClubPlayers(players, 0, true);
          for (let index = 0; index < players.length; index++) {
            const player = players[index];
            if (clubItemsByDefinitionId[player.id]) {
              this.__playerResultsList.children[index].classList.add("club-duplicated");
              if (!clubItemsByDefinitionId[player.id].tradable) {
                this.__playerResultsList.children[index].classList.add("club-untradeable");
              }
            }
          }
        })();
      }
    };
    if (configuration.enabled && markDuplicatedSettings.enabled) {
      upsertStylesheet("paletools-markDuplicated", markDuplicatedStyles);
    }
    listenForEvent(paletoolsEvents.APP_ENABLED, () =>
      upsertStylesheet("paletools-markDuplicated", markDuplicatedStyles),
    );
    listenForEvent(paletoolsEvents.APP_DISABLED, () =>
      removeStylesheet("paletools-markDuplicated"),
    );
  },
  order: 10,
  settings: {
    name: "mark-duplicated",
    title: "plugins.markDuplicated.settings.title",
    menu: function () {
      const menuContainer = document.createElement("div");
      appendToggle(menuContainer, "enabled", markDuplicatedSettings.enabled, (isEnabled) => {
        markDuplicatedSettings.enabled = isEnabled;
        persistConfiguration();
      });
      return menuContainer;
    },
  },
};

export const markDuplicatedPlugin = markDuplicatedPluginDefinition;
