/**
 * Auto relist plugin `autoRelistPlugin` (order 3), installed by the plugin list in
 * src/bootstrap/boot.js: adds an auto-relist toggle to the transfer list's Unsold section and,
 * while on, periodically refreshes the transfer list and relists expired items without
 * confirmation.
 *
 * Hooks (installed in `run()`):
 * - `UTTransferListViewController.prototype.init`: `autoRelistScheduler.start(this)` BEFORE the
 *   original init.
 * - `UTTransferListView.prototype.destroyGeneratedElements` (original first): stops the
 *   scheduler.
 * - `UTTransferListView.prototype.renderSection`: for the UNSOLD section (plugin enabled)
 *   prepends `div.auto-relist` with a `UTToggleControl` to the section header.
 * - Adds (does not override)
 *   `UTTransferListViewController.prototype._relistAllWithoutConfirmation`, which the scheduler
 *   depends on.
 *
 * Invariants:
 * - `autoRelistScheduler` reads `autoRelist.interval` once, at module evaluation; a changed
 *   interval only applies after a reload.
 * - `start()` acts only when `enabled && autoRelist` and no timer is pending; it runs one cycle
 *   at once and re-arms `setTimeout` without awaiting it. A cycle calls `refreshList()`, waits 10
 *   s, then relists if the view model has unsold items. `start()` without argument reuses the
 *   last controller.
 * - Enabling the plugin in the menu requires `confirm(translate("plugins.dangerous"))`; config
 *   keys `autoRelist.enabled`, `autoRelist.autoRelist`, `autoRelist.interval`; stylesheet
 *   `paletools-auto-relist`.
 * - The relist sends telemetry `Transfer List - Re-List All`, routes critical statuses to the
 *   network error controller and shows `popup.error.relistall.forbidden.message` on FORBIDDEN.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { waitForDelay } from "../../core/async.js";
import { appendElements, createElement, prependElements } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { getViewModel } from "../../webapp/navigation.js";
import autoRelistCss from "./auto-relist.css";

let autoRelistPluginDefinition;

const autoRelistSettings = configuration.plugins.autoRelist;

const autoRelistScheduler = new (class {
  #te;
  #ie;
  #ne;
  constructor(intervalMs) {
    this.#te = intervalMs;
    this.#ie = null;
  }
  ["start"](transferListController) {
    this.#ne = transferListController || this.#ne;
    if (autoRelistSettings.enabled && autoRelistSettings.autoRelist && !this.#ie) {
      const relistAndScheduleNext = () => {
        this.#se();
        this.#ie = setTimeout(relistAndScheduleNext, this.#te);
      };
      relistAndScheduleNext();
    }
  }
  ["stop"]() {
    clearTimeout(this.#ie);
    this.#ie = null;
  }
  async #se() {
    this.#ne.refreshList();
    await waitForDelay(10000);
    if (getViewModel(this.#ne).hasUnsoldItems()) {
      this.#ne._relistAllWithoutConfirmation();
    }
  }
})(autoRelistSettings.interval);

autoRelistPluginDefinition = {
  run: function () {
    upsertStylesheet("paletools-auto-relist", autoRelistCss);
    const originalDestroyGeneratedElements = UTTransferListView.prototype.destroyGeneratedElements;
    UTTransferListView.prototype.destroyGeneratedElements = function (...args) {
      originalDestroyGeneratedElements.call(this, ...args);
      autoRelistScheduler.stop();
    };
    UTTransferListViewController.prototype._relistAllWithoutConfirmation = function () {
      TelemetryManager.trackEvent(
        TelemetryManager.Sections.AUCTIONS,
        TelemetryManager.Categories.BUTTON_PRESS,
        "Transfer List - Re-List All",
      );
      this.getView().setInteractionState(false);
      services.Item.relistExpiredAuctions().observe(this, (observable, response) => {
        this.getView().setInteractionState(true);
        observable.unobserve(this);
        const networkErrorController = getAppMain().getNetworkErrorController();
        if (networkErrorController.checkCriticalStatus(response.status)) {
          networkErrorController.handleStatus(response.status);
        } else if (response.status !== HttpStatusCode.FORBIDDEN) {
          if (response.success) {
            this.refreshList();
          }
        } else {
          services.Notification.queue([
            translate("popup.error.relistall.forbidden.message"),
            UINotificationType.NEGATIVE,
          ]);
        }
      });
    };
    const originalInit = UTTransferListViewController.prototype.init;
    UTTransferListViewController.prototype.init = function (...args) {
      autoRelistScheduler.start(this);
      originalInit.call(this, ...args);
    };
    const originalRenderSection = UTTransferListView.prototype.renderSection;
    UTTransferListView.prototype.renderSection = function (...args) {
      if (
        args[1] !== UTTransferSectionListViewModel.SECTION.UNSOLD ||
        !autoRelistSettings.enabled
      ) {
        return originalRenderSection.call(this, ...args);
      }
      const sectionView = originalRenderSection.call(this, ...args);
      const autoRelistContainer = createElement("div", {
        className: "auto-relist",
      });
      appendElements(
        autoRelistContainer,
        createElement("span", {}, translate("plugins.autoRelist.toggle.text")),
      );
      const autoRelistToggle = new UTToggleControl();
      autoRelistToggle.addTarget(
        this,
        (control, eventType, eventData) => {
          autoRelistSettings.autoRelist = eventData.toggleState;
          persistConfiguration();
          if (autoRelistSettings.autoRelist) {
            autoRelistScheduler.start();
          } else {
            autoRelistScheduler.stop();
          }
        },
        EventType.TAP,
      );
      autoRelistToggle.init();
      if (autoRelistSettings.autoRelist) {
        autoRelistToggle.toggle();
      }
      appendElements(autoRelistContainer, autoRelistToggle);
      prependElements(sectionView._header, autoRelistContainer);
      return sectionView;
    };
  },
  order: 3,
  settings: {
    name: "auto-relist",
    title: "plugins.autoRelist.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", autoRelistSettings.enabled, (isEnabled) => {
        if (isEnabled) {
          if (confirm(translate("plugins.dangerous"))) {
            autoRelistSettings.enabled = isEnabled;
            persistConfiguration();
          }
        } else {
          autoRelistSettings.enabled = false;
          persistConfiguration();
        }
      });
      return container;
    },
  },
};

export const autoRelistPlugin = autoRelistPluginDefinition;
