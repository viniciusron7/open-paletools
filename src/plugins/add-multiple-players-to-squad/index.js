/**
 * Plugin definition `addMultiplePlayersToSquadPlugin` (order 140), installed by the plugin list
 * in src/bootstrap/boot.js. Adds an "add multiple players" button and keyboard shortcut to the
 * SBC squad detail panel; it pushes `AddMultiplePlayersSearchResultsViewController` with a new
 * `AddMultiplePlayersViewModel` built from the panel's challenge and set.
 *
 * Hooks (installed in `run()`):
 * - `UTSBCSquadDetailPanelView.prototype._generate` (original first): appends the button to
 *   `.sbc-button-container` once per view (`_addMultiplePlayersCalled`) when
 *   `configuration.enabled` and the plugin are on; `destroyGeneratedElements` (original first)
 *   clears the shortcut action and destroys the button.
 * - `UTSBCSquadDetailPanelViewController.prototype.getView` (original first): once per controller
 *   (`addMultiplePlayersHandled`) binds the button and the shortcut to
 *   `_eAddMultiplePlayersSelected`.
 * - Adds `UTSBCSquadDetailPanelViewController.prototype._eAddMultiplePlayersSelected` and
 *   `UTSBCSquadDetailPanelView.prototype.getAddMultiplePlayersButton`.
 *
 * Invariants:
 * - Button DOM id `add-multiple-players-to-squad` is also the `cssSelector` of the
 *   `addMultiplePlayers` shortcut (rendered by keyboard-shortcut-hints).
 * - The shortcut key code lives in the snipe settings object
 *   (`configuration.plugins.snipe.buttons.sbc.addMultiplePlayersToSquad`), not in this plugin's.
 * - The search starts with `type = PLAYER`, `sortBy = RATING` and the custom flag
 *   `hideLoans = true`.
 * - Stylesheet id `paletools-sbc-add-multiple-players` (also upserted by squad-slots-view.js).
 *
 * Known issues (kept as-is):
 * - `getView` checks only the plugin flag while `_generate` also needs `configuration.enabled`;
 *   with Paletools globally disabled `getAddMultiplePlayersButton()` is undefined and
 *   `.addTarget` throws.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { accessAttribute, appendElements, queryElement } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { AddMultiplePlayersSearchResultsViewController } from "./search-results-view-controller.js";
import { AddMultiplePlayersViewModel } from "./view-model.js";
import {
  isSearchFilterDropdownOpen,
  registerKeyboardShortcut,
} from "../../ui/keyboard-shortcuts.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { getActiveNavigationController } from "../../webapp/navigation.js";
import addMultiplePlayersToSquadStyles from "./add-multiple-players-to-squad.css";

let addMultiplePlayersToSquadPluginDefinition;

const addMultiplePlayersToSquadSettings = configuration.plugins.addMultiplePlayersToSquad;

addMultiplePlayersToSquadPluginDefinition = {
  run: function () {
    if (addMultiplePlayersToSquadSettings.enabled) {
      upsertStylesheet("paletools-sbc-add-multiple-players", addMultiplePlayersToSquadStyles);
    }
    let addMultiplePlayersShortcutAction = null;
    registerKeyboardShortcut(
      "addMultiplePlayers",
      () => configuration.plugins.snipe.buttons.sbc.addMultiplePlayersToSquad,
      (keyCode) => (configuration.plugins.snipe.buttons.sbc.addMultiplePlayersToSquad = keyCode),
      "plugins.addMultiplePlayersToSquad.button",
      () => addMultiplePlayersShortcutAction && addMultiplePlayersShortcutAction(),
      "#add-multiple-players-to-squad",
    );
    const originalGetView = UTSBCSquadDetailPanelViewController.prototype.getView;
    UTSBCSquadDetailPanelViewController.prototype.getView = function (...args) {
      const squadDetailPanelView = originalGetView.call(this, ...args);
      if (addMultiplePlayersToSquadSettings.enabled) {
        if (!this.addMultiplePlayersHandled) {
          addMultiplePlayersShortcutAction = () =>
            squadDetailPanelView &&
            squadDetailPanelView.getRootElement() &&
            !isSearchFilterDropdownOpen() &&
            this._eAddMultiplePlayersSelected();
          squadDetailPanelView
            .getAddMultiplePlayersButton()
            .addTarget(this, this._eAddMultiplePlayersSelected, EventType.TAP);
        }
        this.addMultiplePlayersHandled = true;
        return squadDetailPanelView;
      } else {
        return squadDetailPanelView;
      }
    };
    UTSBCSquadDetailPanelViewController.prototype._eAddMultiplePlayersSelected = function (
      ...args
    ) {
      const challenge = this._challenge;
      const sbcSet = this._set;
      const addMultiplePlayersController = new AddMultiplePlayersSearchResultsViewController(
        new AddMultiplePlayersViewModel(challenge.squad, challenge, sbcSet),
        challenge,
      );
      const searchCriteria = new UTSearchCriteriaDTO();
      searchCriteria.type = SearchType.PLAYER;
      searchCriteria.sortBy = SearchSortType.RATING;
      searchCriteria.hideLoans = true;
      addMultiplePlayersController.initWithSearchCriteria(searchCriteria);
      getActiveNavigationController().pushViewController(addMultiplePlayersController);
    };
    const originalGenerate = UTSBCSquadDetailPanelView.prototype._generate;
    UTSBCSquadDetailPanelView.prototype._generate = function () {
      originalGenerate.call(this);
      if (
        configuration.enabled &&
        addMultiplePlayersToSquadSettings.enabled &&
        !this._addMultiplePlayersCalled
      ) {
        this._addMultiplePlayersButton = new UTStandardButtonControl();
        this._addMultiplePlayersButton.init();
        this._addMultiplePlayersButton.setText(
          translate("plugins.addMultiplePlayersToSquad.button"),
        );
        accessAttribute(this._addMultiplePlayersButton, "id", "add-multiple-players-to-squad");
        appendElements(
          queryElement(".sbc-button-container", this.__content),
          this._addMultiplePlayersButton,
        );
        this._addMultiplePlayersCalled = true;
      }
    };
    UTSBCSquadDetailPanelView.prototype.getAddMultiplePlayersButton = function () {
      return this._addMultiplePlayersButton;
    };
    const originalDestroyGeneratedElements =
      UTSBCSquadDetailPanelView.prototype.destroyGeneratedElements;
    UTSBCSquadDetailPanelView.prototype.destroyGeneratedElements = function () {
      originalDestroyGeneratedElements.call(this);
      addMultiplePlayersShortcutAction = addMultiplePlayersShortcutAction = null;
      if (this._addMultiplePlayersButton) {
        this._addMultiplePlayersButton.destroy();
      }
    };
  },
  order: 140,
  settings: {
    name: "add-multiple-players-to-squad",
    title: "plugins.addMultiplePlayersToSquad.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", addMultiplePlayersToSquadSettings.enabled, (isEnabled) => {
        addMultiplePlayersToSquadSettings.enabled = isEnabled;
        persistConfiguration();
      });
      return container;
    },
  },
};

export const addMultiplePlayersToSquadPlugin = addMultiplePlayersToSquadPluginDefinition;
