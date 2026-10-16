/**
 * Improved player search plugin `improvedPlayerSearchPlugin` (order 10), installed by the plugin
 * list in src/bootstrap/boot.js: replaces the search engine of `UTPlayerSearchControl` with an
 * accent-insensitive name search plus rating queries (`85`, `+85`, `-85`, `80-85`).
 *
 * Hooks:
 * - `UTPlayerSearchControl.prototype.init`, wrapped in `run()` (original first): when
 *   `configuration.enabled && improvedPlayerSearch.enabled`, sets `this.searchEngine` to a new
 *   `ImprovedPlayerSearchEngine`.
 *
 * Invariants:
 * - Each engine walks `repositories.Item.getStaticData()` and writes `cleanedFirstName`,
 *   `cleanedLastName` and `cleanedCommonName` onto those shared static-data objects.
 * - The engine replaces EA's with `getEntriesForString(text)` (at most 1 char returns []) and a
 *   no-op `dealloc()`; results sorted by rating desc, then name (name only for an exact rating).
 * - improved-filters keeps its options in the same settings object and shares `enabled`.
 *
 * Known issues (kept as-is):
 * - The settings toggle calls the undeclared `saveConfiguration()` (ReferenceError after the
 *   in-memory change); other plugins call `persistConfiguration`.
 * - A query such as `80-` leaves the matcher null and `filter(null)` throws.
 */
import { configuration } from "../../config/configuration.js";
import { removeDiacritics } from "../../core/diacritics.js";
import { appendToggle } from "../../ui/settings-controls.js";

let improvedPlayerSearchPluginDefinition;

const improvedPlayerSearchSettings = configuration.plugins.improvedPlayerSearch;

improvedPlayerSearchPluginDefinition = {
  run: function () {
    function ImprovedPlayerSearchEngine() {
      this._players = repositories.Item.getStaticData();
      for (const player of this._players) {
        player.cleanedLastName = removeDiacritics(player.lastName);
        player.cleanedFirstName = removeDiacritics(player.firstName);
        player.cleanedCommonName = player.commonName
          ? removeDiacritics(player.commonName)
          : player.commonName;
      }
    }
    ImprovedPlayerSearchEngine.prototype.getEntriesForString = function (searchText) {
      if (searchText.length <= 1) {
        return [];
      }
      searchText = removeDiacritics(searchText.trim().toLowerCase());
      let matchesPlayer = null;
      let comparePlayers = null;
      let compareByName = (left, right) => {
        let leftName = left.commonName ? left.commonName : left.firstName + left.lastName;
        let rightName = right.commonName ? right.commonName : right.firstName + right.lastName;
        return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
      };
      comparePlayers = (left, right) =>
        left.rating === right.rating ? compareByName(left, right) : right.rating - left.rating;
      if (Number.isNaN(parseInt(searchText))) {
        matchesPlayer = (player) =>
          player.cleanedLastName.toLowerCase().indexOf(searchText) > -1 ||
          player.cleanedFirstName.toLowerCase().indexOf(searchText) > -1 ||
          (player.commonName &&
            (player.cleanedCommonName.toLowerCase().indexOf(searchText) > -1 ||
              player.commonName.toLowerCase().indexOf(searchText) > -1)) ||
          (player.cleanedFirstName + " " + player.cleanedLastName)
            .toLowerCase()
            .indexOf(searchText) > -1;
      } else if (searchText.indexOf("-") > 1) {
        const parts = searchText.split("-", 2);
        const minRating = parseInt(parts[0]);
        const maxRating = parseInt(parts[1]);
        if (!(parts.length !== 2 || Number.isNaN(minRating) || Number.isNaN(maxRating))) {
          matchesPlayer = (player) => player.rating >= minRating && player.rating <= maxRating;
        }
      } else {
        let rating = Math.abs(parseInt(searchText));
        if (searchText.charAt(0) === "+") {
          matchesPlayer = (player) => player.rating >= rating;
        } else if (searchText.charAt(0) === "-") {
          matchesPlayer = (player) => player.rating <= rating;
        } else {
          matchesPlayer = (player) => player.rating == rating;
          comparePlayers = compareByName;
        }
      }
      return this._players.filter(matchesPlayer).sort(comparePlayers);
    };
    ImprovedPlayerSearchEngine.prototype.dealloc = function () {};
    const originalInit = UTPlayerSearchControl.prototype.init;
    UTPlayerSearchControl.prototype.init = function () {
      originalInit.call(this);
      if (configuration.enabled && improvedPlayerSearchSettings.enabled) {
        this.searchEngine = new ImprovedPlayerSearchEngine();
      }
    };
  },
  order: 10,
  settings: {
    name: "improved-player-search",
    title: "plugins.improvedPlayerSearch.settings.title",
    menu: function () {
      const menuContainer = document.createElement("div");
      appendToggle(menuContainer, "enabled", improvedPlayerSearchSettings.enabled, (isEnabled) => {
        improvedPlayerSearchSettings.enabled = isEnabled;
        saveConfiguration();
      });
      return menuContainer;
    },
  },
};

export const improvedPlayerSearchPlugin = improvedPlayerSearchPluginDefinition;
