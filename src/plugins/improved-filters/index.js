/**
 * Improved filters plugin `improvedFiltersPlugin` (order 10), installed by the plugin list in
 * src/bootstrap/boot.js: multi-column filter dropdowns (stylesheet `paletools-gridfilters`),
 * important leagues/nations first in the LEAGUE/NATION filters, and owned-player counts prefixed
 * to the CLUB filter options in SBC contexts.
 *
 * Hooks (installed in `run()`):
 * - `UTItemSearchView.prototype.setFilters`: stores `args[0].searchCriteria` on the view BEFORE
 *   the original (`generateFilter` reads it).
 * - `UTItemSearchView.prototype.generateFilter`: sorts LEAGUE/NATION options in place
 *   (`[-1, ...important ids]` first, then by label) before the original; for CLUB with
 *   `searchCriteria.league > -1` in an SBC context it counts club players per team
 *   (`searchClubPlayers`) and rewrites the rendered labels to `(count) - label` afterwards.
 *
 * Invariants:
 * - Settings live in `configuration.plugins.improvedPlayerSearch`, the object (and `enabled`
 *   flag) of improved-player-search: `gridFilters`, `orderByImportantLeagues`,
 *   `orderByImportantNations`, `countClubPlayers`.
 * - Club options are matched by text (`option.label` on phones, list item `textContent` else).
 * - `isImprovedFiltersGridStyleApplied` guards the stylesheet; turning `gridFilters` off removes
 *   it and resets the guard.
 *
 * Known issues (kept as-is):
 * - `enabled` only gates the grid stylesheet at startup; ordering and club counts ignore it and
 *   `configuration.enabled`.
 * - `playersByCriteria.get(key) || new Map()` is never stored back, so the club search runs on
 *   every CLUB filter generation (the cached synchronous path is dead).
 * - `orderByImportantNations` has no toggle in the menu; `_challengeId` is tested twice.
 */
import { searchClubPlayers } from "../../club/club-search.js";
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { removeStylesheet, upsertStylesheet } from "../../ui/stylesheets.js";
import { getImportantLeagueIds, getImportantNationIds } from "../../webapp/leagues-and-nations.js";
import { getActiveController } from "../../webapp/navigation.js";
import gridfiltersCss from "./gridfilters.css";

let improvedFiltersPluginDefinition;

const improvedFiltersPlayerSearchSettings = configuration.plugins.improvedPlayerSearch;

let isImprovedFiltersGridStyleApplied = false;

function applyImprovedFiltersGridStyle() {
  if (!isImprovedFiltersGridStyleApplied) {
    upsertStylesheet("paletools-gridfilters", gridfiltersCss);
    isImprovedFiltersGridStyleApplied = true;
  }
}

improvedFiltersPluginDefinition = {
  run: function () {
    if (
      improvedFiltersPlayerSearchSettings.enabled &&
      improvedFiltersPlayerSearchSettings.gridFilters
    ) {
      applyImprovedFiltersGridStyle();
    }
    const originalSetFilters = UTItemSearchView.prototype.setFilters;
    UTItemSearchView.prototype.setFilters = function (...args) {
      const firstSetFiltersArgument = args[0];
      this.searchCriteria = firstSetFiltersArgument.searchCriteria;
      originalSetFilters.call(this, ...args);
    };
    const originalGenerateFilter = UTItemSearchView.prototype.generateFilter;
    UTItemSearchView.prototype.generateFilter = function (...args) {
      const searchView = this;
      const filterOptions = args[1];
      if (
        improvedFiltersPlayerSearchSettings.orderByImportantLeagues &&
        args[0] === enums.UISearchFilters.LEAGUE
      ) {
        const leagueIdOrder = [-1, ...getImportantLeagueIds()];
        filterOptions.sort((left, right) => {
          const leftIndex = leagueIdOrder.indexOf(left.id);
          const rightIndex = leagueIdOrder.indexOf(right.id);
          return -1 !== leftIndex && -1 !== rightIndex
            ? leftIndex - rightIndex
            : -1 !== leftIndex
              ? -1
              : -1 !== rightIndex
                ? 1
                : left.label.localeCompare(right.label);
        });
      }
      if (
        improvedFiltersPlayerSearchSettings.orderByImportantNations &&
        args[0] === enums.UISearchFilters.NATION
      ) {
        const nationIdOrder = [-1, ...getImportantNationIds()];
        filterOptions.sort((left, right) => {
          const leftIndex = nationIdOrder.indexOf(left.id);
          const rightIndex = nationIdOrder.indexOf(right.id);
          return -1 !== leftIndex && -1 !== rightIndex
            ? leftIndex - rightIndex
            : -1 !== leftIndex
              ? -1
              : -1 !== rightIndex
                ? 1
                : left.label.localeCompare(right.label);
        });
      }
      if (
        improvedFiltersPlayerSearchSettings.countClubPlayers &&
        args[0] === enums.UISearchFilters.CLUB &&
        this.searchCriteria?.league > -1
      ) {
        this.playersByCriteria = this.playersByCriteria || new Map();
        if (
          !(
            (currentController = getActiveController()).challengeId ||
            currentController._challengeId ||
            currentController.challenge ||
            currentController._challengeId
          )
        ) {
          return void originalGenerateFilter.call(this, ...args);
        }
        const criteriaKey = JSON.stringify(this.searchCriteria);
        const playerCountByTeamId = searchView.playersByCriteria.get(criteriaKey) || new Map();
        function prefixClubOptionsWithPlayerCount() {
          const playerCountByLabel = new Map();
          for (const option of filterOptions) {
            playerCountByLabel.set(option.label, playerCountByTeamId.get(option.id) || 0);
          }
          if (isPhone()) {
            const dropDownElement = searchView.searchFilters.get("club").getDropDownElement();
            for (const option of dropDownElement.options) {
              const playerCount = playerCountByLabel.get(option.label) || 0;
              option.label = "(" + playerCount + ") - " + option.label + " ";
            }
          } else {
            const childNodes = searchView.searchFilters.get("club").__list.childNodes;
            for (const listItem of childNodes) {
              const playerCount = playerCountByLabel.get(listItem.textContent) || 0;
              listItem.textContent = "(" + playerCount + ") - " + listItem.textContent + " ";
            }
          }
        }
        if (playerCountByTeamId.size > 0) {
          prefixClubOptionsWithPlayerCount();
        } else {
          searchClubPlayers(false, null, null, this.searchCriteria, true).then((players) => {
            for (let player of players) {
              if (player.teamId && -1 !== player.teamId) {
                playerCountByTeamId.set(
                  player.teamId,
                  (playerCountByTeamId.get(player.teamId) || 0) + 1,
                );
              }
            }
            prefixClubOptionsWithPlayerCount();
          });
        }
      }
      var currentController;
      originalGenerateFilter.call(this, ...args);
    };
  },
  order: 10,
  settings: {
    name: "improved-filters",
    title: "plugins.improvedFilters.settings.title",
    menu: function () {
      const menuContainer = document.createElement("div");
      appendToggle(
        menuContainer,
        "enabled",
        improvedFiltersPlayerSearchSettings.enabled,
        (isEnabled) => {
          improvedFiltersPlayerSearchSettings.enabled = isEnabled;
          persistConfiguration();
        },
      );
      appendToggle(
        menuContainer,
        "plugins.improvedFilters.countClubPlayers",
        improvedFiltersPlayerSearchSettings.countClubPlayers,
        (countClubPlayers) => {
          improvedFiltersPlayerSearchSettings.countClubPlayers = countClubPlayers;
          persistConfiguration();
        },
      );
      appendToggle(
        menuContainer,
        "plugins.improvedFilters.orderByImportantLeagues",
        improvedFiltersPlayerSearchSettings.orderByImportantLeagues,
        (orderByImportantLeagues) => {
          improvedFiltersPlayerSearchSettings.orderByImportantLeagues = orderByImportantLeagues;
          persistConfiguration();
        },
      );
      appendToggle(
        menuContainer,
        "plugins.improvedFilters.gridFilters",
        improvedFiltersPlayerSearchSettings.gridFilters,
        (gridFilters) => {
          improvedFiltersPlayerSearchSettings.gridFilters = gridFilters;
          persistConfiguration();
          if (gridFilters) {
            applyImprovedFiltersGridStyle();
          } else {
            isImprovedFiltersGridStyleApplied = false;
            removeStylesheet("paletools-gridfilters");
          }
        },
      );
      return menuContainer;
    },
  },
};

export const improvedFiltersPlugin = improvedFiltersPluginDefinition;
