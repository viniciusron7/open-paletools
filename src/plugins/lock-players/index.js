/**
 * Lock players plugin `lockPlayersPlugin` (order 11), installed by the plugin list in
 * src/bootstrap/boot.js: club hub tile listing manually locked players (import, export, clear),
 * mass lock buttons in squads and club search results, `locked` markers on player items, and a
 * guard that blocks SBC submissions with locked players. Lock state lives in
 * src/club/locked-items.js.
 *
 * Hooks (installed in `run()`; all call the original first except `submitChallenge`):
 * - `UTClubHubView._generate`: tile `locked-players-tile` once per view
 *   (`_lockPlayersGenerated`); stylesheet `locked-players` is removed on every call and re-added
 *   only when the tile is built.
 * - `UTSquadActionsView._generate` / `destroyGeneratedElements` and
 *   `UTSquadActionsViewController.setSquad` (copies `_squad` to the view): squad mass-lock
 *   button.
 * - `UTSBCService.submitChallenge` (see below).
 * - `UTPlayerItemView.renderItem` / `resetRender`: set / remove `data-lockable-id`,
 *   `data-lock-override-id` and class `locked`.
 * - `UTClubSearchResultsView.setItems`: replaces the header mass-lock button
 *   (`header.lockPlayers`).
 *
 * Invariants:
 * - `submitChallenge` returns the original observable when disabled or when no field player is
 *   locked (items whose `utasPile` is STORAGE are ignored). Otherwise it returns its own
 *   `EAObservable`, notified after `fetchUnassignedItems()`: if every locked player has a
 *   same-definitionId duplicate in unassigned, a dialog lists them and OK forwards the original
 *   submit result; else it gets a BAD_REQUEST `UTServiceResponseDTO` and an error lists them. It
 *   wraps the babysitter and sbc-builder-enhancer wrappers (lower orders).
 * - Mass lock toggles each non-loan player (locked manually or by rule -> `unlockItem`, else
 *   `lockItem`); the squad button updates `.locked` on views found by
 *   `[data-lock-override-id="<id>"]` (a selector player-actions/lock-player.js also uses), the
 *   search-results button (players only) on each `row.itemComponent`.
 * - Export writes the stored keys comma-separated to `locked-players_<yyyyMMdd_HHmmss>.csv`;
 *   import merges comma-separated keys; the tile search `parseInt`s keys (drops the `u` suffix).
 * - Opening the settings menu replaces `lockByNationIds`, `lockByLeagueIds`, `lockByTeamIds`
 *   and `lockByRarityIds` with new normalized arrays (integers, deduplicated; the old arrays are
 *   not mutated) and upserts `lock-players-settings`.
 *
 * Known issues (kept as-is):
 * - When the duplicate dialog is cancelled, the returned observable is never notified.
 * - Imported keys are strings while `getItemLockKey` returns a number for non-upgraded items, so
 *   imported plain definition ids never match `isItemManuallyLocked`; keys are not trimmed.
 * - The Clear button keeps the singular/plural label chosen at generate time and does not hide
 *   the Export button.
 */
import {
  getItemLockKey,
  getItemLockOverrideId,
  getLockedItemKeys,
  getStoredLockedItemKeys,
  isItemLocked,
  isItemLockedByRules,
  isItemManuallyLocked,
  lockItem,
  lockedItemKeys,
  saveLockedItemKeys,
  unlockItem,
} from "../../club/locked-items.js";
import { configuration, persistConfiguration } from "../../config/configuration.js";
import {
  accessAttribute,
  addClasses,
  appendElements,
  createElement,
  queryElement,
  queryElements,
  removeAttribute,
  removeClasses,
  removeFromParentNode,
} from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { dataProviderType } from "../../ui/data-provider-dropdown.js";
import { DataProviderMultiSelectControl } from "../../ui/data-provider-multi-select-control.js";
import { showDialog } from "../../ui/dialog.js";
import { showErrorNotification } from "../../ui/notifications.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { removeStylesheet, upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import { fetchUnassignedItems } from "../../webapp/item-piles.js";
import { getActiveController } from "../../webapp/navigation.js";
import { observableToPromise } from "../../webapp/observable.js";
import { getLocalizedRarities, rarityIdByName } from "../../webapp/rarities.js";
import lockPlayersStyles from "./lock-players.css";

let lockPlayersPluginDefinition;

const lockPlayersSettings = configuration.plugins.lockPlayers;

function normalizeLockPlayersIdSetting(settingKey) {
  lockPlayersSettings[settingKey] = [
    ...new Set((lockPlayersSettings[settingKey] || []).map(Number).filter(Number.isInteger)),
  ];
}

function createLockPlayersDataProviderSelector(
  labelKey,
  placeholderKey,
  settingKey,
  dataProviderType,
  getOptions,
) {
  return new DataProviderMultiSelectControl({
    type: dataProviderType,
    ids: lockPlayersSettings[settingKey],
    options: getOptions,
    label: translate(labelKey),
    placeholder: translate(placeholderKey),
    selectLabel: translate("plugins.lockPlayers.settings.select"),
    onChange: persistConfiguration,
  });
}

lockPlayersPluginDefinition = {
  run: function () {
    const originalClubHubGenerate = UTClubHubView.prototype._generate;
    UTClubHubView.prototype._generate = function (...args) {
      originalClubHubGenerate.call(this, ...args);
      removeStylesheet("locked-players");
      if (!configuration.enabled || !lockPlayersSettings.enabled) {
        return;
      }
      const lockedPlayerCount = getStoredLockedItemKeys().length;
      if (!this._lockPlayersGenerated) {
        upsertStylesheet("locked-players", lockPlayersStyles);
        this._lockedPlayersTile = new UTTileView();
        this._lockedPlayersTile.init();
        this._lockedPlayersTile.setTitle(translate("plugins.lockPlayers.clubHub.tile"));
        const countLabel = new UTLabelView();
        countLabel.setRoundedCorner(UTLabelView.Rounded.BOTTOM_LEFT);
        countLabel.setLabel(
          translate(lockedPlayerCount === 1 ? "tile.label.itemCount" : "tile.label.itemsCount", [
            lockedPlayerCount,
          ]),
        );
        this._lockedPlayersTile.setContent(countLabel);
        this._lockedPlayersTile.addTarget(
          this,
          () => {
            const navigationController = getActiveController().getNavigationController();
            if (!navigationController) {
              return;
            }
            const clubSearchResultsController = isPhone()
              ? new UTClubSearchResultsViewController()
              : new controllers.club.ClubSearchResultsLandscape();
            const searchCriteria = new UTSearchCriteriaDTO();
            const lockedItemIds = getStoredLockedItemKeys();
            if (lockedItemIds.length !== 0) {
              searchCriteria.defId = lockedItemIds
                .map((lockedItemId) => parseInt(lockedItemId, 10))
                .filter((definitionId) => !isNaN(definitionId));
              searchCriteria.type = SearchType.PLAYER;
              clubSearchResultsController.initWithSearchCriteria(searchCriteria);
              navigationController.pushViewController(clubSearchResultsController);
            }
          },
          EventType.TAP,
        );
        this._clearLockedPlayersButton = new UTStandardButtonControl();
        this._clearLockedPlayersButton.init();
        this._clearLockedPlayersButton.addClass("primary");
        this._clearLockedPlayersButton.setText(translate("clear"));
        this._clearLockedPlayersButton.addTarget(
          this,
          () => {
            countLabel.setLabel(
              translate(
                lockedPlayerCount === 1 ? "tile.label.itemCount" : "tile.label.itemsCount",
                [0],
              ),
            );
            lockedItemKeys.clear();
            saveLockedItemKeys();
          },
          EventType.TAP,
        );
        this._exportLockedPlayersButton = new UTStandardButtonControl();
        this._exportLockedPlayersButton.init();
        this._exportLockedPlayersButton.addClass("primary");
        this._exportLockedPlayersButton.setText(translate("export"));
        this._exportLockedPlayersButton.addTarget(
          this,
          () => {
            var lockedItemIds;
            var fileName;
            var mimeType;
            var downloadLink;
            lockedItemIds = getStoredLockedItemKeys();
            fileName =
              "locked-players_" +
              (function (date) {
                if (!(date instanceof Date)) {
                  throw new Error("Input must be a Date object");
                }
                const padNumber = (numericValue, width = 2) =>
                  numericValue.toString().padStart(width, "0");
                return (
                  "" +
                  date.getFullYear() +
                  padNumber(date.getMonth() + 1) +
                  padNumber(date.getDate()) +
                  "_" +
                  padNumber(date.getHours()) +
                  padNumber(date.getMinutes()) +
                  padNumber(date.getSeconds())
                );
              })(new Date()) +
              ".csv";
            mimeType = "text/plain";
            downloadLink = document.createElement("a");
            mimeType = mimeType || "application/octet-stream";
            if (navigator.msSaveBlob) {
              navigator.msSaveBlob(
                new Blob([lockedItemIds], {
                  type: mimeType,
                }),
                fileName,
              );
            } else if (URL && "download" in downloadLink) {
              downloadLink.href = URL.createObjectURL(
                new Blob([lockedItemIds], {
                  type: mimeType,
                }),
              );
              downloadLink.setAttribute("download", fileName);
              document.body.appendChild(downloadLink);
              downloadLink.click();
              document.body.removeChild(downloadLink);
            } else {
              location.href = "data:application/octet-stream," + encodeURIComponent(lockedItemIds);
            }
          },
          EventType.TAP,
        );
        const fileInput = createElement("input", {
          type: "file",
          className: "import-locked-players",
        });
        this._importLockedPlayersButton = new UTStandardButtonControl();
        this._importLockedPlayersButton.init();
        this._importLockedPlayersButton.addClass("primary");
        this._importLockedPlayersButton.setText(translate("import"));
        this._importLockedPlayersButton.addTarget(
          this,
          () => {
            showDialog(
              [
                {
                  labelEnum: enums.UIDialogOptions.OK,
                },
                {
                  labelEnum: enums.UIDialogOptions.CANCEL,
                },
              ],
              translate("plugins.lockPlayers.import.dialogTitle"),
              fileInput,
              async (selectedOption) => {
                if (selectedOption == enums.UIDialogOptions.OK) {
                  if (fileInput.files.length === 0) {
                    return;
                  }
                  const fileReader = new FileReader();
                  fileReader.onload = () => {
                    (function (csvText) {
                      try {
                        const lockedItemsMap = getLockedItemKeys();
                        for (let lockedItemId of csvText.split(",")) {
                          if (!lockedItemsMap.has(lockedItemId)) {
                            lockedItemsMap.set(lockedItemId, true);
                          }
                        }
                        saveLockedItemKeys();
                      } catch (error) {
                        showErrorNotification(error);
                      }
                    })(fileReader.result);
                  };
                  fileReader.readAsText(fileInput.files[0]);
                } else {
                  fileInput.value = null;
                }
              },
            );
          },
          EventType.TAP,
        );
        const commandsContainer = createElement("div", {
          className: "commands",
        });
        appendElements(
          commandsContainer,
          this._importLockedPlayersButton,
          this._exportLockedPlayersButton,
          this._clearLockedPlayersButton,
        );
        appendElements(this._lockedPlayersTile, commandsContainer);
        addClasses(this._lockedPlayersTile, "col-1-2-md", "col-1-1", "locked-players-tile");
        appendElements(queryElement(".grid", this), this._lockedPlayersTile);
        this._lockPlayersGenerated = true;
      }
      if (lockedPlayerCount === 0) {
        hideElements(this._exportLockedPlayersButton);
      } else {
        showElements(this._exportLockedPlayersButton);
      }
    };
    const originalSquadActionsGenerate = UTSquadActionsView.prototype._generate;
    UTSquadActionsView.prototype._generate = function (...args) {
      originalSquadActionsGenerate.call(this, ...args);
      if (configuration.enabled && lockPlayersSettings.enabled) {
        this._lockPlayersBtn = new UTGroupButtonControl();
        this._lockPlayersBtn.init();
        this._lockPlayersBtn.setText(translate("plugins.lockPlayers.button.massLock"));
        this._lockPlayersBtn.addTarget(
          this,
          () => {
            for (let slot of this._squad.getPlayers()) {
              const item = slot.getItem();
              if (item.loans > -1) {
                continue;
              }
              const isManuallyLocked = isItemManuallyLocked(item);
              const isLockedByRule = isItemLockedByRules(item);
              const lockOverrideSelector =
                '[data-lock-override-id="' + getItemLockOverrideId(item) + '"]';
              if (isManuallyLocked || isLockedByRule) {
                removeClasses(queryElements(lockOverrideSelector), "locked");
                unlockItem(slot.getItem());
              } else {
                addClasses(queryElements(lockOverrideSelector), "locked");
                lockItem(item);
              }
            }
          },
          EventType.TAP,
        );
        appendElements(queryElement(".ut-button-group", this), this._lockPlayersBtn);
      }
    };
    const originalSquadActionsDestroyGeneratedElements =
      UTSquadActionsView.prototype.destroyGeneratedElements;
    UTSquadActionsView.prototype.destroyGeneratedElements = function (...args) {
      originalSquadActionsDestroyGeneratedElements.call(this, ...args);
      if (this._lockPlayersBtn) {
        this._lockPlayersBtn.destroy();
      }
    };
    const originalSetSquad = UTSquadActionsViewController.prototype.setSquad;
    UTSquadActionsViewController.prototype.setSquad = function (...args) {
      originalSetSquad.call(this, ...args);
      if (configuration.enabled && lockPlayersSettings.enabled) {
        this.getView()._squad = this._squad;
      }
    };
    const originalSubmitChallenge = UTSBCService.prototype.submitChallenge;
    UTSBCService.prototype.submitChallenge = function (...args) {
      if (configuration.enabled && lockPlayersSettings.enabled) {
        const submitResultObservable = new EAObservable();
        const challenge = args[0];
        function getLockedFieldPlayerItems() {
          return challenge.squad
            .getFieldPlayers()
            .map((slot) => slot.item)
            .filter((item) => isItemLocked(item) && item.utasPile !== ItemPile.STORAGE);
        }
        const lockedItems = getLockedFieldPlayerItems();
        if (lockedItems.length === 0) {
          return originalSubmitChallenge.call(this, ...args);
        } else {
          fetchUnassignedItems().then(async (unassignedItems) => {
            for (let unassignedItem of unassignedItems) {
              if (!unassignedItem.isPlayer()) {
                continue;
              }
              const matchingIndex = lockedItems.findIndex(
                (lockedItem) => lockedItem.definitionId === unassignedItem.definitionId,
              );
              if (-1 !== matchingIndex) {
                lockedItems.splice(matchingIndex, 1);
              }
            }
            if (lockedItems.length === 0) {
              let confirmMessage =
                translate("plugins.lockPlayers.duplicated.dialogText") + "<br /><br /><ul>";
              for (let item of getLockedFieldPlayerItems()) {
                confirmMessage += "<li>" + item.getStaticData().name + "</li>";
              }
              confirmMessage += "</ul>";
              showDialog(
                [
                  {
                    labelEnum: enums.UIDialogOptions.OK,
                  },
                  {
                    labelEnum: enums.UIDialogOptions.CANCEL,
                  },
                ],
                translate("plugins.lockPlayers.duplicated.dialogTitle"),
                confirmMessage,
                async (selectedOption) => {
                  if (selectedOption == enums.UIDialogOptions.OK) {
                    submitResultObservable.notify(
                      await observableToPromise(originalSubmitChallenge.call(this, ...args)),
                    );
                  }
                },
              );
            } else {
              var rejectedResponse = new UTServiceResponseDTO();
              rejectedResponse.status = HttpStatusCode.BAD_REQUEST;
              rejectedResponse.success = false;
              submitResultObservable.notify(rejectedResponse);
              let warningMessage = translate("plugins.lockPlayers.messages.sbcWarning");
              warningMessage += '<br /><br /><ul style="list-style-type:disc !important">';
              for (let item of lockedItems) {
                warningMessage += "<li>" + item.getStaticData().name + "</li>";
              }
              warningMessage += "</ul>";
              showErrorNotification(warningMessage);
            }
          });
          return submitResultObservable;
        }
      }
      return originalSubmitChallenge.call(this, ...args);
    };
    const originalResetRender = UTPlayerItemView.prototype.resetRender;
    UTPlayerItemView.prototype.resetRender = function (...args) {
      originalResetRender.call(this, ...args);
      if (configuration.enabled && lockPlayersSettings.enabled) {
        removeAttribute(this, "data-lockable-id");
        removeAttribute(this, "data-lock-override-id");
        removeClasses(this, "locked");
      }
    };
    const originalRenderItem = UTPlayerItemView.prototype.renderItem;
    UTPlayerItemView.prototype.renderItem = function (...args) {
      const item = args[0];
      const renderResult = originalRenderItem.call(this, ...args);
      if (configuration.enabled && lockPlayersSettings.enabled && item.definitionId > 0) {
        accessAttribute(this, "data-lockable-id", getItemLockKey(item));
        accessAttribute(this, "data-lock-override-id", getItemLockOverrideId(item));
        if (isItemLocked(item)) {
          addClasses(this, "locked");
        }
      }
      return renderResult;
    };
    const originalSetItems = UTClubSearchResultsView.prototype.setItems;
    UTClubSearchResultsView.prototype.setItems = function (...args) {
      originalSetItems.call(this, ...args);
      if (configuration.enabled && lockPlayersSettings.enabled && this.header) {
        (function (listRows, header, unusedArgument3) {
          if (header.lockPlayers) {
            header.lockPlayers.setInteractionState(listRows.length > 0);
            removeFromParentNode(header.lockPlayers);
          }
          const lockPlayersButton = new UTStandardButtonControl();
          addClasses(lockPlayersButton, "lock-players", "section-header-btn", "mini", "primary");
          lockPlayersButton.init();
          lockPlayersButton.setInteractionState(false);
          lockPlayersButton.setText(translate("plugins.lockPlayers.button.massLock"));
          lockPlayersButton.setInteractionState(listRows.length > 0);
          lockPlayersButton.addTarget(
            this,
            async () => {
              for (let row of listRows) {
                if (!row.data.isPlayer() || row.data.loans > -1) {
                  continue;
                }
                const isManuallyLocked = isItemManuallyLocked(row.data);
                const isLockedByRules = isItemLockedByRules(row.data);
                if (isManuallyLocked || isLockedByRules) {
                  removeClasses(row.itemComponent, "locked");
                  unlockItem(row.data);
                } else {
                  addClasses(row.itemComponent, "locked");
                  lockItem(row.data);
                }
              }
            },
            EventType.TAP,
          );
          appendElements(header, lockPlayersButton);
          header.lockPlayers = lockPlayersButton;
        })(this._list.listRows, this.header);
      }
    };
  },
  order: 11,
  settings: {
    name: "lock-players",
    title: "plugins.lockPlayers.settings.title",
    menu: function () {
      const container = document.createElement("div");
      upsertStylesheet("lock-players-settings", lockPlayersStyles);
      normalizeLockPlayersIdSetting("lockByNationIds");
      normalizeLockPlayersIdSetting("lockByLeagueIds");
      normalizeLockPlayersIdSetting("lockByTeamIds");
      normalizeLockPlayersIdSetting("lockByRarityIds");
      appendToggle(container, "enabled", lockPlayersSettings.enabled, (isEnabled) => {
        lockPlayersSettings.enabled = isEnabled;
        persistConfiguration();
      });
      appendElements(
        container,
        createLockPlayersDataProviderSelector(
          "plugins.lockPlayers.settings.lockByNation",
          "plugins.lockPlayers.settings.nation",
          "lockByNationIds",
          dataProviderType.Nation,
        ),
        createLockPlayersDataProviderSelector(
          "plugins.lockPlayers.settings.lockByLeague",
          "plugins.lockPlayers.settings.league",
          "lockByLeagueIds",
          dataProviderType.League,
        ),
        new DataProviderMultiSelectControl({
          type: dataProviderType.Team,
          ids: lockPlayersSettings.lockByTeamIds,
          label: translate("plugins.lockPlayers.settings.lockByClub"),
          placeholder: translate("plugins.lockPlayers.settings.club"),
          leagueLabel: translate("plugins.lockPlayers.settings.clubLeague"),
          selectLabel: translate("plugins.lockPlayers.settings.select"),
          onChange: persistConfiguration,
        }),
        createLockPlayersDataProviderSelector(
          "plugins.lockPlayers.settings.lockByRarity",
          "plugins.lockPlayers.settings.rarity",
          "lockByRarityIds",
          dataProviderType.Rarity,
          () =>
            getLocalizedRarities(false)
              .filter(
                (rarity) =>
                  rarity.id !== rarityIdByName.Common && rarity.id !== rarityIdByName.Rare,
              )
              .sort((left, right) => left.name.localeCompare(right.name))
              .map((rarity) => ({
                id: rarity.id,
                value: rarity.id,
                label: rarity.name,
              })),
        ),
      );
      return container;
    },
  },
};

export const lockPlayersPlugin = lockPlayersPluginDefinition;
