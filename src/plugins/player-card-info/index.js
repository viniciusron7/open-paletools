/**
 * Player Card Info plugin (`playerCardInfoPlugin`, order 100), installed by the plugin list in
 * src/bootstrap/boot.js: decorates player item views with alternate positions, skill moves and
 * weak foot, untradeable and SBC-storage badges, a pristine marker, a league badge and the item
 * count, and highlights important leagues and nations.
 *
 * Hooks (installed in `run()`):
 * - `UTPlayerItemView.prototype.renderItem` (after original; only for `definitionId > 0`; the
 *   second argument's `getExpColorMap(tier)` gives the badge colors).
 * - `UTPlayerItemView.prototype.renderPosition` (pass-through wrapper, adds nothing).
 *
 * Invariants:
 * - Elements are found-or-created by class inside `this.__mainViewDiv` (`untradeable`, `league`,
 *   `right-column-info`, `storage`, `player-count`) so re-renders reuse them; the content of
 *   `right-column-info` (alternative positions, `stars`, `skill-moves`, `weak-foot`) is cleared
 *   and rebuilt on every render; styled by player-card-info.css (id
 *   `paletools-player-card-info`).
 * - The league badge text is `global.leagueabbr5.<APP_YEAR>.league<leagueId>`; its
 *   `league-<id>` class is matched by the `#paletools-player-card-info-league` <style> (color
 *   from `plugins.importantLeagues.color`); nations use `#paletools-player-card-info-nation`.
 * - The important-league/nation styles are built only if the plugin is enabled at boot, and
 *   rebuilt on every `CONFIGURATION_SAVED`.
 * - Settings `plugins.playerCardInfo.{enabled, alternatePositions, skillMoves, weakFoot,
 *   untradeable, pristine, league, importantLeague, workrates}`.
 *
 * Known issues (kept as-is):
 * - Turning `importantNation` off removes `#paletools-players-card-info-nation` (typo), and both
 *   styles are rebuilt whenever either flag is on, so neither can be disabled on its own.
 * - The menu has a `workrates` toggle that is never read and no `importantNation` toggle (which
 *   has no default either).
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import {
  addClasses,
  appendElements,
  createElement,
  findOrCreateElement,
  getDomElement,
  hasClass,
  queryElement,
  removeClasses,
  removeFromParentNode,
} from "../../core/dom.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { getPageWindow } from "../../core/page-window.js";
import { translate } from "../../i18n/translations.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { isSbcStorageItem } from "../../webapp/item-piles.js";
import { getImportantLeagueIds, getImportantNationIds } from "../../webapp/leagues-and-nations.js";
import playerCardInfoCss from "./player-card-info.css";

let playerCardInfoPluginDefinition;

const playerCardInfoSettings = configuration.plugins.playerCardInfo;

playerCardInfoPluginDefinition = {
  run: function () {
    if (configuration.enabled && playerCardInfoSettings.enabled) {
      function applyImportantLeagueNationStyles() {
        if (!playerCardInfoSettings.importantLeague) {
          removeFromParentNode(queryElement("#paletools-player-card-info-league"));
        }
        if (!playerCardInfoSettings.importantNation) {
          removeFromParentNode(queryElement("#paletools-players-card-info-nation"));
        }
        if (!playerCardInfoSettings.importantLeague && !playerCardInfoSettings.importantNation) {
          return;
        }
        const leagueSelectors = [];
        for (let leagueId of getImportantLeagueIds()) {
          leagueSelectors.push(".league.league-" + leagueId);
        }
        const nationSelectors = [];
        for (let nationId of getImportantNationIds()) {
          nationSelectors.push(".nation.nation-" + nationId);
        }
        const leagueStyle =
          queryElement("#paletools-player-card-info-league") ||
          createElement("style", {
            id: "paletools-player-card-info-league",
          });
        leagueStyle.textContent =
          leagueSelectors.join(",") +
          " { font-weight: bold; " +
          (configuration.plugins.importantLeagues.color
            ? "background-color: " + configuration.plugins.importantLeagues.color + " !important;"
            : "") +
          " }";
        if (!document.head.contains(leagueStyle)) {
          document.head.appendChild(leagueStyle);
        }
        const nationStyle =
          queryElement("#paletools-player-card-info-nation") ||
          createElement("style", {
            id: "paletools-player-card-info-nation",
          });
        nationStyle.textContent = nationSelectors.join(",") + " { font-weight: bold; }";
        if (!document.head.contains(nationStyle)) {
          document.head.appendChild(nationStyle);
        }
      }
      listenForEvent(paletoolsEvents.CONFIGURATION_SAVED, () => {
        applyImportantLeagueNationStyles();
      });
      applyImportantLeagueNationStyles();
    }
    const originalRenderPosition = UTPlayerItemView.prototype.renderPosition;
    UTPlayerItemView.prototype.renderPosition = function (...args) {
      originalRenderPosition.call(this, ...args);
      const [unusedFirstArgument, unusedSecondArgument] = args;
    };
    const originalRenderItem = UTPlayerItemView.prototype.renderItem;
    UTPlayerItemView.prototype.renderItem = function (...args) {
      const player = args[0];
      const secondRenderItemArgument = args[1];
      const renderResult = originalRenderItem.call(this, ...args);
      if (configuration.enabled && playerCardInfoSettings.enabled && player.definitionId > 0) {
        const expColorMap = secondRenderItemArgument.getExpColorMap(player.getTier());
        const header = expColorMap.header;
        const background = expColorMap.background;
        const color = "rgba(" + header.r + "," + header.g + "," + header.b + ",1)";
        const backgroundColor =
          "rgba(" + background.r + "," + background.g + "," + background.b + ",0.9)";
        if (playerCardInfoSettings.untradeable && !player.tradable) {
          findOrCreateElement(".untradeable", this.__mainViewDiv, () =>
            createElement("div", {
              className: "untradeable",
            }),
          );
        }
        if (playerCardInfoSettings.pristine && player.owners === 1 && -1 === player.loans) {
          addClasses(this, "pristine-player");
        }
        if (hasClass(this.__ownershipBadge, "hyper-rare-sticker")) {
          this.__ownershipBadge.style.backgroundColor = backgroundColor;
          this.__ownershipBadge.style.border = "1px solid " + color;
        }
        if (playerCardInfoSettings.league) {
          const leagueBadge = findOrCreateElement(".league", this.__mainViewDiv, () =>
            createElement("div"),
          );
          leagueBadge.className = "";
          addClasses(leagueBadge, "league");
          leagueBadge.textContent = (function (leagueId) {
            return translate(
              "global.leagueabbr5." + getPageWindow().APP_YEAR + ".league" + leagueId,
            );
          })(player.leagueId);
          addClasses(leagueBadge, "league-" + player.leagueId);
          (function (elementOrView, styleProperties) {
            const domElement = getDomElement(elementOrView);
            Object.assign(domElement.style, styleProperties);
          })(leagueBadge, {
            color: color,
            border: "1px solid " + color,
            background: backgroundColor,
          });
        }
        const rightColumnInfo = findOrCreateElement(".right-column-info", this.__mainViewDiv, () =>
          createElement("div", {
            className: "right-column-info",
            style:
              "color: " + color + ";border: 1px solid " + color + ";background: " + backgroundColor,
          }),
        );
        rightColumnInfo.innerHTML = "";
        if (playerCardInfoSettings.alternatePositions) {
          for (let position of player.possiblePositions || []) {
            if (player.preferredPosition !== position) {
              appendElements(
                rightColumnInfo,
                createElement(
                  "div",
                  {
                    className: "alternative-position info-tab",
                  },
                  ((positionId = position),
                  UTLocalizationUtil.positionIdToName(positionId, services.Localization)),
                ),
              );
            }
          }
        }
        if (playerCardInfoSettings.skillMoves || playerCardInfoSettings.weakFoot) {
          const starsContainer = findOrCreateElement(".stars", rightColumnInfo, () =>
            createElement("div", {
              className: "stars info-tab",
            }),
          );
          if (playerCardInfoSettings.skillMoves) {
            findOrCreateElement(".skill-moves", starsContainer, () =>
              createElement("span", {
                className: "skill-moves",
              }),
            ).innerHTML = player.getSkillMoves();
          }
          if (playerCardInfoSettings.weakFoot) {
            const weakFootLabel = player.isLeftFoot()
              ? translate("cards.cardfront.weakFootRightAbbr")
              : translate("cards.cardfront.weakFootLeftAbbr");
            const weakFootElement = findOrCreateElement(".weak-foot", starsContainer, () =>
              createElement("span", {
                className: "weak-foot",
              }),
            );
            weakFootElement.innerHTML = weakFootLabel + " " + player.getWeakFoot();
            if (player.isLeftFoot()) {
              addClasses(weakFootElement, "weak-foot-left");
            } else {
              removeClasses(weakFootElement, "weak-foot-left");
            }
          }
        }
        if (isSbcStorageItem(player)) {
          findOrCreateElement(".storage", this.__mainViewDiv, () =>
            createElement("div", {
              className: "storage",
            }),
          ).style.backgroundImage = 'url("images/SearchFilters/players_storage.png")';
        }
        if (player.count && player.count > 1) {
          findOrCreateElement(".player-count", this.__mainViewDiv, () =>
            createElement("div", {
              className: "player-count",
            }),
          ).textContent = player.count;
        }
      }
      var positionId;
      return renderResult;
    };
    upsertStylesheet("paletools-player-card-info", playerCardInfoCss);
  },
  order: 100,
  settings: {
    name: "player-card-info",
    title: "plugins.playerCardInfo.settings.title",
    menu: function () {
      const container = document.createElement("div");
      [
        "enabled",
        "alternatePositions",
        "skillMoves",
        "weakFoot",
        "untradeable",
        "pristine",
        "league",
        "importantLeague",
        "workrates",
      ].forEach((settingKey) => {
        appendToggle(
          container,
          settingKey === "enabled" ? settingKey : "plugins.playerCardInfo.settings." + settingKey,
          playerCardInfoSettings[settingKey],
          (isEnabled) => {
            playerCardInfoSettings[settingKey] = isEnabled;
            persistConfiguration();
          },
        );
      });
      return container;
    },
  },
};

export const playerCardInfoPlugin = playerCardInfoPluginDefinition;
