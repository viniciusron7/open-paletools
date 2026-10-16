/**
 * Import SBC plugin (order 3), installed by the plugin list in src/bootstrap/boot.js: an "import
 * SBC" button (`#import-sbc-button`, shortcut `importSbc`) on the SBC squad detail panel that
 * fills the challenge from a solution copied to the clipboard by the bookmarklet offered on the
 * settings page (FUTBIN / EasySBC solution pages).
 *
 * Hooks (installed in `run()`):
 * - `UTSBCSquadDetailPanelView._generate` (after the original; when Paletools and the plugin are
 *   enabled, once via `_importSbcCalled`) and `destroyGeneratedElements` (clears the shortcut
 *   action, destroys the button). Stylesheet `paletools-import-sbc` is always injected.
 *
 * Invariants:
 * - Clipboard format, shared with the bookmarklet: JSON array of `[positionName, definitionId]`,
 *   reversed on import; positions match `slot.position.typeName`, the rest fill empty slots.
 * - Players come from SBC storage first, then owned club players (`findOwnedClubPlayers`, cache
 *   bypassed), then concept items; the challenge is saved and the unassigned/transfer repository
 *   expiry reset.
 * - The bookmarklet embeds `APP_YEAR_SHORT` in FUTBIN class names and is offered as a
 *   `javascript:eval(atob(...))` link. The single shortcut action targets the last panel.
 *
 * Known issues (kept as-is):
 * - The clipboard promise never settles when the permission is denied or `readText` rejects, and
 *   a JSON parse error rejects without a handler; the button then stays disabled on the loading
 *   text.
 * - The settings toggle calls the undeclared global `saveConfiguration()`, which throws a
 *   ReferenceError after the in-memory flag changed, so the change is not persisted.
 */
import { findOwnedClubPlayers } from "../../club/club-players-cache.js";
import { findConceptItemByDefinitionId } from "../../club/concept-items.js";
import { configuration } from "../../config/configuration.js";
import { accessAttribute, appendElements, queryElement } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { LabelWithLinkControl } from "../../ui/controls/label-with-link-control.js";
import {
  isSearchFilterDropdownOpen,
  registerKeyboardShortcut,
} from "../../ui/keyboard-shortcuts.js";
import { showErrorNotification } from "../../ui/notifications.js";
import { appendToggle, translateLabel } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { searchSbcStorageItems } from "../../webapp/item-piles.js";
import { getActiveController, getLeftController } from "../../webapp/navigation.js";
import importSbcCss from "./import-sbc.css";

let importSbcPluginDefinition;

const importSbcSettings = configuration.plugins.importSbc;

importSbcPluginDefinition = {
  run: function () {
    let importSbcFromClipboard;
    registerKeyboardShortcut(
      "importSbc",
      () => configuration.plugins.snipe.buttons.sbc.importSbc,
      (keyCode) => (configuration.plugins.snipe.buttons.sbc.importSbc = keyCode),
      "plugins.importSbc.button.text",
      () => importSbcFromClipboard && !isSearchFilterDropdownOpen() && importSbcFromClipboard(),
      "#import-sbc-button",
    );
    const originalGenerate = UTSBCSquadDetailPanelView.prototype._generate;
    UTSBCSquadDetailPanelView.prototype._generate = function () {
      originalGenerate.call(this);
      if (configuration.enabled && importSbcSettings.enabled && !this._importSbcCalled) {
        importSbcFromClipboard = () => {
          if (this.getRootElement()) {
            this._importSbcButton.setInteractionState(false);
            this._importSbcButton.setText(translate("loadingPlayers").replace("{count}", ""));
            (async function (unusedArgument1) {
              const importedPlayers = await new Promise((resolve, reject) => {
                navigator.permissions
                  .query({
                    name: "clipboard-read",
                  })
                  .then((permissionStatus) => {
                    if (
                      !(permissionStatus.state !== "granted" && permissionStatus.state !== "prompt")
                    ) {
                      navigator.clipboard.readText().then((clipboardText) => {
                        try {
                          let parsedPlayers = JSON.parse(clipboardText);
                          resolve(parsedPlayers.reverse());
                        } catch {
                          showErrorNotification(translate("plugins.importSbc.copyError"));
                          reject();
                        }
                      });
                    }
                  });
              });
              let importedItems = importedPlayers.map((importedPlayer) =>
                factories.Item.createItem({
                  resourceId: parseInt(importedPlayer[1]),
                }),
              );
              const { _squad: squad, _challenge: challenge } =
                getLeftController(getActiveController());
              let itemsByDefinitionId = {};
              const storageSearchResult = await searchSbcStorageItems();
              if (storageSearchResult.success) {
                const storageItemsByDefinitionId = (function (
                  items,
                  getKey,
                  getValue = (item) => item,
                ) {
                  const itemsByKey = {};
                  for (let item of items) {
                    itemsByKey[getKey(item)] = getValue(item);
                  }
                  return itemsByKey;
                })(storageSearchResult.response.items, (item) => item.definitionId);
                for (let item of importedItems) {
                  if (storageItemsByDefinitionId[item.definitionId]) {
                    itemsByDefinitionId[item.definitionId] =
                      storageItemsByDefinitionId[item.definitionId];
                  }
                }
                importedItems = importedItems.filter(
                  (item) => !itemsByDefinitionId[item.definitionId],
                );
              }
              itemsByDefinitionId = {
                ...itemsByDefinitionId,
                ...(await findOwnedClubPlayers(importedItems, 0, true, true)),
              };
              let missingDefinitionIds = importedItems
                .filter((item) => !itemsByDefinitionId[item.definitionId])
                .map((item) => item.definitionId);
              const fetchedItems = await (function (definitionIds) {
                let pendingSearches = [];
                for (let definitionId of definitionIds) {
                  pendingSearches.push(findConceptItemByDefinitionId(definitionId));
                }
                return Promise.all(pendingSearches);
              })(missingDefinitionIds);
              for (let item of fetchedItems) {
                itemsByDefinitionId[item.definitionId] = item;
              }
              const slotIndexesByPosition = {};
              for (let slot of squad.getSBCSlots()) {
                if (slot.position) {
                  if (!slotIndexesByPosition[slot.position.typeName]) {
                    slotIndexesByPosition[slot.position.typeName] = [];
                  }
                  slotIndexesByPosition[slot.position.typeName].push(slot.index);
                }
              }
              const squadPlayers = new Array(23);
              const unplacedPlayers = [];
              for (; importedPlayers.length > 0; ) {
                const importedPlayer = importedPlayers.shift();
                if (
                  slotIndexesByPosition[importedPlayer[0]] &&
                  slotIndexesByPosition[importedPlayer[0]].length !== 0
                ) {
                  squadPlayers[slotIndexesByPosition[importedPlayer[0]].shift()] =
                    itemsByDefinitionId[importedPlayer[1]];
                } else {
                  unplacedPlayers.push(importedPlayer);
                }
              }
              if (unplacedPlayers.length > 0) {
                for (
                  let slotIndex = 0;
                  slotIndex < squadPlayers.length && unplacedPlayers.length > 0;
                  slotIndex++
                ) {
                  if (squadPlayers[slotIndex]) {
                    continue;
                  }
                  let item = itemsByDefinitionId[unplacedPlayers.shift()[1]];
                  squadPlayers[slotIndex] = item;
                }
              }
              squad.setPlayers(squadPlayers, true);
              services.SBC.saveChallenge(challenge);
              repositories.Item.unassigned.expiryTimestamp = 0;
              repositories.Item.transfer.expiryTimestamp = 0;
            })().then(() => {
              this._importSbcButton.setInteractionState(true);
              this._importSbcButton.setText(translate("plugins.importSbc.button.text"));
            });
          }
        };
        this._importSbcButton = new UTStandardButtonControl();
        this._importSbcButton.init();
        this._importSbcButton.setText(translate("plugins.importSbc.button.text"));
        this._importSbcButton.addTarget(this, importSbcFromClipboard, EventType.TAP);
        accessAttribute(this._importSbcButton, "id", "import-sbc-button");
        appendElements(
          queryElement(".sbc-button-container", this.__content),
          this._importSbcButton,
        );
        this._importSbcCalled = true;
      }
    };
    const originalDestroyGeneratedElements =
      UTSBCSquadDetailPanelView.prototype.destroyGeneratedElements;
    UTSBCSquadDetailPanelView.prototype.destroyGeneratedElements = function () {
      originalDestroyGeneratedElements.call(this);
      importSbcFromClipboard = null;
      if (this._importSbcButton) {
        this._importSbcButton.destroy();
      }
    };
    upsertStylesheet("paletools-import-sbc", importSbcCss);
  },
  order: 3,
  settings: {
    name: "import-sbc",
    title: "plugins.importSbc.settings.title",
    menu: function () {
      const menuContainer = document.createElement("div");
      appendToggle(menuContainer, "enabled", importSbcSettings.enabled, (isEnabled) => {
        importSbcSettings.enabled = isEnabled;
        saveConfiguration();
      });
      const bookmarkletSource =
        "\n(function() {\n\tfunction copyToClipboard(str) {\n\t\tconst el = document.createElement('textarea');\n\t\tel.value = str;\n\t\tel.setAttribute('readonly', '');\n\t\tel.style.position = 'absolute';\n\t\tel.style.left = '-9999px';\n\t\tdocument.body.appendChild(el);\n\t\tel.select();\n\t\tdocument.execCommand('copy');\n\t\tdocument.body.removeChild(el);\n\t}\n\tfunction copySbcToClipboard() {\n\t\tlet isFutbinUrl = /https\\:\\/\\/www.futbin.com\\/\\d+\\/squad\\/\\d+\\/sbc/.test(location.href);\n        let isEasySbcUrl = location.href.indexOf(\"easysbc.io/sbc-solution\") > -1;\n        let isSbcUrl = isFutbinUrl || isEasySbcUrl;\n\t\tif (!isSbcUrl) {\n\t\t\talert(\"========== PALETOOLS ALERT ==========\\n\\nYou need to be in an SBC solution for this tool to work!\\n\\n========================================\\n\\n¡Usted necesita estar en una solución de SBC para que funcione esta herramienta!\");\n\t\t\treturn;\n\t\t}\n\t\tlet data = [];\n        if(isFutbinUrl){\n            const futbinRegex = /\\/(\\d+)\\.png/;\n            const playersDivs = document.getElementsByClassName(\"playercard-field\");\n            for(let playerDiv of playersDivs){\n                let playerImg = playerDiv.getElementsByClassName(\"playercard-" +
        APP_YEAR_SHORT +
        '-base-img");\n                if(playerImg.length === 0){\n                    playerImg = playerDiv.getElementsByClassName("playercard-' +
        APP_YEAR_SHORT +
        '-special-img");\n                }\n                if(playerImg.length === 0) continue;\n                playerImg = playerImg[0];\n                const idRegexp = playerImg.src.match(futbinRegex);\n                const playerId = idRegexp ? idRegexp[1] : null;\n                const position = playerDiv.getElementsByClassName("playercard-' +
        APP_YEAR_SHORT +
        '-position")[0].innerText;\n                if(playerId && position){\n                    data.push([position, parseInt(playerId)]);\n                }\n            }\n        }\n        else if(isEasySbcUrl){\n            const regex = /\\/(\\d+)\\.png$/;\n            const players = document.getElementsByClassName("playerview");\n            for(let player of players){\n                let position = player.getElementsByClassName("original_pos");\n                 if(position.length === 0){\n                      position = player.getElementsByClassName("original_pos_yellow");\n                 }\n                 let playerPos = "";\n                 if(position.length > 0) {\n                    playerPos = position[0].innerText;\n                 }\n                 \n                 let definitionId = 0;\n                 const playerImage = player.getElementsByClassName("player_card_bg");\n                 if(playerImage.length === 0) continue;\n    \n                const match = playerImage[0].src.match(regex);\n                if (match) {\n                    definitionId = parseInt(match[1]);\n                } else {\n                    continue;\n                }\n                data.push([playerPos, definitionId]);\n            }\n        }\n\t\tcopyToClipboard(JSON.stringify(data));\n\t\talert("========== PALETOOLS ==========\\n\\nSBC succesfully exported, now go to Paletools and hit import SBC button\\n\\n========================================\\n\\nSBC exportado correctamente, ahora ve a Paletools y presiona el boton importar SBC");\n\t}\n\tcopySbcToClipboard();\n})()\n';
      (function (container, unusedArgument2, unusedArgument3, linkUrl) {
        const exportLinkControl = new LabelWithLinkControl();
        exportLinkControl.setLabel(translateLabel("plugins.importSbc.settings.exportLabel"));
        exportLinkControl.setLinkText(translateLabel("plugins.importSbc.settings.exportLink"));
        exportLinkControl.setLinkUrl(linkUrl);
        appendElements(container, exportLinkControl);
      })(menuContainer, 0, 0, "javascript:eval(atob('" + btoa(bookmarkletSource) + "'))");
      const installInstructions = document.createElement("div");
      installInstructions.classList.add("install-instructions");
      installInstructions.innerHTML = translate("plugins.importSbc.settings.installInstructions");
      menuContainer.appendChild(installInstructions);
      return menuContainer;
    },
  },
};

export const importSbcPlugin = importSbcPluginDefinition;
