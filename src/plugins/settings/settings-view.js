/**
 * `SettingsViewController` (exported) and its `SettingsView`: the Paletools settings screen of
 * the tab added by src/plugins/settings/index.js. Renders a reset button, a Backup button
 * (desktop only; pushes `BackupViewController` of ./backup-view-controller.js), a jump menu and
 * one tile per plugin `settings` entry, whose `menu()` builds the tile content.
 *
 * Invariants:
 * - Tiles are sorted by translated title. Each tile has id `paletools-settings-<name>-container`
 *   and an anchor `plugin-title-<name>` (jump-menu target via `location.href = "#..."`) plus a
 *   `go-to-top` link to `#plugins-top`; plugin CSS targets these ids, so `settings.name` values
 *   (including the misspelled `transer-list-send-all-to-club`) are part of the DOM contract.
 * - The view is generated once (`generated`); the menus are built at generation time.
 *
 * Known issues (kept as-is):
 * - Reset removes `paletools:settings` from localStorage, then calls `updateConfiguration`, which
 *   is declared nowhere: the ReferenceError leaves the in-memory configuration and the tiles
 *   unchanged.
 */
import { defaultConfiguration } from "../../config/configuration.js";
import { addClasses, appendElements, createElement, prependElements } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { BackupViewController } from "./backup-view-controller.js";
import { DropdownControl } from "../../ui/controls/dropdown-control.js";
import { getActiveNavigationController } from "../../webapp/navigation.js";

const SettingsViewImpl = function (menus) {
  this._menus = menus;
  EAView.call(this);
};

JSUtils.inherits(SettingsViewImpl, EAView);

SettingsViewImpl.prototype._generate = function () {
  if (!this.generated) {
    let root = document.createElement("div");
    let topCommands = createElement("div", {
      className: "top-commands",
    });
    let settingsWrapper = document.createElement("div");
    settingsWrapper.classList.add("paletools-settings-wrapper");
    settingsWrapper.classList.add("layout-hub");
    settingsWrapper.classList.add("grid");
    root.appendChild(settingsWrapper);
    const resetButton = new UTStandardButtonControl();
    resetButton.init();
    resetButton.setText(translate("plugins.settings.reset"));
    resetButton.addTarget(
      this,
      () => {
        localStorage.removeItem("paletools:settings");
        updateConfiguration(defaultConfiguration);
        settingsWrapper.innerHTML = "";
        renderPluginSettings();
      },
      EventType.TAP,
    );
    appendElements(topCommands, addClasses(resetButton, "reset-settings", "mini"));
    if (!isPhone()) {
      const backupButton = new UTStandardButtonControl();
      backupButton.init();
      backupButton.setText("Backup");
      backupButton.addTarget(
        this,
        () => {
          const backupController = new BackupViewController();
          backupController.init();
          getActiveNavigationController().pushViewController(backupController);
        },
        EventType.TAP,
      );
      appendElements(topCommands, addClasses(backupButton, "mini"));
    }
    prependElements(root, topCommands);
    const settingsView = this;
    function renderPluginSettings() {
      const jumpMenu = new DropdownControl();
      addClasses(jumpMenu, "jump-menu");
      const sortedMenus = Object.keys(settingsView._menus).map(
        (menuKey) => settingsView._menus[menuKey],
      );
      sortedMenus.sort((left, right) =>
        translate(left.title).localeCompare(translate(right.title)),
      );
      for (let pluginMenu of sortedMenus) {
        jumpMenu.addOption(translate(pluginMenu.title), "plugin-title-" + pluginMenu.name);
      }
      jumpMenu.onChange((anchorId) => {
        location.href = "#" + anchorId;
      });
      appendElements(settingsWrapper, jumpMenu);
      appendElements(
        settingsWrapper,
        createElement("a", {
          id: "plugins-top",
        }),
      );
      for (let pluginMenu of sortedMenus) {
        const container = createElement("div", {
          id: "paletools-settings-" + pluginMenu.name + "-container",
          className: "tile col-1-1 settings-container",
        });
        const header = createElement(
          "header",
          '<h3 class="tileHeader"><a id="plugin-title-' +
            pluginMenu.name +
            '">' +
            translate(pluginMenu.title) +
            "</a></h3>",
        );
        container.appendChild(header);
        container.appendChild(pluginMenu.menu());
        container.appendChild(
          createElement("a", {
            className: "go-to-top",
            href: "#plugins-top",
          }),
        );
        settingsWrapper.appendChild(container);
      }
    }
    renderPluginSettings();
    this.__root = root;
    this.generated = true;
  }
};

const SettingsView = SettingsViewImpl;

const SettingsViewControllerImpl = function (menus) {
  this._menus = menus;
  EAViewController.call(this);
};

JSUtils.inherits(SettingsViewControllerImpl, EAViewController);

SettingsViewControllerImpl.prototype._getViewInstanceFromData = function () {
  return new SettingsView(this._menus);
};

SettingsViewControllerImpl.prototype.viewDidAppear = function () {
  this.getNavigationController().setNavigationVisibility(true, true);
};

SettingsViewControllerImpl.prototype.getNavigationTitle = function () {
  return translate("plugins.settings.title");
};

export const SettingsViewController = SettingsViewControllerImpl;
