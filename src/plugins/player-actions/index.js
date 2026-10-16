/**
 * Player actions plugin (`playerActionsPlugin`, order 6, installed by the plugin list in
 * src/bootstrap/boot.js): installs the action modules of this folder into the item action panels
 * and provides their settings menu.
 *
 * Hooks:
 * - In `run()`, direct overrides on UTDefaultActionPanelView, UTAuctionActionPanelView,
 *   UTQuickListPanelView, UTSlotActionPanelView and UTTransferActionPanelView: `_generate`,
 *   `destroyGeneratedElements`, `dealloc`, plus `render`/`setItem` when present. They wrap the
 *   src/webapp/patches.js overrides and are wrapped by later plugins (e.g. the legacy snipe).
 *
 * Invariants:
 * - Module contract: `canRun(panelClass)`; `inject(prototype)` once per class at run, before the
 *   overrides; `generate(panel, getActionsContainer)` once per panel, after the original and only
 *   when Paletools is enabled (`_generateAddActionsToPanelCalled`);
 *   `render`/`setItem`/`destroyGeneratedElements`/`dealloc` after the original.
 * - `render`/`setItem` store `this._currentItem = args[0]` BEFORE the original; modules read it.
 * - Action containers: `__itemActions` (default, slot), `.ut-button-group` (auction, transfer),
 *   `__panelActions` (quick list). `playerActionModules` order is the button order.
 * - Settings under `configuration.plugins.playerActions`, labels
 *   `plugins.playerActions.settings.<key>`; stylesheet `player-actions`.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { queryElement } from "../../core/dom.js";
import { copyPlayerIdActionModule } from "./copy-player-id.js";
import { copyPlayerNameActionModule } from "./copy-player-name.js";
import { displayApplyConsumableActionModule } from "./display-apply-consumable.js";
import { findLowestPriceActionModule } from "./find-lowest-price.js";
import { futggSearchActionModule } from "./futgg-search.js";
import { listForProfitActionModule } from "./list-for-profit.js";
import { lockPlayerActionModule } from "./lock-player.js";
import { removeAllEvolutionsActionModule } from "./remove-all-evolutions.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import playerActionsCss from "./player-actions.css";

let playerActionsPluginDefinition;

const playerActionsSettings = configuration.plugins.playerActions;

let playerActionModules = [
  copyPlayerIdActionModule,
  futggSearchActionModule,
  findLowestPriceActionModule,
  listForProfitActionModule,
  displayApplyConsumableActionModule,
  lockPlayerActionModule,
  copyPlayerNameActionModule,
  removeAllEvolutionsActionModule,
];

function forEachMatchingPlayerActionModule(predicate, handler) {
  for (const actionModule of playerActionModules) {
    if (predicate(actionModule)) {
      handler(actionModule);
    }
  }
}

playerActionsPluginDefinition = {
  run: function () {
    function installPlayerActionModules(panelViewType, getActionsContainer) {
      const originalGenerate = panelViewType.prototype._generate;
      forEachMatchingPlayerActionModule(
        (actionModule) => actionModule.canRun(panelViewType) && actionModule.inject,
        (actionModule) => actionModule.inject(panelViewType.prototype),
      );
      panelViewType.prototype._generate = function () {
        originalGenerate.call(this);
        if (configuration.enabled) {
          if (!this._generateAddActionsToPanelCalled) {
            forEachMatchingPlayerActionModule(
              (actionModule) => actionModule.canRun(panelViewType) && actionModule.generate,
              (actionModule) => actionModule.generate(this, getActionsContainer),
            );
            this._generateAddActionsToPanelCalled = true;
          }
        }
      };
      const originalDestroyGeneratedElements = panelViewType.prototype.destroyGeneratedElements;
      panelViewType.prototype.destroyGeneratedElements = function () {
        originalDestroyGeneratedElements.call(this);
        forEachMatchingPlayerActionModule(
          (actionModule) =>
            actionModule.canRun(panelViewType) && actionModule.destroyGeneratedElements,
          (actionModule) => actionModule.destroyGeneratedElements(this),
        );
      };
      const originalDealloc = panelViewType.prototype.dealloc;
      panelViewType.prototype.dealloc = function () {
        originalDealloc.call(this);
        forEachMatchingPlayerActionModule(
          (actionModule) => actionModule.canRun(panelViewType) && actionModule.dealloc,
          (actionModule) => actionModule.dealloc(this),
        );
      };
      if (panelViewType.prototype.render) {
        const originalRender = panelViewType.prototype.render;
        panelViewType.prototype.render = function (...args) {
          this._currentItem = args[0];
          originalRender.call(this, ...args);
          forEachMatchingPlayerActionModule(
            (actionModule) => actionModule.canRun(panelViewType) && actionModule.render,
            (actionModule) => actionModule.render(this, ...args),
          );
        };
      }
      if (panelViewType.prototype.setItem) {
        const originalSetItem = panelViewType.prototype.setItem;
        panelViewType.prototype.setItem = function (...args) {
          this._currentItem = args[0];
          originalSetItem.call(this, ...args);
          forEachMatchingPlayerActionModule(
            (actionModule) => actionModule.canRun(panelViewType) && actionModule.setItem,
            (actionModule) => actionModule.setItem(this, ...args),
          );
        };
      }
    }
    installPlayerActionModules(UTDefaultActionPanelView, (panelView) => panelView.__itemActions);
    installPlayerActionModules(UTAuctionActionPanelView, (panelView) =>
      panelView.getRootElement().querySelector(".ut-button-group"),
    );
    installPlayerActionModules(UTQuickListPanelView, (panelView) => panelView.__panelActions);
    installPlayerActionModules(UTSlotActionPanelView, (panelView) => panelView.__itemActions);
    installPlayerActionModules(UTTransferActionPanelView, (panelView) =>
      queryElement(".ut-button-group", panelView),
    );
    upsertStylesheet("player-actions", playerActionsCss);
  },
  order: 6,
  settings: {
    name: "player-actions",
    title: "plugins.playerActions.settings.title",
    menu: function () {
      var menuContainer = document.createElement("div");
      function appendPlayerActionsSettingToggle(settingKey) {
        appendToggle(
          menuContainer,
          "plugins.playerActions.settings." + settingKey,
          playerActionsSettings[settingKey],
          (isEnabled) => {
            playerActionsSettings[settingKey] = isEnabled;
            persistConfiguration();
          },
        );
      }
      appendPlayerActionsSettingToggle("removeAllEvolutions");
      appendPlayerActionsSettingToggle("copyPlayerId");
      appendPlayerActionsSettingToggle("futggSearch");
      appendPlayerActionsSettingToggle("findLowestPrice");
      appendPlayerActionsSettingToggle("listForProfit");
      appendPlayerActionsSettingToggle("listForProfitAutoPublish");
      appendPlayerActionsSettingToggle("listForProfitDisplayPercentageButtons");
      appendPlayerActionsSettingToggle("displayApplyConsumable");
      appendPlayerActionsSettingToggle("copyPlayerName");
      return menuContainer;
    },
  },
};

export const playerActionsPlugin = playerActionsPluginDefinition;
