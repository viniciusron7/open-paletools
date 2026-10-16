/**
 * Market search filters plugin (`marketSearchFiltersPlugin`, order 5, installed by the plugin
 * list in src/bootstrap/boot.js): saved filters, Player ID filter, hide-owned-duplicates and
 * holographic-only result filters, and its settings menu.
 *
 * Hooks:
 * - In `run()`: two result transformers (`addMarketSearchResultTransformer`) and methods assigned
 *   on `UTMarketSearchFiltersView.prototype` (getStoredFilters, saveFilters, loadSavedFilters,
 *   saveFilter, deleteFilter, loadFilter, updateSearchCriteria, handlePlayerIdChange,
 *   onSavedFiltersChange).
 * - `hookPrototypeMethod`: `UTMarketSearchView._generate` (after),
 *   `UTMarketSearchFiltersView._generate` (after), `setFilters` (before),
 *   `destroyGeneratedElements` (after); `UTMarketSearchFiltersViewController`
 *   `eSearchCategoryChanged` (after) and `eResetSelected` (before).
 *
 * Invariants:
 * - Saved filters: localStorage `paletools:searchFilters` = `btoa(JSON)` of
 *   `{ key: { name, criteria } }`, key = name with non-alphanumerics replaced by '_', lowercased;
 *   keep for stored user data.
 * - The transformers apply to every transfer-market search without `disableOverrides` (Player
 *   snipe included): holographic-only keeps `hasHyperCosmetics()` items while the toggle is on;
 *   hideDuplicates drops offers of owned club players. Both pad to 21 entries with empty items so
 *   native pagination keeps working.
 * - `updateSearchCriteria` and `_playerId` are used by name by the legacy snipe and by Player
 *   snipe (search and identity check).
 * - Extended filters are built once per view (`_generateMarketSearchFilters`) and only when
 *   Paletools is enabled at generation; `isHolographicOnlyFilterActive` is module-wide and reset
 *   on Reset and on non-player categories.
 * - These hooks create the wrappers on `UTMarketSearchFiltersView._generate` and
 *   `destroyGeneratedElements` that the legacy snipe's direct overrides call later.
 * - Settings: savedFilters, playerId (confirm `plugins.marketSearchFilters.playerIdWarning`),
 *   hideDuplicates, holographicFilters; stylesheet `paletools-marketsearch-filters`.
 *
 * Known issues (kept as-is):
 * - `loadClubPlayers()` is called without arguments and resolves `{}` at once (no club preload).
 * - The hideDuplicates promise never settles if `findOwnedClubPlayers` rejects, so that search
 *   response is never delivered.
 * - The CONFIGURATION_SAVED listener is empty.
 * - Clearing the Player ID input does not clear `searchCriteria.defId` (only non-empty values are
 *   written; Reset clears it).
 */
import { findOwnedClubPlayers, loadClubPlayers } from "../../club/club-players-cache.js";
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { addClasses, appendElements, insertBefore } from "../../core/dom.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { hookPrototypeMethod } from "../../core/prototype-override.js";
import { translate } from "../../i18n/translations.js";
import { addMarketSearchResultTransformer } from "../../market/search-hooks.js";
import { padFilteredSearchResults } from "../../market/search-results.js";
import { showSuccessNotification } from "../../ui/notifications.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import { getActiveController } from "../../webapp/navigation.js";
import marketsearchFiltersCss from "./marketsearch-filters.css";

let marketSearchFiltersPluginDefinition;

const marketSearchFiltersSettings = configuration.plugins.marketSearchFilters;

let isHolographicOnlyFilterActive = false;

marketSearchFiltersPluginDefinition = {
  run: function () {
    if (configuration.enabled && marketSearchFiltersSettings.hideDuplicates) {
      loadClubPlayers();
    }
    addMarketSearchResultTransformer((items) =>
      configuration.enabled &&
      marketSearchFiltersSettings.holographicFilters &&
      isHolographicOnlyFilterActive
        ? padFilteredSearchResults(
            items.filter((item) => item.hasHyperCosmetics?.()),
            items,
            21,
          )
        : items,
    );
    addMarketSearchResultTransformer((items, controller) =>
      configuration.enabled && marketSearchFiltersSettings.hideDuplicates
        ? new Promise(async (resolve, reject) => {
            const clubPlayersByDefinitionId = await findOwnedClubPlayers(items, 0, true);
            resolve(
              padFilteredSearchResults(
                items.filter((item) => !clubPlayersByDefinitionId[item.definitionId]),
                items,
                21,
              ),
            );
          })
        : items,
    );
    listenForEvent(paletoolsEvents.CONFIGURATION_SAVED, () => {});
    UTMarketSearchFiltersView.prototype.getStoredFilters = function () {
      const encodedFilters = localStorage.getItem("paletools:searchFilters");
      return (encodedFilters && JSON.parse(atob(encodedFilters))) || {};
    };
    UTMarketSearchFiltersView.prototype.saveFilters = function (filters) {
      localStorage.setItem("paletools:searchFilters", btoa(JSON.stringify(filters)));
    };
    UTMarketSearchFiltersView.prototype.loadSavedFilters = function () {
      const storedFilters = this.getStoredFilters();
      let filterOptions = [
        {
          label: translate("plugins.marketSearchFilters.loadFilters"),
          value: "",
        },
      ];
      for (let filterKey of Object.keys(storedFilters).sort()) {
        filterOptions.push({
          label: storedFilters[filterKey].name,
          value: filterKey,
        });
      }
      this._savedFilters.setOptions(filterOptions);
    };
    UTMarketSearchFiltersView.prototype.saveFilter = function () {
      const controller = getActiveController();
      if (controller instanceof UTMarketSearchFiltersViewController) {
        const criteria = controller.viewmodel.searchCriteria;
        const filterName = this._filterName.getValue();
        const filterKey = filterName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
        const storedFilters = this.getStoredFilters();
        storedFilters[filterKey] = {
          name: filterName,
          criteria: criteria,
        };
        this.saveFilters(storedFilters);
        this.loadSavedFilters();
        showSuccessNotification(translate("plugins.marketSearchFilters.filterSaved"));
      }
    };
    UTMarketSearchFiltersView.prototype.deleteFilter = function () {
      if (getActiveController() instanceof UTMarketSearchFiltersViewController) {
        const filterKey = this._savedFilters.getValue();
        const storedFilters = this.getStoredFilters();
        if (!storedFilters[filterKey]) {
          return;
        }
        delete storedFilters[filterKey];
        this.saveFilters(storedFilters);
        this.loadSavedFilters();
        showSuccessNotification(translate("plugins.marketSearchFilters.filterDeleted"));
      }
    };
    UTMarketSearchFiltersView.prototype.loadFilter = function (filter) {
      const controller = getActiveController();
      if (controller instanceof UTMarketSearchFiltersViewController) {
        if (filter.criteria.defId && filter.criteria.defId.length > 0 && this._playerId) {
          this._playerId.setValue(filter.criteria.defId[0]);
        }
        if (filter.criteria.maskedDefId) {
          let playerData = repositories.Item.getStaticDataByDefId(filter.criteria.maskedDefId);
          controller.viewmodel.playerData = playerData;
        }
        for (let criteriaKey of Object.keys(filter.criteria)) {
          controller.viewmodel.searchCriteria[criteriaKey] = filter.criteria[criteriaKey];
        }
        this.setFilters(controller.viewmodel);
      }
    };
    UTMarketSearchFiltersView.prototype.updateSearchCriteria = function () {
      if (this._playerId) {
        this.handlePlayerIdChange(null, null, this._playerId.getRootElement());
      }
    };
    UTMarketSearchFiltersView.prototype.handlePlayerIdChange = function (
      sender,
      eventType,
      inputElement,
    ) {
      const controller = getActiveController();
      if (
        controller instanceof UTMarketSearchFiltersViewController &&
        inputElement.value &&
        inputElement.value.length > 0
      ) {
        controller.viewmodel.searchCriteria.defId = [inputElement.value];
      }
    };
    UTMarketSearchFiltersView.prototype.onSavedFiltersChange = function (
      sender,
      eventType,
      selection,
    ) {
      const storedFilters = this.getStoredFilters();
      if (storedFilters[selection.value]) {
        this.loadFilter(storedFilters[selection.value]);
      } else {
        const controller = getActiveController();
        if (controller instanceof UTMarketSearchFiltersViewController) {
          controller._eResetSelected();
        }
      }
    };
    hookPrototypeMethod(UTMarketSearchView, "_generate", null, function () {
      if (marketSearchFiltersSettings.hideDuplicates) {
        addClasses(this, "hide-duplicates");
      }
    });
    hookPrototypeMethod(UTMarketSearchFiltersView, "_generate", null, function () {
      if (configuration.enabled && !this._generateMarketSearchFilters) {
        const extendedFiltersContainer = document.createElement("div");
        addClasses(extendedFiltersContainer, "ut-item-search-view", "extended-filters");
        if (marketSearchFiltersSettings.savedFilters) {
          let savedFiltersContainer = document.createElement("div");
          savedFiltersContainer.classList.add("saved-filters");
          this._filterName = new UTTextInputControl();
          this._filterName.init();
          this._filterName.setPlaceholder(translate("plugins.marketSearchFilters.filter.name"));
          this._saveFilterButton = new UTStandardButtonControl();
          this._saveFilterButton.init();
          this._saveFilterButton.setText(translate("plugins.marketSearchFilters.filter.save"));
          this._saveFilterButton.addTarget(this, this.saveFilter, EventType.TAP);
          if (isPhone()) {
            addClasses(this._saveFilterButton, "mini");
          }
          this._deleteFilterButton = new UTStandardButtonControl();
          this._deleteFilterButton.init();
          this._deleteFilterButton.setText(translate("plugins.marketSearchFilters.filter.delete"));
          this._deleteFilterButton.addTarget(this, this.deleteFilter, EventType.TAP);
          if (isPhone()) {
            addClasses(this._deleteFilterButton, "mini");
          }
          this._savedFilters = new UTDropDownControl();
          this._savedFilters.init();
          this._savedFilters.addTarget(this, this.onSavedFiltersChange, EventType.CHANGE);
          appendElements(
            savedFiltersContainer,
            this._filterName.getRootElement(),
            this._saveFilterButton.getRootElement(),
            this._deleteFilterButton.getRootElement(),
            this._savedFilters.getRootElement(),
          );
          extendedFiltersContainer.appendChild(savedFiltersContainer);
          this.loadSavedFilters();
        }
        if (marketSearchFiltersSettings.playerId) {
          this._playerId = new UTTextInputControl();
          const playerIdWrapper = (function (inputElement) {
            const wrapper = document.createElement("div");
            wrapper.classList.add("inline-list-select");
            wrapper.classList.add("ut-player-search-control");
            const inlineContainer = document.createElement("div");
            inlineContainer.classList.add("inline-container");
            wrapper.appendChild(inlineContainer);
            const inputContainer = document.createElement("div");
            inlineContainer.appendChild(inputContainer);
            inputContainer.classList.add("ut-player-search-control--input-container");
            inputContainer.appendChild(inputElement);
            return wrapper;
          })(this._playerId.getRootElement());
          this._playerId.init();
          this._playerId.setPlaceholder(translate("plugins.marketSearchFilters.playerId"));
          this._playerId.setMaxLength(25);
          this._playerId.addTarget(this, this.handlePlayerIdChange, EventType.CHANGE);
          extendedFiltersContainer.appendChild(playerIdWrapper);
        }
        insertBefore(extendedFiltersContainer, this._searchFilters);
        if (marketSearchFiltersSettings.holographicFilters) {
          this._holographicFilter = appendToggle(
            this._searchFilters,
            "plugins.marketSearchFilters.holographicOnly",
            false,
            (isHolographicOnly) => {
              isHolographicOnlyFilterActive = isHolographicOnly;
            },
          );
          addClasses(this._holographicFilter, "holographic-filter");
        }
        this._marketSearchFilters = extendedFiltersContainer;
        this._generateMarketSearchFilters = true;
      }
    });
    hookPrototypeMethod(UTMarketSearchFiltersView, "setFilters", function (...args) {
      if (
        configuration.enabled &&
        marketSearchFiltersSettings.playerId &&
        this._playerId &&
        args[0].searchCriteria.defId &&
        args[0].searchCriteria.defId.length > 0
      ) {
        this._playerId.setValue(args[0].searchCriteria.defId[0]);
      }
    });
    hookPrototypeMethod(
      UTMarketSearchFiltersViewController,
      "eSearchCategoryChanged",
      null,
      function (sender, eventType, category) {
        if (category.id === SearchBucket.PLAYER) {
          showElements(this.getView()._marketSearchFilters);
          showElements(this.getView()._holographicFilter);
        } else {
          hideElements(this.getView()._marketSearchFilters);
          hideElements(this.getView()._holographicFilter);
          this.getView()._holographicFilter?.toggle(false);
          isHolographicOnlyFilterActive = false;
        }
      },
    );
    hookPrototypeMethod(UTMarketSearchFiltersView, "destroyGeneratedElements", null, function () {
      if (this._playerId) {
        this._playerId.destroy();
      }
      if (this._filterName) {
        this._filterName.destroy();
        this._saveFilterButton.destroy();
        this._deleteFilterButton.destroy();
        this._savedFilters.destroy();
      }
    });
    hookPrototypeMethod(UTMarketSearchFiltersViewController, "eResetSelected", function () {
      if (this.getView()._playerId) {
        this.getView()._playerId.clear();
        this.viewmodel.searchCriteria.defId = [];
      }
      if (this.getView()._filterName) {
        this.getView()._filterName.clear();
      }
      if (this.getView()._holographicFilter) {
        this.getView()._holographicFilter.toggle(false);
        isHolographicOnlyFilterActive = false;
      }
    });
    upsertStylesheet("paletools-marketsearch-filters", marketsearchFiltersCss);
  },
  order: 5,
  settings: {
    name: "market-search-filters",
    title: "plugins.marketSearchFilters.settings.title",
    menu: function () {
      var menuContainer = document.createElement("div");
      function appendSettingToggle(settingKey) {
        appendToggle(
          menuContainer,
          "plugins.marketSearchFilters.settings." + settingKey,
          marketSearchFiltersSettings[settingKey],
          (isEnabled) => {
            if (isEnabled) {
              if (settingKey === "playerId") {
                if (!confirm(translate("plugins.marketSearchFilters.playerIdWarning"))) {
                  return false;
                }
                marketSearchFiltersSettings[settingKey] = isEnabled;
                persistConfiguration();
              } else {
                marketSearchFiltersSettings[settingKey] = isEnabled;
                persistConfiguration();
              }
            } else {
              marketSearchFiltersSettings[settingKey] = isEnabled;
              persistConfiguration();
            }
          },
        );
      }
      appendSettingToggle("savedFilters");
      appendSettingToggle("playerId");
      appendSettingToggle("hideDuplicates");
      appendSettingToggle("holographicFilters");
      return menuContainer;
    },
  },
};

export const marketSearchFiltersPlugin = marketSearchFiltersPluginDefinition;
