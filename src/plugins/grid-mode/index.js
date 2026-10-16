/**
 * Grid mode plugin (`gridModePlugin`, order 4, installed by the plugin list in
 * src/bootstrap/boot.js): a toggle in the currency navigation bar that applies the grid
 * stylesheet, persisted in `configuration.plugins.gridMode.enabled`.
 *
 * Hooks:
 * - In `run()`, direct overrides: `UTCurrencyNavigationBarView._generate` (after the previous
 *   override, e.g. the donation plugin's) and `UTGameFlowNavigationController.viewDidAppear`
 *   (re-syncs the toggle with the setting).
 *
 * Invariants:
 * - Grid mode = body class `paletools-gridmode` + stylesheet id `paletools-grid`.
 * - The toggle (`grid-mode-toggle`) is added once per bar (`_gridModeGenerated`) and is not gated
 *   on `configuration.enabled`; `toggle()` fires `onToggle`, so the initial sync and the
 *   viewDidAppear re-sync apply or remove the stylesheet and persist the configuration.
 * - APP_ENABLED re-applies according to the setting; APP_DISABLED hides the toggle and removes
 *   grid mode.
 *
 * Known issues (kept as-is):
 * - Each generated bar adds another APP_ENABLED/APP_DISABLED listener pair that is never removed.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import {
  addClasses,
  insertBefore,
  prependElements,
  queryElement,
  removeClasses,
  setStyles,
} from "../../core/dom.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { translate } from "../../i18n/translations.js";
import { LabelWithToggleControl } from "../../ui/controls/label-with-toggle-control.js";
import { removeStylesheet, upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import gridCss from "./grid.css";

let gridModePluginDefinition;

const gridModeSettings = configuration.plugins.gridMode;

gridModePluginDefinition = {
  run: function () {
    function enableGridMode() {
      addClasses(document.body, "paletools-gridmode");
      upsertStylesheet("paletools-grid", gridCss);
    }
    function disableGridMode() {
      removeClasses(document.body, "paletools-gridmode");
      removeStylesheet("paletools-grid");
    }
    const originalGenerate = UTCurrencyNavigationBarView.prototype._generate;
    UTCurrencyNavigationBarView.prototype._generate = function () {
      originalGenerate.call(this);
      if (!this._gridModeGenerated) {
        this._gridModeToggle = new LabelWithToggleControl();
        addClasses(this._gridModeToggle, "grid-mode-toggle");
        this._gridModeToggle.setLabel(translate("plugins.gridMode.title"));
        this._gridModeToggle.onToggle = (sender, eventType, toggleData) => {
          if (toggleData.toggleState) {
            enableGridMode();
          } else {
            disableGridMode();
          }
          gridModeSettings.enabled = toggleData.toggleState;
          persistConfiguration();
        };
        if (gridModeSettings.enabled) {
          this._gridModeToggle.toggle();
        }
        setStyles(this._gridModeToggle.getRootElement(), {
          borderRight: "1px solid white",
          marginRight: "10px",
          paddingRight: "10px",
        });
        if (isPhone()) {
          setStyles(this._gridModeToggle.getRootElement(), {
            position: "relative",
          });
          setStyles(queryElement("label", this._gridModeToggle.getRootElement()), {
            position: "absolute",
            right: "75px",
            width: "250px",
            top: "4px",
          });
          setStyles(queryElement(".ut-toggle-control", this._gridModeToggle.getRootElement()), {
            display: "inline-block",
          });
          prependElements(this.__currencies, this._gridModeToggle.getRootElement());
        } else {
          insertBefore(this._gridModeToggle.getRootElement(), this.__currencies);
        }
        listenForEvent(paletoolsEvents.APP_ENABLED, () => {
          showElements(this._gridModeToggle);
          disableGridMode();
          if (gridModeSettings.enabled) {
            enableGridMode();
          }
        });
        listenForEvent(paletoolsEvents.APP_DISABLED, () => {
          hideElements(this._gridModeToggle);
          disableGridMode();
        });
        this._gridModeGenerated = true;
      }
    };
    const originalViewDidAppear = UTGameFlowNavigationController.prototype.viewDidAppear;
    UTGameFlowNavigationController.prototype.viewDidAppear = function () {
      originalViewDidAppear.call(this);
      if (
        this._navigationBar instanceof UTCurrencyNavigationBarView &&
        this._navigationBar._gridModeToggle
      ) {
        const toggleState = this._navigationBar._gridModeToggle.getToggleState();
        if (
          (gridModeSettings.enabled && !toggleState) ||
          (!gridModeSettings.enabled && toggleState)
        ) {
          this._navigationBar._gridModeToggle.toggle();
        }
      }
    };
  },
  order: 4,
};

export const gridModePlugin = gridModePluginDefinition;
