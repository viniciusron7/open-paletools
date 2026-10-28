/**
 * `AutoSnipeViewController` (extends `EAViewController`): controller of the Auto Snipe screen
 * (added in 27.2.1). Start reads the view's options, saves them as the plugin settings and runs
 * an `AutoSnipeRunner` that searches with `searchAutoSnipeMarket` and buys with
 * `buyFirstActiveItem`; Stop stops it. Pushed by the Transfers hub tile
 * (src/plugins/auto-snipe/index.js).
 *
 * Invariants:
 * - `activeAutoSnipeRunner` is the one runner of the whole page: Start does nothing while it is
 *   running, and it is cleared when that runner ends. The settings toggle stops it when Auto
 *   Snipe is switched off.
 * - Start requires Paletools and `configuration.plugins.autoSnipe.enabled`
 *   (`plugins.autoSnipe.enableFirst` otherwise) and valid options (`plugins.autoSnipe.invalid`);
 *   it persists maxPrice, delayMs, maxSnipes, maxCards and buyDelayMs before running.
 * - The runner stays active only while Paletools and Auto Snipe are enabled and the screen is
 *   visible (`_active`, set by `viewDidAppear`, cleared by `viewWillDisappear` and `dealloc`,
 *   which also stop the runner). View updates happen only while `_active`.
 * - Each buy sends the "Item - Detail View" page view before `buyFirstActiveItem([item])`; the
 *   status shows attempts/maxSnipes and bought/maxCards, then complete or stopped (with the error
 *   message if the runner threw).
 * - `init` observes the view's Start/Stop observables once (`initialized`); `dealloc` removes
 *   them.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { translate } from "../../i18n/translations.js";
import { buyFirstActiveItem } from "../../market/item-actions.js";
import { trackPageView } from "../../webapp/telemetry.js";
import { AutoSnipeRunner } from "./runner.js";
import { searchAutoSnipeMarket } from "./search.js";
import { AutoSnipeView } from "./view.js";

const translateAutoSnipeControllerText = (translationKey) =>
  translate("plugins.autoSnipe." + translationKey);

export let activeAutoSnipeRunner;

const AutoSnipeViewControllerImpl = function () {
  EAViewController.call(this);
  this._active = false;
};

JSUtils.inherits(AutoSnipeViewControllerImpl, EAViewController);

AutoSnipeViewControllerImpl.prototype.init = function () {
  if (!this.initialized) {
    this.getView().onStartClicked.observe(this, this._start);
    this.getView().onStopClicked.observe(this, this._stop);
    this.initialized = true;
  }
};

AutoSnipeViewControllerImpl.prototype._getViewInstanceFromData = function () {
  return new AutoSnipeView();
};

AutoSnipeViewControllerImpl.prototype.getNavigationTitle = function () {
  return translateAutoSnipeControllerText("settings.title");
};

AutoSnipeViewControllerImpl.prototype.viewDidAppear = function () {
  this._active = true;
  this.getView().setRunning(Boolean(this._runner?.running));
  if (this._runner?.stopped) {
    this.getView().setStatus(translateAutoSnipeControllerText("stopped"));
  }
  this.getNavigationController().setNavigationVisibility(true, true);
};

AutoSnipeViewControllerImpl.prototype.viewWillDisappear = function () {
  this._active = false;
  this._runner?.stop();
};

AutoSnipeViewControllerImpl.prototype.dealloc = function () {
  this._active = false;
  this._runner?.stop();
  this.getView().onStartClicked.unobserve(this);
  this.getView().onStopClicked.unobserve(this);
  EAViewController.prototype.dealloc.call(this);
};

AutoSnipeViewControllerImpl.prototype._stop = function () {
  this._runner?.stop();
  this.getView().setStatus(translateAutoSnipeControllerText("stopping"));
};

AutoSnipeViewControllerImpl.prototype._start = async function () {
  const view = this.getView();
  const autoSnipeSettings = configuration.plugins.autoSnipe;
  if (activeAutoSnipeRunner?.running) {
    return;
  }
  if (!configuration.enabled || !autoSnipeSettings.enabled) {
    return void view.setStatus(translateAutoSnipeControllerText("enableFirst"));
  }
  const options = view.getOptions();
  if (!options) {
    return void view.setStatus(translateAutoSnipeControllerText("invalid"));
  }
  Object.assign(autoSnipeSettings, {
    maxPrice: options.maxPrice,
    delayMs: options.delayMs,
    maxSnipes: options.maxSnipes,
    maxCards: options.maxCards,
    buyDelayMs: options.buyDelayMs,
  });
  persistConfiguration();
  view.setRunning(true);
  view.setStatus(translateAutoSnipeControllerText("running"));
  const runner = new AutoSnipeRunner({
    search: searchAutoSnipeMarket,
    buy: ({ item }) => {
      trackPageView("Item - Detail View");
      return buyFirstActiveItem([item]);
    },
    isActive: () =>
      configuration.enabled && configuration.plugins.autoSnipe.enabled && this._active,
    onPurchase: (purchase) => {
      if (this._active) {
        view.addPurchase(purchase);
      }
    },
    onProgress: ({ attempts, bought }) => {
      if (this._active) {
        view.setStatus(
          translateAutoSnipeControllerText("attempts") +
            ": " +
            attempts +
            "/" +
            options.maxSnipes +
            " · " +
            translateAutoSnipeControllerText("bought") +
            ": " +
            bought +
            "/" +
            options.maxCards,
        );
      }
    },
  });
  this._runner = activeAutoSnipeRunner = runner;
  try {
    const result = await runner.start(options);
    if (this._active) {
      view.setStatus(
        translateAutoSnipeControllerText(result.stopped ? "stopped" : "complete") +
          " · " +
          translateAutoSnipeControllerText("attempts") +
          ": " +
          result.attempts +
          " · " +
          translateAutoSnipeControllerText("bought") +
          ": " +
          result.bought +
          "/" +
          options.maxCards,
      );
    }
  } catch (error) {
    runner.stop();
    if (this._active) {
      view.setStatus(translateAutoSnipeControllerText("stopped") + ": " + error.message);
    }
  } finally {
    if (this._active) {
      view.setRunning(false);
    }
    if (activeAutoSnipeRunner === runner) {
      activeAutoSnipeRunner = null;
    }
  }
};

export const AutoSnipeViewController = AutoSnipeViewControllerImpl;
