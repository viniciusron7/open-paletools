/**
 * Filter SBCs plugin (order 6), installed by the plugin list in src/bootstrap/boot.js: a search
 * box (`#search-sbcs`) and a sort dropdown (`#sort-sbcs`) in a `#filter-sbcs` container of the
 * SBC hub (before `.container` on phone, otherwise in the categories menu).
 *
 * Hooks (installed in `run()`):
 * - `UTSBCHubView._generate` (after the original; when enabled, once via `_filterSbcsGenerated`);
 *   `UTSBCHubView.populateTiles` re-applies the current filter and sort; `UTSBCHubView.dealloc`
 *   is replaced (deallocs the two controls).
 * - `UTSBCSetTileView.render` (after the original, called without arguments): writes the sort
 *   attributes when enabled.
 *
 * Invariants:
 * - Tiles carry `data-id`, `data-end-time` (negated end time, `Number.MIN_SAFE_INTEGER` when 0),
 *   `data-times-completed` and `data-challenges-completed-count`; the dropdown values are these
 *   attribute names. Sorting is descending by the parsed value, then `.complete` tiles go last.
 * - Text filtering matches `.tileHeader` case-insensitively and re-shows only tiles without
 *   `data-hidden` (set by hide-sbcs).
 * - Stylesheet `paletools-fillSbcs` (removed on APP_DISABLED, restored on APP_ENABLED);
 *   configuration `plugins.filterSbcs.enabled`.
 *
 * Known issues (kept as-is):
 * - The `dealloc` replacement never calls the original `UTSBCHubView.prototype.dealloc` (the line
 *   before it is a dead expression).
 * - APP_DISABLED / APP_ENABLED listeners are added for every generated hub view, never removed.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import {
  appendElements,
  insertBefore,
  prependElements,
  queryElement,
  queryElements,
  removeFromParentElement,
} from "../../core/dom.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { translate } from "../../i18n/translations.js";
import { DropdownControl } from "../../ui/controls/dropdown-control.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { removeStylesheet, upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import fillSbcsCss from "./fillSbcs.css";

let filterSbcsPluginDefinition;

const filterSbcsSettings = configuration.plugins.filterSbcs;

filterSbcsPluginDefinition = {
  run: function () {
    function filterSbcTiles(searchText) {
      for (let tile of queryElements(".ut-sbc-set-tile-view")) {
        if (!tile.dataset.hidden) {
          showElements(tile);
        }
        if (
          searchText.length > 0 &&
          -1 ===
            queryElement(".tileHeader", tile)
              .textContent.toLowerCase()
              .indexOf(searchText.toLowerCase())
        ) {
          hideElements(tile);
        }
      }
    }
    function sortSbcTiles(attributeName) {
      if (attributeName === "") {
        return;
      }
      const hubLayout = queryElement(".ut-sbc-hub-view .layout-hub");
      let tiles = queryElements(".ut-sbc-set-tile-view", hubLayout);
      removeFromParentElement(tiles);
      tiles = tiles.sort((left, right) => {
        const leftValue = parseInt(left.getAttribute(attributeName));
        const rightValue = parseInt(right.getAttribute(attributeName));
        return leftValue > rightValue ? -1 : leftValue < rightValue ? 1 : 0;
      });
      appendElements(hubLayout, ...tiles);
      const completedTiles = queryElements(".complete", hubLayout);
      removeFromParentElement(completedTiles);
      appendElements(hubLayout, ...completedTiles);
    }
    const originalGenerate = UTSBCHubView.prototype._generate;
    UTSBCHubView.prototype._generate = function () {
      const hubView = this;
      function showFilterControls() {
        showElements(hubView._filterContainer);
        upsertStylesheet("paletools-fillSbcs", fillSbcsCss);
      }
      originalGenerate.call(this);
      if (filterSbcsSettings.enabled && !this._filterSbcsGenerated) {
        this._filterContainer = document.createElement("div");
        this._filterContainer.id = "filter-sbcs";
        this._searchInput = new UTTextInputControl();
        this._searchInput.init();
        this._searchInput.setPlaceholder(translate("plugins.filterSbcs.label"));
        this._searchInput.getRootElement().id = "search-sbcs";
        listenForEvent(this._searchInput.getRootElement(), "keyup", (event) => {
          filterSbcTiles(event.target.value);
        });
        this._sortDropDown = new DropdownControl();
        this._sortDropDown.getRootElement().id = "sort-sbcs";
        this._sortDropDown.init();
        this._sortDropDown.setOptions([
          {
            label: translate("plugins.filterSbcs.sort.label"),
            value: "",
          },
          {
            label: translate("plugins.filterSbcs.sort.byId"),
            value: "data-id",
          },
          {
            label: translate("plugins.filterSbcs.sort.byEndTime"),
            value: "data-end-time",
          },
          {
            label: translate("plugins.filterSbcs.sort.byTimesCompleted"),
            value: "data-times-completed",
          },
          {
            label: translate("plugins.filterSbcs.sort.byChallengesCompletedCount"),
            value: "data-challenges-completed-count",
          },
        ]);
        this._sortDropDown.onChange((sortAttribute) => {
          sortSbcTiles(sortAttribute);
        });
        this._filterContainer.append(this._searchInput.getRootElement());
        this._filterContainer.append(this._sortDropDown.getRootElement());
        if (isPhone()) {
          const container = queryElement(".container", this.getRootElement());
          insertBefore(this._filterContainer, container);
        } else {
          prependElements(
            queryElement(".menu-container", this._SBCCategoriesTM.getRootElement()),
            this._filterContainer,
          );
        }
        listenForEvent(paletoolsEvents.APP_DISABLED, () => {
          hideElements(hubView._filterContainer);
          return void removeStylesheet("paletools-fillSbcs");
        });
        listenForEvent(paletoolsEvents.APP_ENABLED, () => showFilterControls());
        showFilterControls();
        this._filterSbcsGenerated = true;
      }
    };
    const originalPopulateTiles = UTSBCHubView.prototype.populateTiles;
    UTSBCHubView.prototype.populateTiles = function (
      populateTilesArgument1,
      populateTilesArgument2,
    ) {
      originalPopulateTiles.call(this, populateTilesArgument1, populateTilesArgument2);
      if (this._searchInput && this._searchInput.getValue()) {
        filterSbcTiles(this._searchInput.getValue());
      }
      if (this._sortDropDown && this._sortDropDown.getValue()) {
        sortSbcTiles(this._sortDropDown.getValue());
      }
    };
    UTSBCHubView.prototype.dealloc;
    UTSBCHubView.prototype.dealloc = function () {
      try {
        if (this._sortDropDown) {
          this._sortDropDown.dealloc();
        }
        if (this._searchInput) {
          this._searchInput.dealloc();
        }
      } catch {}
    };
    const originalRender = UTSBCSetTileView.prototype.render;
    UTSBCSetTileView.prototype.render = function () {
      originalRender.call(this);
      if (filterSbcsSettings.enabled) {
        this.getRootElement().setAttribute("data-id", this.data.id);
        this.getRootElement().setAttribute(
          "data-challenges-completed-count",
          this.data.challengesCompletedCount,
        );
        this.getRootElement().setAttribute(
          "data-end-time",
          this.data.endTime === 0 ? Number.MIN_SAFE_INTEGER : -1 * this.data.endTime,
        );
        this.getRootElement().setAttribute("data-times-completed", this.data.timesCompleted);
      }
    };
  },
  order: 6,
  settings: {
    name: "filterSbcs",
    title: "plugins.filterSbcs.settings.title",
    menu: function () {
      const menuContainer = document.createElement("div");
      appendToggle(menuContainer, "enabled", filterSbcsSettings.enabled, (isEnabled) => {
        filterSbcsSettings.enabled = isEnabled;
        persistConfiguration();
      });
      return menuContainer;
    },
  },
};

export const filterSbcsPlugin = filterSbcsPluginDefinition;
