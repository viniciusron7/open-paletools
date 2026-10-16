/**
 * Price Tracker plugin (`priceTrackerPlugin`, order 10006), installed by the plugin list in
 * src/bootstrap/boot.js, and `PriceTrackerViewController`: a tab listing tracked player revisions
 * with their external market price (./price-tracker-view.js, ./price-tracker-view-model.js).
 *
 * Hooks:
 * - `run()` (async, awaited by boot) checks `canAccessExternalHosts()`; only then it adds a
 *   before-hook on `UTGameTabBarController.initWithViewControllers` (`hookPrototypeMethod`) that
 *   pushes the tab (tag 10, classes `icon-coins price-tracker-menu-item`), and upserts stylesheet
 *   `paletools-price-tracker`.
 *
 * Invariants:
 * - The tab, price refreshes and revision loading all require `configuration.enabled`,
 *   `plugins.priceTracker.enabled` and `plugins.externalMarketPrices.enabled`; whether the tab
 *   exists is decided when the tab bar is built.
 * - `settings` is a getter read by boot after `run()`: no settings tile while external market
 *   prices are disabled. The top-level `menu` property is not read by boot.
 * - `loadRevisions` uses an incrementing `requestId` to drop stale responses;
 *   `viewWillDisappear` and `dealloc` bump it and stop the view model.
 * - src/plugins/settings/index.js wraps the same tab-bar method afterwards, so the settings tab
 *   is pushed before this one.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { canAccessExternalHosts } from "../../core/http.js";
import { hookPrototypeMethod } from "../../core/prototype-override.js";
import { translate } from "../../i18n/translations.js";
import { PriceTrackerViewModel } from "./price-tracker-view-model.js";
import { PriceTrackerView } from "./price-tracker-view.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import priceTrackerCss from "./price-tracker.css";

function PriceTrackerViewController() {
  EAViewController.call(this);
  this.viewModel = new PriceTrackerViewModel();
  this.requestId = 0;
}

let priceTrackerPluginDefinition;

function createPriceTrackerSettingsMenu() {
  const menuContainer = document.createElement("div");
  appendToggle(
    menuContainer,
    "enabled",
    configuration.plugins.priceTracker.enabled,
    (isEnabled) => {
      configuration.plugins.priceTracker.enabled = isEnabled;
      persistConfiguration();
    },
  );
  return menuContainer;
}

JSUtils.inherits(PriceTrackerViewController, EAViewController);

PriceTrackerViewController.prototype.init = function () {
  if (this.initialized) {
    return;
  }
  const view = this.getView();
  view.onPlayerChanged = (player) => this.loadRevisions(player);
  this.viewModel.onChange = () => view.renderPlayers();
  this.initialized = true;
};

PriceTrackerViewController.prototype._getViewInstanceFromData = function () {
  return new PriceTrackerView(this.viewModel);
};

PriceTrackerViewController.prototype.getNavigationTitle = function () {
  return translate("plugins.priceTracker.settings.title");
};

PriceTrackerViewController.prototype.viewDidAppear = function () {
  this.getNavigationController().setNavigationVisibility(true, true);
  if (
    !configuration.enabled ||
    !configuration.plugins.priceTracker.enabled ||
    !configuration.plugins.externalMarketPrices.enabled
  ) {
    this.viewModel.stop();
    this.getView().setStatus("disabled");
    return void this.getView().setRevisions([]);
  }
  this.viewModel.refresh().catch(() => {
    if (this.viewModel.active) {
      this.getView().setStatus("storageError");
    }
  });
  this.loadRevisions(this.getView().playerSearch.getSelected());
};

PriceTrackerViewController.prototype.loadRevisions = async function (player) {
  const requestId = ++this.requestId;
  const view = this.getView();
  view.setRevisions([]);
  if (
    configuration.enabled &&
    configuration.plugins.priceTracker.enabled &&
    configuration.plugins.externalMarketPrices.enabled &&
    (view.setStatus(player ? "loading" : "selectPlayer"), player)
  ) {
    try {
      const revisions = await this.viewModel.getRevisions(player.id);
      if (
        requestId !== this.requestId ||
        !configuration.enabled ||
        !configuration.plugins.priceTracker.enabled ||
        !configuration.plugins.externalMarketPrices.enabled
      ) {
        return;
      }
      view.setRevisions(revisions);
      view.setStatus(revisions.length ? "" : "noRevisions");
    } catch {
      if (requestId === this.requestId) {
        view.setStatus("error");
      }
    }
  }
};

PriceTrackerViewController.prototype.viewWillDisappear = function () {
  this.requestId++;
  this.viewModel.stop();
};

PriceTrackerViewController.prototype.dealloc = function () {
  this.viewWillDisappear();
  this.viewModel.onChange = () => {};
  EAViewController.prototype.dealloc.call(this);
};

priceTrackerPluginDefinition = {
  run: async function () {
    if (await canAccessExternalHosts()) {
      hookPrototypeMethod(
        UTGameTabBarController,
        "initWithViewControllers",
        function (viewControllers) {
          if (
            !configuration.enabled ||
            !configuration.plugins.priceTracker.enabled ||
            !configuration.plugins.externalMarketPrices.enabled
          ) {
            return;
          }
          const priceTrackerNavigationController = new UTGameFlowNavigationController();
          priceTrackerNavigationController.initWithRootController(new PriceTrackerViewController());
          priceTrackerNavigationController.tabBarItem = (function () {
            const tabBarItem = new UTTabBarItemView();
            tabBarItem.init();
            tabBarItem.setTag(10);
            tabBarItem.setText(translate("plugins.priceTracker.settings.title"));
            tabBarItem.addClass("icon-coins price-tracker-menu-item");
            return tabBarItem;
          })();
          viewControllers.push(priceTrackerNavigationController);
        },
      );
      upsertStylesheet("paletools-price-tracker", priceTrackerCss);
    }
  },
  order: 10006,
  menu: createPriceTrackerSettingsMenu,
  get settings() {
    if (configuration.plugins.externalMarketPrices.enabled) {
      return {
        name: "priceTracker",
        title: "plugins.priceTracker.settings.title",
        menu: createPriceTrackerSettingsMenu,
      };
    }
  },
};

export const priceTrackerPlugin = priceTrackerPluginDefinition;
