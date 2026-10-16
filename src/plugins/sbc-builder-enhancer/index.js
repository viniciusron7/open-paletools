/**
 * SBC builder enhancer plugin (order 6), installed by the plugin list in src/bootstrap/boot.js:
 * squad-builder limits (max players, players per club), league/nation filters, a search source
 * (src/sbc/search-sources.js), per-challenge saved settings, panel button shortcuts and moving
 * players to the club after a submit. The template builder and repeat-sbc rely on its overrides.
 *
 * Hooks (installed in `run()`):
 * - `_generate` of `UTSBCChallengeDetailsView` (stylesheet, `no-overflow`), `UTSquadBuilderView`
 *   (settings grid) and `UTSBCSquadDetailPanelView` (ids `btn-exchange`, `btn-squad-builder`,
 *   `btn-clear-squad`); `destroyGeneratedElements` of the last two;
 *   `UTSquadBuilderView.setFilters` (pile filter without "dream", default club; not gated by
 *   `enabled`).
 * - `UTSBCSquadDetailPanelViewController._getViewInstanceFromData` (shortcut actions, once via
 *   `_keysAdded`); `UTSquadBuilderViewController` `init`, `buildSquad`, `eBuildSelected` and new
 *   helpers (`filterAndSortPlayers`, `saveSbcSettings`, `restoreViewModel`, ...);
 *   `UTSquadBuilderViewModel.generatePlayerCollection`; `UTSBCService.submitChallenge`.
 *
 * Invariants:
 * - `init` runs the original first; when enabled it swaps `viewModel` for `viewModelOverrides`
 *   (template builder; the original stays in `originalViewModel`) and restores settings from
 *   `viewModel.searchSettings` or `paletoolsStorage` key `sbc:<challengeId>:searchSettings`,
 *   which UI changes and `saveSbcSettings` (after every club search) write back to session
 *   storage.
 * - `eBuildSelected` defers to the original when the plugin or Paletools is disabled or
 *   `useConceptPlayers` is set; otherwise it searches per `searchSource` (club pages bypass the
 *   club index) and ends with `this.onClubSearchComplete({unobserve(){}}, {success: true,
 *   response: {items}})`, the shape the other wrappers of that method receive. With no players it
 *   shows SQUAD_BUILDER_NO_RESULTS unless `dontShowNoPlayersFoundWarning` (set by the template
 *   builder).
 * - Step settings `minRating`/`maxRating` override `ovrMin`/`ovrMax`; `maxPlayers` caps the count
 *   (default: empty SBC slots); locked players (lock-players on), loans, limited-use items and
 *   `sbcTemplateData.exclusions` matches are dropped. Shortcuts `useSquadBuilder`, `clearSquad`
 *   and `submitChallenge` (keys in `snipe.buttons.sbc`) are ignored while a filter dropdown is
 *   open.
 * - Persisted names keep their misspellings: configuration `plugins.sbcBuilderEnhacer.{enabled,
 *   viewRequirements, movePlayersToClubAfterSumbit}` (`all` | `field` | `none`) and stylesheet
 *   `paletools-sbc-builder-enhacer`. After a successful submit, `all`/`field` moves unassigned
 *   players (`all`: the non-duplicate ones; `field`: items with the field players' definition
 *   ids) to the club, then matching storage items.
 *
 * Known issues (kept as-is):
 * - The toggle handler tests `imporant-leagues-only`, so `importantLeaguesOnly` is only saved by
 *   `updateCustomSearchSettings` at build time.
 * - The storage-first reorder in `generatePlayerCollection` is discarded (`storageFirst` is
 *   inert).
 * - A short club search re-appends its last page, already handled by the progress callback,
 *   without the `definitionId` de-duplication, so a player can appear twice.
 * - `moveMatchingStorageItemsToClub` receives squad slots but reads `definitionId` from them
 *   directly, so unless the slots carry one no storage item matches.
 * - `destroyGeneratedElements` destroys `_searchToggles` whenever enabled, even for a view
 *   generated while the plugin was disabled.
 * - `buildSquad` reads `this.viewModel.searchSettings.searchSource` regardless of `enabled`; only
 *   the enabled `init` assigns `searchSettings`.
 */
import { searchClubPlayers } from "../../club/club-search.js";
import { isItemLocked } from "../../club/locked-items.js";
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { toArray, uniqueBy } from "../../core/collections.js";
import { accessAttribute, addClasses, appendElements, removeClasses } from "../../core/dom.js";
import { paletoolsStorage } from "../../core/storage.js";
import { translate } from "../../i18n/translations.js";
import {
  searchSourceClub,
  searchSourceClubThenStorage,
  searchSourceStorage,
  searchSourceStorageThenClub,
} from "../../sbc/search-sources.js";
import { GridLayout } from "../../ui/components/grid-layout.js";
import { LabelWithTextInputControl } from "../../ui/controls/label-with-text-input-control.js";
import {
  isSearchFilterDropdownOpen,
  registerKeyboardShortcut,
} from "../../ui/keyboard-shortcuts.js";
import { appendDropdown, appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { getControllerView } from "../../webapp/game-view.js";
import {
  isSbcStorageItem,
  moveMatchingStorageItemsToClub,
  moveUnassignedItemsToClub,
  searchSbcStorageItems,
} from "../../webapp/item-piles.js";
import { getImportantLeagueIds, getImportantNationIds } from "../../webapp/leagues-and-nations.js";
import sbcBuilderEnhacerCss from "./sbc-builder-enhacer.css";

let sbcBuilderEnhancerPluginDefinition;

const sbcBuilderEnhancerSettings = configuration.plugins.sbcBuilderEnhacer;

function upsertSbcBuilderEnhancerStylesheet() {
  upsertStylesheet("paletools-sbc-builder-enhacer", sbcBuilderEnhacerCss);
}

function createSbcBuilderEnhancerSettingsMenu() {
  const container = document.createElement("div");
  appendToggle(container, "enabled", sbcBuilderEnhancerSettings.enabled, (enabled) => {
    sbcBuilderEnhancerSettings.enabled = enabled;
    persistConfiguration();
  });
  appendToggle(
    container,
    "plugins.sbcBuilderEnhacer.settings.viewRequirements",
    sbcBuilderEnhancerSettings.viewRequirements,
    (viewRequirements) => {
      sbcBuilderEnhancerSettings.viewRequirements = viewRequirements;
      persistConfiguration();
    },
  );
  appendDropdown(
    container,
    "plugins.sbcBuilderEnhacer.settings.movePlayersToClubAfterSumbit",
    [
      {
        label: translate("plugins.sbcBuilderEnhacer.settings.movePlayersToClubAfterSumbit.all"),
        value: "all",
      },
      {
        label: translate("plugins.sbcBuilderEnhacer.settings.movePlayersToClubAfterSumbit.field"),
        value: "field",
      },
      {
        label: translate("plugins.sbcBuilderEnhacer.settings.movePlayersToClubAfterSumbit.none"),
        value: "none",
      },
    ],
    sbcBuilderEnhancerSettings.movePlayersToClubAfterSumbit,
    (movePlayersToClubAfterSumbit) => {
      sbcBuilderEnhancerSettings.movePlayersToClubAfterSumbit = movePlayersToClubAfterSumbit;
      persistConfiguration();
    },
  );
  return container;
}

sbcBuilderEnhancerPluginDefinition = {
  run: function () {
    let triggerSquadBuilder = null;
    let triggerClearSquad = null;
    let triggerSubmitChallenge = null;
    registerKeyboardShortcut(
      "useSquadBuilder",
      () => configuration.plugins.snipe.buttons.sbc.useSquadBuilder,
      (useSquadBuilder) =>
        (configuration.plugins.snipe.buttons.sbc.useSquadBuilder = useSquadBuilder),
      "infopanel.button.squadbuilder",
      () => triggerSquadBuilder && !isSearchFilterDropdownOpen() && triggerSquadBuilder(),
      "#btn-squad-builder",
    );
    registerKeyboardShortcut(
      "clearSquad",
      () => configuration.plugins.snipe.buttons.sbc.clearSquad,
      (clearSquad) => (configuration.plugins.snipe.buttons.sbc.clearSquad = clearSquad),
      "infopanel.button.clear",
      () => triggerClearSquad && !isSearchFilterDropdownOpen() && triggerClearSquad(),
      "#btn-clear-squad",
    );
    registerKeyboardShortcut(
      "submitChallenge",
      () => configuration.plugins.snipe.buttons.sbc.submitChallenge,
      (submitChallengeKeyCode) =>
        (configuration.plugins.snipe.buttons.sbc.submitChallenge = submitChallengeKeyCode),
      "sbc.overlay.btn.submitChallenge",
      () => triggerSubmitChallenge && !isSearchFilterDropdownOpen() && triggerSubmitChallenge(),
      "#btn-exchange",
    );
    const originalChallengeDetailsGenerate = UTSBCChallengeDetailsView.prototype._generate;
    UTSBCChallengeDetailsView.prototype._generate = function (...args) {
      originalChallengeDetailsGenerate.call(this, ...args);
      if (!this._paletoolsGenerated) {
        upsertSbcBuilderEnhancerStylesheet();
        this._paletoolsGenerated = true;
      }
      if (sbcBuilderEnhancerSettings.viewRequirements) {
        addClasses(this, "no-overflow");
      } else {
        removeClasses(this, "no-overflow");
      }
    };
    const originalSquadBuilderGenerate = UTSquadBuilderView.prototype._generate;
    UTSquadBuilderView.prototype._generate = function () {
      originalSquadBuilderGenerate.call(this);
      if (sbcBuilderEnhancerSettings.enabled && !this._paletoolsGenerated) {
        this._settingsTitle = document.createElement("h4");
        this._settingsTitle.textContent = translate(
          "plugins.sbcBuilderEnhacer.filter.settings.title",
        );
        this.__sortContainer.appendChild(this._settingsTitle);
        const settingsGrid = new GridLayout(this.__sortContainer, {
          className: "sbc-settings",
        });
        this._maxPlayers = new LabelWithTextInputControl();
        this._maxPlayers.init();
        this._maxPlayers.setInputType("number");
        this._maxPlayers.setLabel(
          translate("plugins.sbcBuilderEnhacer.filter.settings.maxPlayers.label"),
        );
        appendElements(settingsGrid.addRow().addColumn(), this._maxPlayers);
        this._playersFromSameClub = new LabelWithTextInputControl();
        this._playersFromSameClub.init();
        this._playersFromSameClub.setInputType("number");
        this._playersFromSameClub.setLabel(
          translate("plugins.sbcBuilderEnhacer.filter.settings.playersFromSameClub.label"),
        );
        appendElements(settingsGrid.addRow().addColumn(), this._playersFromSameClub);
        this._searchToggles = new UTToggleControlGroupView();
        this._searchToggles.init();
        this._searchToggles.addToggleCell(
          "important-leagues-only",
          translate("plugins.sbcBuilderEnhacer.filter.search.importantLeaguesOnly"),
        );
        this._searchToggles.addToggleCell(
          "unimportant-leagues-only",
          translate("plugins.sbcBuilderEnhacer.filter.search.unimportantLeaguesOnly"),
        );
        this._searchToggles.addToggleCell(
          "important-nations-only",
          translate("plugins.sbcBuilderEnhacer.filter.search.importantNationsOnly"),
        );
        this._searchToggles.addToggleCell(
          "unimportant-nations-only",
          translate("plugins.sbcBuilderEnhacer.filter.search.unimportantNationsOnly"),
        );
        this._searchToggles.layoutSubviews();
        appendElements(settingsGrid.addRow().addColumn(), this._searchToggles);
        this._pileFilterSet = false;
        this._searchFilters.onSearchModeChange.observe(this, (observable, searchMode) => {
          this._storageSearch = searchMode === "storage";
          this._transferListSearch = searchMode === "transferlist";
        });
        appendElements(this.__sortContainer, settingsGrid);
        upsertSbcBuilderEnhancerStylesheet();
        this._paletoolsGenerated = true;
      }
    };
    UTSquadBuilderView.prototype.isStorageSearch = function () {
      return this._storageSearch;
    };
    UTSquadBuilderView.prototype.setStorageSearch = function (storageSearch) {
      this._storageSearch = storageSearch;
    };
    const originalSetFilters = UTSquadBuilderView.prototype.setFilters;
    UTSquadBuilderView.prototype.setFilters = function (...args) {
      originalSetFilters.call(this, ...args);
      if (!this._pileFilterSet) {
        const pileOptions = factories.DataProvider.getSearchPileDP(true).filter(
          (pileOption) => pileOption.value != "dream",
        );
        this._searchFilters.setPileFilter(pileOptions, "club");
        this._searchFilters.togglePileFilter(true);
        this._pileFilterSet = true;
      }
    };
    UTSquadBuilderView.prototype.onMaxPlayersChange = function (listener) {
      if (this._maxPlayers && listener) {
        this._maxPlayers.onKeyDown(() => listener(this._maxPlayers.value));
      }
    };
    UTSquadBuilderView.prototype.onPlayersFromSameClubChange = function (listener) {
      if (this._playersFromSameClub && listener) {
        this._playersFromSameClub.onKeyDown(() => listener(this._playersFromSameClub.value));
      }
    };
    UTSquadBuilderView.prototype.setMaxPlayers = function (maxPlayers) {
      if (this._maxPlayers) {
        this._maxPlayers.setInputValue(maxPlayers);
      }
    };
    UTSquadBuilderView.prototype.setPlayerFromSameClub = function (playersFromSameClub) {
      if (this._playersFromSameClub) {
        this._playersFromSameClub.setInputValue(playersFromSameClub);
      }
    };
    UTSquadBuilderView.prototype.getMaxPlayers = function () {
      if (this._maxPlayers) {
        return parseInt(this._maxPlayers.getInputValue()) || null;
      }
    };
    UTSquadBuilderView.prototype.getPlayersFromSameClub = function () {
      if (this._playersFromSameClub) {
        return parseInt(this._playersFromSameClub.getInputValue()) || null;
      }
    };
    UTSquadBuilderView.prototype.getSearchToggles = function () {
      return this._searchToggles;
    };
    UTSquadBuilderView.prototype.getSearchToggleState = function (toggleId) {
      return this._searchToggles.toggles.get(toggleId).getToggleState();
    };
    const originalSquadBuilderDestroyGeneratedElements =
      UTSquadBuilderView.prototype.destroyGeneratedElements;
    UTSquadBuilderView.prototype.destroyGeneratedElements = function () {
      originalSquadBuilderDestroyGeneratedElements.call(this);
      if (sbcBuilderEnhancerSettings.enabled) {
        this._searchToggles.destroy();
      }
    };
    const originalSquadDetailPanelGenerate = UTSBCSquadDetailPanelView.prototype._generate;
    UTSBCSquadDetailPanelView.prototype._generate = function (...args) {
      originalSquadDetailPanelGenerate.call(this, ...args);
      accessAttribute(this._btnExchange, "id", "btn-exchange");
      accessAttribute(this._btnSquadBuilder, "id", "btn-squad-builder");
      accessAttribute(this._btnClearSquad, "id", "btn-clear-squad");
    };
    const originalGetViewInstanceFromData =
      UTSBCSquadDetailPanelViewController.prototype._getViewInstanceFromData;
    UTSBCSquadDetailPanelViewController.prototype._getViewInstanceFromData = function (...args) {
      if (!this._keysAdded) {
        triggerSquadBuilder = () =>
          getControllerView(this) &&
          getControllerView(this).getRootElement() &&
          this._eSquadBuilderSelected();
        triggerClearSquad = () =>
          getControllerView(this) &&
          getControllerView(this).getRootElement() &&
          this._eSquadClearSelected();
        triggerSubmitChallenge = () =>
          getControllerView(this) &&
          getControllerView(this).getRootElement() &&
          this._eSquadExchange();
        this._keysAdded = true;
      }
      return originalGetViewInstanceFromData.call(this, ...args);
    };
    const originalSquadDetailPanelDestroyGeneratedElements =
      UTSBCSquadDetailPanelView.prototype.destroyGeneratedElements;
    UTSBCSquadDetailPanelView.prototype.destroyGeneratedElements = function () {
      originalSquadDetailPanelDestroyGeneratedElements.call(this);
      triggerSquadBuilder = triggerClearSquad = triggerSubmitChallenge = null;
    };
    UTSquadBuilderViewController.prototype.restoreViewModel = function () {
      this.viewModel = this.originalViewModel;
    };
    const originalInit = UTSquadBuilderViewController.prototype.init;
    UTSquadBuilderViewController.prototype.init = function () {
      originalInit.call(this);
      if (!sbcBuilderEnhancerSettings.enabled) {
        return;
      }
      let searchSettingsStorageKey;
      if (this.viewModelOverrides) {
        this.originalViewModel = this.viewModel;
        this.viewModel = this.viewModelOverrides;
      }
      let searchSettings = {};
      if (this.challenge && this.challenge.id) {
        searchSettingsStorageKey = "sbc:" + this.challenge.id + ":searchSettings";
        searchSettings =
          this.viewModel.searchSettings || paletoolsStorage.get(searchSettingsStorageKey);
        if (searchSettings) {
          if (searchSettings.searchCriteria) {
            Object.assign(this.viewModel.searchCriteria, searchSettings.searchCriteria);
          }
          this.getView().setStorageSearch(searchSettings.storageSearch);
          this.getView().setMaxPlayers(searchSettings.maxPlayers || "");
          this.getView().setPlayerFromSameClub(searchSettings.playersFromSameClub || "");
          if (searchSettings.ignorePosition) {
            this.getView()._searchOptions.toggleById(enums.UISortOptionType.IGNORE_POSITION);
            this.ignorePosition = searchSettings.ignorePosition;
          }
          if (searchSettings.importantLeaguesOnly) {
            this.getView().getSearchToggles().toggleById("important-leagues-only");
          }
          if (searchSettings.unimportantLeaguesOnly) {
            this.getView().getSearchToggles().toggleById("unimportant-leagues-only");
          }
          if (searchSettings.importantNationsOnly) {
            this.getView().getSearchToggles().toggleById("important-nations-only");
          }
          if (searchSettings.unimportantNationsOnly) {
            this.getView().getSearchToggles().toggleById("unimportant-nations-only");
          }
          if (searchSettings.filterBy) {
            if (searchSettings.filterBy[enums.UISortOptionType.CONCEPT]) {
              this.getView().getSortOptions().toggleById(enums.UISortOptionType.CONCEPT);
            }
            if (searchSettings.filterBy[enums.UISortOptionType.UNTRADEABLE]) {
              this.getView().getSortOptions().toggleById(enums.UISortOptionType.UNTRADEABLE);
            }
            if (searchSettings.filterBy[enums.UISortOptionType.EXCLUDE_SQUAD]) {
              this.getView().getSortOptions().toggleById(enums.UISortOptionType.EXCLUDE_SQUAD);
            }
            if (searchSettings.filterBy[enums.UISortOptionType.REPLACE]) {
              this.getView().getSortOptions().toggleById(enums.UISortOptionType.REPLACE);
            }
          }
          if (searchSettings.sortBy) {
            this.getView().getSortDropDown().setIndexById(searchSettings.sortBy);
          }
        } else {
          searchSettings = {};
        }
      }
      this.viewModel.searchSettings = searchSettings;
      const saveSearchSettings = () => {
        if (searchSettingsStorageKey) {
          paletoolsStorage.set(searchSettingsStorageKey, searchSettings);
        }
        this.viewModel.searchSettings = searchSettings;
      };
      this.getView()._searchOptions.addTarget(
        this,
        (sender, eventType, optionData) => {
          if (optionData.id === enums.UISortOptionType.IGNORE_POSITION) {
            searchSettings.ignorePosition = optionData.checked;
          }
          saveSearchSettings();
        },
        EventType.CHANGE,
      );
      this.getView()._searchFilters.onSearchModeChange.observe(this, (observable, searchMode) => {
        searchSettings.storageSearch = searchMode === "storage";
        saveSearchSettings();
      });
      this.getView()._maxPlayers.addTarget(
        this,
        () => {
          searchSettings.maxPlayers = this.getView().getMaxPlayers();
          saveSearchSettings();
        },
        EventType.CHANGE,
      );
      this.getView()._playersFromSameClub.addTarget(this, () => {
        searchSettings.playersFromSameClub = this.getView().getPlayersFromSameClub();
        saveSearchSettings();
      });
      this.getView()._searchToggles.addTarget(
        this,
        (sender, eventType, toggleData) => {
          if (toggleData.id === "imporant-leagues-only") {
            searchSettings.importantLeaguesOnly = toggleData.checked;
          } else if (toggleData.id == "unimportant-leagues-only") {
            searchSettings.unimportantLeaguesOnly = toggleData.checked;
          } else if (toggleData.id == "important-nations-only") {
            searchSettings.importantNationsOnly = toggleData.checked;
          } else if (toggleData.id == "unimportant-nations-only") {
            searchSettings.unimportantNationsOnly = toggleData.checked;
          }
          saveSearchSettings();
        },
        EventType.CHANGE,
      );
      this.getView()
        .getSortOptions()
        .addTarget(
          this,
          (sender, eventType, optionData) => {
            if (!searchSettings.filterBy) {
              searchSettings.filterBy = {};
            }
            searchSettings.filterBy[optionData.id] = optionData.checked;
            saveSearchSettings();
          },
          EventType.CHANGE,
        );
      this.getView()
        .getSortDropDown()
        .addTarget(
          this,
          (sortDropDown) => {
            searchSettings.sortBy = sortDropDown.id;
            saveSearchSettings();
          },
          EventType.CHANGE,
        );
    };
    UTSquadBuilderViewController.prototype.updateCustomSearchSettings = function () {
      this.viewModel.searchSettings = this.viewModel.searchSettings || {};
      this.viewModel.searchSettings.maxPlayers = this.getView().getMaxPlayers();
      this.viewModel.searchSettings.playersFromSameClub = this.getView().getPlayersFromSameClub();
      this.viewModel.searchSettings.importantLeaguesOnly =
        this.getView().getSearchToggleState("important-leagues-only");
      this.viewModel.searchSettings.unimportantLeaguesOnly = this.getView().getSearchToggleState(
        "unimportant-leagues-only",
      );
      this.viewModel.searchSettings.importantNationsOnly =
        this.getView().getSearchToggleState("important-nations-only");
      this.viewModel.searchSettings.unimportantNationsOnly = this.getView().getSearchToggleState(
        "unimportant-nations-only",
      );
    };
    UTSquadBuilderViewController.prototype.getPlayersByClub = function () {
      const playerCountByTeamId = {};
      for (let slot of this.squad.getPlayers()) {
        const item = slot.getItem();
        if (playerCountByTeamId[item.teamId]) {
          playerCountByTeamId[item.teamId]++;
        } else {
          playerCountByTeamId[item.teamId] = 1;
        }
      }
      return playerCountByTeamId;
    };
    UTSquadBuilderViewController.prototype.saveSbcSettings = function () {
      if (this.challenge && this.challenge.id) {
        const storageKey = "sbc:" + this.challenge.id + ":searchSettings";
        let storedSettings = paletoolsStorage.get(storageKey) || {};
        Object.assign(storedSettings, {
          ...this.viewModel.searchSettings,
          searchCriteria: this.viewModel.searchCriteria,
        });
        paletoolsStorage.set(storageKey, storedSettings);
      }
    };
    UTSquadBuilderViewController.prototype.filterAndSortPlayers = function (players) {
      const importantLeagueIds = getImportantLeagueIds();
      const importantNationIds = getImportantNationIds();
      const playersByClub = this.getPlayersByClub();
      const exclusions = (this.sbcTemplateData && this.sbcTemplateData.exclusions) || [];
      const excludedTeamIds = [];
      const excludedNationIds = [];
      const excludedLeagueIds = [];
      const excludedRarityIds = [];
      for (let exclusion of exclusions) {
        if (exclusion.searchCriteria.club > 0) {
          excludedTeamIds.push(exclusion.searchCriteria.club);
        }
        if (exclusion.searchCriteria.nation > 0) {
          excludedNationIds.push(exclusion.searchCriteria.nation);
        }
        if (exclusion.searchCriteria.league > 0) {
          excludedLeagueIds.push(exclusion.searchCriteria.league);
        }
        if (exclusion.searchCriteria.rarities) {
          for (let rarityId of exclusion.searchCriteria.rarities) {
            excludedRarityIds.push(rarityId);
          }
        }
      }
      players = players.filter(
        (player) =>
          !(
            player.isLimitedUse() ||
            (configuration.plugins.lockPlayers.enabled && isItemLocked(player)) ||
            (this.viewModel.searchSettings.importantLeaguesOnly &&
              importantLeagueIds.length > 0 &&
              -1 === importantLeagueIds.indexOf(player.leagueId)) ||
            (this.viewModel.searchSettings.unimportantLeaguesOnly &&
              importantLeagueIds.length > 0 &&
              importantLeagueIds.indexOf(player.leagueId) > -1) ||
            (this.viewModel.searchSettings.importantNationsOnly &&
              importantNationIds.length > 0 &&
              -1 === importantNationIds.indexOf(player.nationId)) ||
            (this.viewModel.searchSettings.unimportantNationsOnly &&
              importantNationIds.length > 0 &&
              importantNationIds.indexOf(player.nationId) > -1) ||
            player.loans > -1 ||
            excludedTeamIds.indexOf(player.teamId) > -1 ||
            excludedLeagueIds.indexOf(player.leagueId) > -1 ||
            excludedNationIds.indexOf(player.nationId) > -1 ||
            excludedRarityIds.indexOf(player.rareflag) > -1 ||
            (this.viewModel.searchSettings.playersFromSameClub &&
              (playersByClub[player.teamId]
                ? playersByClub[player.teamId]++
                : (playersByClub[player.teamId] = 1),
              playersByClub[player.teamId] > this.viewModel.searchSettings.playersFromSameClub))
          ),
      );
      switch (this.viewModel.searchCriteria.sortBy) {
        case SearchSortType.RATING:
          players.sort((left, right) =>
            this.viewModel.searchCriteria.sort === "asc"
              ? left.rating - right.rating
              : right.rating - left.rating,
          );
          break;
        case SearchSortType.RECENCY:
          players.sort((left, right) =>
            this.viewModel.searchCriteria.sort === "asc"
              ? left.timestamp - right.timestamp
              : right.timestamp - left.timestamp,
          );
          break;
        case SearchSortType.VALUE:
          players.sort((left, right) =>
            this.viewModel.searchCriteria.sort === "asc"
              ? left.discardValue - right.discardValue
              : right.discardValue - left.discardValue,
          );
      }
      if (
        this.viewModel.searchSettings.maxPlayers &&
        players.length > this.viewModel.searchSettings.maxPlayers
      ) {
        players = players.slice(0, this.viewModel.searchSettings.maxPlayers);
      }
      return players;
    };
    UTSquadBuilderViewController.prototype.dontUpdateCustomSearchSettingsOnBuild = false;
    UTSquadBuilderViewController.prototype.dontShowNoPlayersFoundWarning = false;
    const originalGeneratePlayerCollection =
      UTSquadBuilderViewModel.prototype.generatePlayerCollection;
    UTSquadBuilderViewModel.prototype.generatePlayerCollection = function (...args) {
      const playerCollection = originalGeneratePlayerCollection.call(this, ...args);
      if (this.storageFirst) {
        (function (players, unusedArgument2) {
          const storageFirstPlayers = players.filter((player) => player && player.id !== 0);
          storageFirstPlayers.sort((left, right) =>
            left == null || right == null
              ? 0
              : left.utasPile == 0
                ? -1
                : right.utasPile == 0
                  ? 1
                  : isSbcStorageItem(left) && !isSbcStorageItem(right)
                    ? -1
                    : !isSbcStorageItem(left) && isSbcStorageItem(right)
                      ? 1
                      : 0,
          );
          const reorderedPlayers = [];
          let sortedIndex = 0;
          for (const player of players) {
            if (player && player.id !== 0) {
              reorderedPlayers.push(storageFirstPlayers[sortedIndex++]);
            } else {
              reorderedPlayers.push(player);
            }
          }
        })(playerCollection);
      }
      return playerCollection;
    };
    const originalBuildSquad = UTSquadBuilderViewController.prototype.buildSquad;
    UTSquadBuilderViewController.prototype.buildSquad = function (...args) {
      this.squadBuilder.storageFirst =
        this.viewModel.searchSettings.searchSource === searchSourceStorageThenClub;
      originalBuildSquad.call(this, ...args);
    };
    const originalEBuildSelected = UTSquadBuilderViewController.prototype.eBuildSelected;
    UTSquadBuilderViewController.prototype.eBuildSelected = function (...args) {
      if (!sbcBuilderEnhancerSettings.enabled || !configuration.enabled || this.useConceptPlayers) {
        return void originalEBuildSelected.call(this, ...args);
      }
      let requiredPlayerCount = 0;
      requiredPlayerCount = this.viewModel.searchSettings.maxPlayers
        ? this.viewModel.searchSettings.maxPlayers
        : this.squad.getSBCSlots().filter((slot) => slot.item.id === 0).length;
      this.formation = this.getView().getFormationFilter().value;
      this.viewModel.searchCriteria.offset = 0;
      if (this.viewModel.searchSettings.minRating) {
        this.viewModel.searchCriteria.ovrMin = this.viewModel.searchSettings.minRating;
      }
      if (this.viewModel.searchSettings.maxRating) {
        this.viewModel.searchCriteria.ovrMax = this.viewModel.searchSettings.maxRating;
      }
      if (!this.dontUpdateCustomSearchSettingsOnBuild) {
        this.updateCustomSearchSettings();
      }
      const filterAndLimitPlayers = (players) => {
        let filteredPlayers = this.filterAndSortPlayers(players);
        return filteredPlayers.length >= requiredPlayerCount
          ? filteredPlayers.slice(0, requiredPlayerCount)
          : filteredPlayers;
      };
      const completeSearchWithClubPlayers = (players, isClubFirst) => {
        let deferredStoragePlayers = [];
        if (isClubFirst) {
          deferredStoragePlayers = players;
          players = [];
        }
        const addedDefinitionIds = (function (values, keySelector = (value) => value) {
          return new Set(toArray(values).map(keySelector));
        })(players, (player) => player.definitionId);
        if (players.length >= requiredPlayerCount) {
          this.onClubSearchComplete(
            {
              unobserve: () => {},
            },
            {
              success: true,
              response: {
                items: players.slice(0, requiredPlayerCount),
              },
            },
          );
        } else {
          searchClubPlayers(
            true,
            null,
            (offset, pageItems) => {
              if (players.length >= requiredPlayerCount) {
                return false;
              }
              const pagePlayers = filterAndLimitPlayers(pageItems);
              for (let player of pagePlayers) {
                if (!addedDefinitionIds.has(player.definitionId)) {
                  players.push(player);
                  addedDefinitionIds.add(player.definitionId);
                }
              }
              return !(
                players.length >= requiredPlayerCount &&
                ((players = players.slice(0, requiredPlayerCount)), 1)
              );
            },
            this.viewModel.searchCriteria,
            true,
          ).then((lastPageItems) => {
            this.saveSbcSettings();
            if (players.length < requiredPlayerCount) {
              for (let player of filterAndLimitPlayers(
                lastPageItems,
                getImportantLeagueIds(),
                this.getPlayersByClub(),
              )) {
                players.push(player);
                if (players.length >= requiredPlayerCount) {
                  break;
                }
              }
            }
            if (players.length !== 0 || this.dontShowNoPlayersFoundWarning) {
              players = players.concat(deferredStoragePlayers).slice(0, requiredPlayerCount);
              this.onClubSearchComplete(
                {
                  unobserve: () => {},
                },
                {
                  success: true,
                  response: {
                    items: filterAndLimitPlayers(players),
                  },
                },
              );
            } else {
              utils.PopupManager.showAlert(utils.PopupManager.Alerts.SQUAD_BUILDER_NO_RESULTS);
            }
          });
        }
      };
      if (this.getView().isStorageSearch()) {
        searchSbcStorageItems(this.viewModel.searchCriteria).then((storageSearchResult) => {
          storageSearchResult.response.items = uniqueBy(
            storageSearchResult.response.items,
            (item) => item.definitionId,
          );
          this.onClubSearchComplete(
            {
              unobserve: () => {},
            },
            storageSearchResult,
          );
        });
      } else {
        if (!this.viewModel.searchSettings.searchSource) {
          if (this.viewModel.searchFeature === ItemSearchFeature.CLUB) {
            this.viewModel.searchSettings.searchSource = searchSourceClub;
          } else if (this.viewModel.searchFeature === ItemSearchFeature.STORAGE) {
            this.viewModel.searchSettings.searchSource = searchSourceStorage;
          } else {
            this.viewModel.searchSettings.searchSource = searchSourceStorageThenClub;
          }
        }
        switch (this.viewModel.searchSettings.searchSource) {
          case searchSourceClub:
            return void completeSearchWithClubPlayers([]);
          case searchSourceStorage:
            return void searchSbcStorageItems(this.viewModel.searchCriteria).then(
              (storageSearchResult) => {
                let storagePlayers = filterAndLimitPlayers(
                  uniqueBy(storageSearchResult.response.items, (item) => item.definitionId),
                );
                this.onClubSearchComplete(
                  {
                    unobserve: () => {},
                  },
                  {
                    success: true,
                    response: {
                      items: storagePlayers,
                    },
                  },
                );
              },
            );
          case searchSourceStorageThenClub:
          case searchSourceClubThenStorage:
            return void searchSbcStorageItems(this.viewModel.searchCriteria).then(
              (storageSearchResult) => {
                let storagePlayers = filterAndLimitPlayers(
                  uniqueBy(storageSearchResult.response.items, (item) => item.definitionId),
                );
                completeSearchWithClubPlayers(
                  storagePlayers,
                  this.viewModel.searchSettings.searchSource == searchSourceClubThenStorage,
                );
              },
            );
        }
      }
    };
    const originalSubmitChallenge = UTSBCService.prototype.submitChallenge;
    UTSBCService.prototype.submitChallenge = function (...args) {
      const squadPlayers = args[0].squad.getPlayers();
      const fieldPlayers = args[0].squad.getFieldPlayers();
      const submitObservable = originalSubmitChallenge.call(this, ...args);
      if (configuration.enabled && sbcBuilderEnhancerSettings.enabled) {
        submitObservable.observe(this, (observable, response) => {
          observable.unobserve(this);
          if (response.success) {
            if (sbcBuilderEnhancerSettings.movePlayersToClubAfterSumbit === "all") {
              moveUnassignedItemsToClub().finally(() => {
                moveMatchingStorageItemsToClub(squadPlayers);
              });
            } else if (sbcBuilderEnhancerSettings.movePlayersToClubAfterSumbit === "field") {
              moveUnassignedItemsToClub(
                fieldPlayers.map((slot) => slot.getItem().definitionId),
              ).finally(() => {
                moveMatchingStorageItemsToClub(fieldPlayers);
              });
            }
          }
        });
      }
      return submitObservable;
    };
  },
  order: 6,
  menu: createSbcBuilderEnhancerSettingsMenu,
  settings: {
    name: "sbc-builder-enhacer",
    title: "plugins.sbcBuilderEnhacer.settings.title",
    menu: createSbcBuilderEnhancerSettingsMenu,
  },
};

export const sbcBuilderEnhancerPlugin = sbcBuilderEnhancerPluginDefinition;
