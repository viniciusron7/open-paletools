/**
 * Player action module (default, slot, auction and transfer panels): a button, shown only for
 * evolved players (`upgrades` set), that removes all evolution upgrades with
 * `UTItemActionController.removeAllEvolutionUpgrades` when the Web App provides it.
 *
 * Invariants:
 * - `importModule(491)` (webpack require) and `configuration.plugins.playerActions;` run at
 *   module evaluation and stay in place for initialization order.
 * - `hideLoadingShield()` runs after the request settles; setting
 *   `playerActions.removeAllEvolutions`; class `remove-all-evolutions`.
 */
import { configuration } from "../../config/configuration.js";
import { addClasses, appendElements } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { hideLoadingShield } from "../../webapp/loading-shield.js";
import { observableToPromise } from "../../webapp/observable.js";

importModule(491);

configuration.plugins.playerActions;

const removeAllEvolutionsActionSettings = configuration.plugins.playerActions;

function isEvolvedPlayer(item) {
  return !!(
    item &&
    item.isPlayer &&
    item.isPlayer() &&
    item.upgrades !== null &&
    item.upgrades !== undefined
  );
}

const removeAllEvolutionsActionModuleDefinition = {
  canRun: (panelViewType) =>
    panelViewType === UTDefaultActionPanelView ||
    panelViewType === UTSlotActionPanelView ||
    panelViewType === UTAuctionActionPanelView ||
    panelViewType === UTTransferActionPanelView,
  render: (panelView, item) => {
    if (
      removeAllEvolutionsActionSettings.removeAllEvolutions &&
      panelView._removeAllEvolutionsButton
    ) {
      panelView._removeAllEvolutionsButton.setDisplay(isEvolvedPlayer(item));
    }
  },
  setItem: (panelView, item) => {
    if (
      removeAllEvolutionsActionSettings.removeAllEvolutions &&
      panelView._removeAllEvolutionsButton
    ) {
      panelView._removeAllEvolutionsButton.setDisplay(isEvolvedPlayer(item));
    }
  },
  generate: (panelView, getActionsContainer) => {
    if (removeAllEvolutionsActionSettings.removeAllEvolutions) {
      panelView._onRemoveAllEvolutions = async function () {
        if (!isEvolvedPlayer(panelView._currentItem)) {
          return;
        }
        const itemActionController = new UTItemActionController();
        if (itemActionController.removeAllEvolutionUpgrades) {
          await observableToPromise(
            itemActionController.removeAllEvolutionUpgrades(panelView._currentItem),
          );
          hideLoadingShield();
        }
      };
      panelView._removeAllEvolutionsButton = new UTGroupButtonControl();
      addClasses(panelView._removeAllEvolutionsButton, "remove-all-evolutions");
      panelView._removeAllEvolutionsButton.init();
      panelView._removeAllEvolutionsButton.setText(
        translate("plugins.playerActions.removeAllEvolutions"),
      );
      panelView._removeAllEvolutionsButton.addTarget(
        panelView,
        () => panelView._onRemoveAllEvolutions(),
        EventType.TAP,
      );
      panelView._removeAllEvolutionsButton.setDisplay(false);
      appendElements(
        getActionsContainer(panelView),
        panelView._removeAllEvolutionsButton.getRootElement(),
      );
    }
  },
  destroyGeneratedElements: (panelView) => {
    if (panelView._removeAllEvolutionsButton) {
      panelView._removeAllEvolutionsButton.destroy();
    }
  },
};

export const removeAllEvolutionsActionModule = removeAllEvolutionsActionModuleDefinition;
