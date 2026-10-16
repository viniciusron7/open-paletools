/**
 * Club search enhancer plugin `clubSearchEnhancerPlugin` (order 6), installed by the plugin list
 * in src/bootstrap/boot.js: adds "tradeables only", "hide loans" and "hide locked" toggles to the
 * club search filters and stores the choices in the search criteria.
 *
 * Hooks (installed in `run()`, unconditionally):
 * - `UTClubSearchFiltersView.prototype.setupSearchOptions` (original first): adds toggle cells
 *   `sort-tradeable` (if `includeUntradeableToggle`), `filter-loans` (outside SBC context) and
 *   `filter-locked`, restoring loans/locked from the active controller's `searchCriteria`.
 * - Adds `turnOffToggle` to the `UTMyClubSearchFiltersViewController` and
 *   `UTClubSearchFiltersViewController` prototypes.
 * - `UTClubSearchFiltersViewController.onSortToggleChanged` and
 *   `UTMyClubSearchFiltersViewController.onSortToggleSelected` (original first): write
 *   `hideLoans`/`hideLocked`, set `untradeables = EXCLUDE` for `sort-tradeable` and keep it
 *   mutually exclusive with EA's `sort-untradeable`.
 *
 * Invariants:
 * - `hideLoans`/`hideLocked` are custom criteria fields read by the club search code
 *   (src/webapp/patches.js, src/club/club-index.js).
 * - The config key and ids keep the typo: `plugins.clubSearchEnhacer`, stylesheet
 *   `club-search-enhacer-styles`, settings name `club-search-enhacer`.
 *
 * Known issues (kept as-is):
 * - `run()` never checks `clubSearchEnhacer.enabled`; the settings toggle has no effect.
 * - `searchCriteria.untradeables; SearchUntradeables.EXCLUDE;` are no-op statements, so the
 *   initial state of `sort-tradeable` is never restored.
 * - Unchecking `sort-tradeable` still sets `untradeables = EXCLUDE`.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { addClasses } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { findControllerProperty, getActiveController } from "../../webapp/navigation.js";
import clubSearchEnhacerStylesCss from "./club-search-enhacer-styles.css";

let clubSearchEnhancerPluginDefinition;

const clubSearchEnhancerSettings = configuration.plugins.clubSearchEnhacer;

function createClubSearchEnhancerSettingsMenu() {
  const container = document.createElement("div");
  appendToggle(container, "enabled", clubSearchEnhancerSettings.enabled, (isEnabled) => {
    clubSearchEnhancerSettings.enabled = isEnabled;
    persistConfiguration();
  });
  return container;
}

clubSearchEnhancerPluginDefinition = {
  run: function () {
    upsertStylesheet("club-search-enhacer-styles", clubSearchEnhacerStylesCss);
    const originalSetupSearchOptions = UTClubSearchFiltersView.prototype.setupSearchOptions;
    UTClubSearchFiltersView.prototype.setupSearchOptions = function (...args) {
      originalSetupSearchOptions.call(this, ...args);
      const currentController = getActiveController();
      const searchCriteria = findControllerProperty(currentController, "searchCriteria");
      if (args[0].includeUntradeableToggle) {
        this._searchOptions.addToggleCell(
          "sort-tradeable",
          translate("plugins.clubSearchEnhacer.filterBy.tradeablesOnly"),
        );
        addClasses(this._searchOptions.toggles.get("sort-tradeable"), "sort-tradeable");
        if (searchCriteria) {
          searchCriteria.untradeables;
          SearchUntradeables.EXCLUDE;
        }
      }
      if (!(currentController._challenge || currentController._challengeId)) {
        this._searchOptions.addToggleCell(
          "filter-loans",
          translate("plugins.clubSearchEnhacer.filterBy.hideLoans"),
        );
        if (searchCriteria && searchCriteria.hideLoans) {
          this._searchOptions.toggleById("filter-loans");
        }
      }
      this._searchOptions.addToggleCell(
        "filter-locked",
        translate("plugins.clubSearchEnhacer.filterBy.hideLocked"),
      );
      if (searchCriteria && searchCriteria.hideLocked) {
        this._searchOptions.toggleById("filter-locked");
      }
      this._searchOptions.layoutSubviews();
    };
    UTMyClubSearchFiltersViewController.prototype.turnOffToggle =
      UTClubSearchFiltersViewController.prototype.turnOffToggle = function (toggleId) {
        const toggle = this.getView()._searchOptions.toggles.get(toggleId);
        toggle?.toggle(false);
      };
    const originalOnSortToggleChanged =
      UTClubSearchFiltersViewController.prototype.onSortToggleChanged;
    UTClubSearchFiltersViewController.prototype.onSortToggleChanged = function (...args) {
      originalOnSortToggleChanged.call(this, ...args);
      const toggleData = args[2];
      switch (toggleData.id) {
        case "filter-loans":
          this.viewmodel.searchCriteria.hideLoans = toggleData.checked;
          break;
        case "filter-locked":
          this.viewmodel.searchCriteria.hideLocked = toggleData.checked;
          break;
        case "sort-tradeable":
          this.viewmodel.searchCriteria.untradeables = SearchUntradeables.EXCLUDE;
          this.turnOffToggle("sort-untradeable");
          break;
        case "sort-untradeable":
          this.turnOffToggle("sort-tradeable");
      }
    };
    const originalOnSortToggleSelected =
      UTMyClubSearchFiltersViewController.prototype.onSortToggleSelected;
    UTMyClubSearchFiltersViewController.prototype.onSortToggleSelected = function (...args) {
      originalOnSortToggleSelected.call(this, ...args);
      const toggleData = args[2];
      switch (toggleData.id) {
        case "filter-loans":
          this.searchViewModel.searchCriteria.hideLoans = toggleData.checked;
          break;
        case "filter-locked":
          this.searchViewModel.searchCriteria.hideLocked = toggleData.checked;
          break;
        case "sort-tradeable":
          this.searchViewModel.searchCriteria.untradeables = SearchUntradeables.EXCLUDE;
          this.turnOffToggle("sort-untradeable");
          break;
        case "sort-untradeable":
          this.turnOffToggle("sort-tradeable");
      }
    };
  },
  order: 6,
  menu: createClubSearchEnhancerSettingsMenu,
  settings: {
    name: "club-search-enhacer",
    title: "plugins.clubSearchEnhacer.settings.title",
    menu: createClubSearchEnhancerSettingsMenu,
  },
};

export const clubSearchEnhancerPlugin = clubSearchEnhancerPluginDefinition;
