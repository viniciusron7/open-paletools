/**
 * Wide Mode plugin (`wideModePlugin`, order 4), installed by the plugin list in
 * src/bootstrap/boot.js: a toggle in the currency navigation bar injects or removes the
 * wide-mode stylesheet. It has no settings tile; the toggle is the only UI for the setting.
 *
 * Hooks (installed in `run()`):
 * - `UTCurrencyNavigationBarView.prototype._generate` (after original): once per bar
 *   (`_wideModeGenerated`) inserts a `LabelWithToggleControl` (`_wideModeToggle`, class
 *   `wide-mode-toggle`) before `this.__currencies`.
 * - `UTGameFlowNavigationController.prototype.viewDidAppear` (after original): toggles the bar's
 *   switch when it disagrees with `plugins.wideMode.enabled`, keeping all bars in sync.
 *
 * Invariants:
 * - The toggle callback owns the setting: it upserts/removes stylesheet id `paletools-widemode`,
 *   stores `toggleState` in `plugins.wideMode.enabled` and persists. `toggle()` fires that
 *   callback, so syncing a bar also re-applies the stylesheet.
 * - `APP_DISABLED` hides the toggle and removes the stylesheet; `APP_ENABLED` shows it and
 *   re-applies the stylesheet when enabled. Bar generation ignores `configuration.enabled`.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { addClasses, insertBefore, setStyles } from "../../core/dom.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { translate } from "../../i18n/translations.js";
import { LabelWithToggleControl } from "../../ui/controls/label-with-toggle-control.js";
import { removeStylesheet, upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import wideModeStyles from "./wide-mode.css";

let wideModePluginDefinition;

const wideModeSettings = configuration.plugins.wideMode;

wideModePluginDefinition = {
  run: function () {
    function removeWideModeStylesheet() {
      removeStylesheet("paletools-widemode");
    }
    const originalGenerate = UTCurrencyNavigationBarView.prototype._generate;
    UTCurrencyNavigationBarView.prototype._generate = function () {
      originalGenerate.call(this);
      if (!this._wideModeGenerated) {
        this._wideModeToggle = new LabelWithToggleControl();
        addClasses(this._wideModeToggle, "wide-mode-toggle");
        this._wideModeToggle.setLabel(translate("plugins.wideMode.title"));
        this._wideModeToggle.onToggle = (sender, eventType, toggleData) => {
          if (toggleData.toggleState) {
            upsertStylesheet("paletools-widemode", wideModeStyles);
          } else {
            removeStylesheet("paletools-widemode");
          }
          wideModeSettings.enabled = toggleData.toggleState;
          persistConfiguration();
        };
        if (wideModeSettings.enabled) {
          this._wideModeToggle.toggle();
        }
        setStyles(this._wideModeToggle.getRootElement(), {
          borderRight: "1px solid white",
          marginRight: "10px",
          paddingRight: "10px",
        });
        insertBefore(this._wideModeToggle.getRootElement(), this.__currencies);
        listenForEvent(paletoolsEvents.APP_ENABLED, () => {
          showElements(this._wideModeToggle.getRootElement());
          removeWideModeStylesheet();
          if (wideModeSettings.enabled) {
            upsertStylesheet("paletools-widemode", wideModeStyles);
          }
        });
        listenForEvent(paletoolsEvents.APP_DISABLED, () => {
          hideElements(this._wideModeToggle.getRootElement());
          removeWideModeStylesheet();
        });
        this._wideModeGenerated = true;
      }
    };
    const originalViewDidAppear = UTGameFlowNavigationController.prototype.viewDidAppear;
    UTGameFlowNavigationController.prototype.viewDidAppear = function () {
      originalViewDidAppear.call(this);
      if (
        this._navigationBar instanceof UTCurrencyNavigationBarView &&
        this._navigationBar._wideModeToggle
      ) {
        const isToggleOn = this._navigationBar._wideModeToggle.getToggleState();
        if (
          (wideModeSettings.enabled && !isToggleOn) ||
          (!wideModeSettings.enabled && isToggleOn)
        ) {
          this._navigationBar._wideModeToggle.toggle();
        }
      }
    };
  },
  order: 4,
};

export const wideModePlugin = wideModePluginDefinition;
