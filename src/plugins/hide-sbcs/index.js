/**
 * Hide SBCs plugin (order 6), installed by the plugin list in src/bootstrap/boot.js: hide/show
 * buttons on SBC set tiles, a synthetic "hidden" category in the SBC hub and a "show all" button.
 * Hidden set ids live in src/plugins/hide-sbcs/hidden-sbc-set-ids.js.
 *
 * Hooks (installed in `run()`):
 * - `UTSBCSetsViewModel.resetCollections`: appends a `UTSBCCategoryDTO` (id -10, label `hidden`)
 *   holding the hidden set ids before calling the original.
 * - `UTSBCSetTileView._generate` (after the original, once per tile via `paletoolsGenerated`)
 *   adds `.btn-hide`/`.btn-show` buttons; new `displayShowSbcButton`/`displayHideSbcButton`;
 *   `render` (after the original) shows the matching one.
 * - `UTSBCHubViewController.viewDidAppear` and `UTSBCHubView.populateTiles` (after the original).
 *
 * Invariants:
 * - Custom actions `HIDE_SBC`, `SHOW_SBC` (payload: the set) and `SHOW_ALL_SBC` travel from the
 *   tiles to the hub view to the hub controller, which updates the list and calls
 *   `_requestSBCData()`; "show all" (`plugins.hideSbcs.buttons.showAll`) also selects category 0.
 * - Category id -10 identifies the hidden category. In the other categories the tiles of hidden
 *   sets are hidden and get the `data-hidden` attribute, which src/plugins/filter-sbcs/index.js
 *   respects when it re-shows tiles.
 * - Targets are added on every `viewDidAppear` / `populateTiles` call and never removed.
 * - Stylesheet id `paletools-hide-sbc`; configuration `plugins.hideSbcs.enabled`.
 *
 * Known issues (kept as-is):
 * - The hidden category and the hiding of tiles apply even when `hideSbcs.enabled` is false; only
 *   the hide/show buttons check the flag.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import {
  accessAttribute,
  addClasses,
  appendElements,
  prependElements,
  queryElement,
  removeAttribute,
} from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { hiddenSbcSetIds } from "./hidden-sbc-set-ids.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import hideSbcCss from "./hide-sbc.css";

let hideSbcsPluginDefinition;

const hideSbcsSettings = configuration.plugins.hideSbcs;

hideSbcsPluginDefinition = {
  run: function () {
    upsertStylesheet("paletools-hide-sbc", hideSbcCss);
    const originalResetCollections = UTSBCSetsViewModel.prototype.resetCollections;
    UTSBCSetsViewModel.prototype.resetCollections = function (...args) {
      args[0];
      const categories = args[1];
      const hiddenCategory = new UTSBCCategoryDTO(
        -10,
        10000,
        translate("hidden"),
        SBCCategoryType.SERVER,
      );
      hiddenCategory.displayable = true;
      hiddenCategory.setIds = hiddenSbcSetIds.all();
      categories.push(hiddenCategory);
      originalResetCollections.call(this, ...args);
    };
    const originalGenerate = UTSBCSetTileView.prototype._generate;
    UTSBCSetTileView.prototype._generate = function (...args) {
      originalGenerate.call(this, ...args);
      if (hideSbcsSettings.enabled && !this.paletoolsGenerated) {
        const buttonsContainer = queryElement(".sbc-set--buttons", this);
        this._hideButton = new UTImageButtonControl();
        this._hideButton.init();
        addClasses(this._hideButton, "btn-hide");
        this._hideButton.addTarget(
          this,
          () => {
            this._triggerActions("HIDE_SBC", this.data);
          },
          EventType.TAP,
        );
        this._showButton = new UTImageButtonControl();
        this._showButton.init();
        addClasses(this._showButton, "btn-show");
        this._showButton.addTarget(
          this,
          () => {
            this._triggerActions("SHOW_SBC", this.data);
          },
          EventType.TAP,
        );
        appendElements(buttonsContainer, this._hideButton, this._showButton);
        this.paletoolsGenerated = true;
      }
    };
    UTSBCSetTileView.prototype.displayShowSbcButton = function () {
      hideElements(this._hideButton);
      showElements(this._showButton);
    };
    UTSBCSetTileView.prototype.displayHideSbcButton = function () {
      showElements(this._hideButton);
      hideElements(this._showButton);
    };
    const originalRender = UTSBCSetTileView.prototype.render;
    UTSBCSetTileView.prototype.render = function (...args) {
      originalRender.call(this, ...args);
      if (hideSbcsSettings.enabled && this.data) {
        if (hiddenSbcSetIds.contains(this.data.id)) {
          this.displayShowSbcButton();
        } else {
          this.displayHideSbcButton();
        }
      }
    };
    const originalViewDidAppear = UTSBCHubViewController.prototype.viewDidAppear;
    UTSBCHubViewController.prototype.viewDidAppear = function (...args) {
      originalViewDidAppear.call(this, ...args);
      this.getView().addTarget(
        this,
        (sender, eventType, sbcSet) => {
          hiddenSbcSetIds.remove(sbcSet.id);
          this._requestSBCData();
        },
        "SHOW_SBC",
      );
      this.getView().addTarget(
        this,
        (sender, eventType, sbcSet) => {
          hiddenSbcSetIds.add(sbcSet.id);
          this._requestSBCData();
        },
        "HIDE_SBC",
      );
      this.getView().addTarget(
        this,
        (sender, eventType) => {
          hiddenSbcSetIds.removeAll();
          this._requestSBCData();
          this._eCategorySelected(sender, UTSBCHubView.Event.CATEGORY_SELECTED, {
            index: 0,
          });
        },
        "SHOW_ALL_SBC",
      );
    };
    const originalPopulateTiles = UTSBCHubView.prototype.populateTiles;
    UTSBCHubView.prototype.populateTiles = function (...args) {
      originalPopulateTiles.call(this, ...args);
      const category = args[1];
      const hiddenSbcIds = hiddenSbcSetIds.all();
      if (-10 === category.id) {
        if (this.showAllSbcsButton) {
          showElements(this.showAllSbcsButton);
        } else {
          this.showAllSbcsButton = new UTStandardButtonControl();
          this.showAllSbcsButton.init();
          this.showAllSbcsButton.setText(translate("plugins.hideSbcs.buttons.showAll"));
          addClasses(this.showAllSbcsButton, "col-1-1");
          this.showAllSbcsButton.addTarget(
            this,
            () => {
              for (let tile of this.sbcSetTiles) {
                removeAttribute(tile, "data-hidden");
              }
              this._triggerActions("SHOW_ALL_SBC");
            },
            EventType.TAP,
          );
          prependElements(this.__sbcSetTiles, this.showAllSbcsButton);
        }
      } else {
        hideElements(this.showAllSbcsButton);
      }
      for (let tile of this.sbcSetTiles) {
        if (hiddenSbcIds.indexOf(tile.data.id) > -1 && -10 !== category.id) {
          hideElements(tile);
          accessAttribute(tile, "data-hidden", true);
        } else {
          removeAttribute(tile, "data-hidden");
        }
        tile.addTarget(
          this,
          (sender, eventType, sbcSet) => {
            tile.displayHideSbcButton();
            this._triggerActions("SHOW_SBC", sbcSet);
          },
          "SHOW_SBC",
        );
        tile.addTarget(
          this,
          (sender, eventType, sbcSet) => {
            tile.displayShowSbcButton();
            this._triggerActions("HIDE_SBC", sbcSet);
          },
          "HIDE_SBC",
        );
      }
    };
  },
  order: 6,
  settings: {
    name: "hideSbcs",
    title: "plugins.hideSbcs.settings.title",
    menu: function () {
      const menuContainer = document.createElement("div");
      appendToggle(menuContainer, "enabled", hideSbcsSettings.enabled, (isEnabled) => {
        hideSbcsSettings.enabled = isEnabled;
        persistConfiguration();
      });
      return menuContainer;
    },
  },
};

export const hideSbcsPlugin = hideSbcsPluginDefinition;
