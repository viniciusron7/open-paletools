/**
 * Player action module (all panel classes): when `playerActions.displayApplyConsumable` is on,
 * shows the native apply-consumable button also for players and managers.
 *
 * Invariants:
 * - Render only and only when `panel._applyConsumableButton` exists; otherwise it keeps the
 *   native condition (consumable, the panel's second `render` argument (after the item; hook
 *   parameter `renderArgument3`) present and not `isDream()`, valid item).
 */
import { configuration } from "../../config/configuration.js";

const displayApplyConsumableActionSettings = configuration.plugins.playerActions;

export const displayApplyConsumableActionModule = {
  canRun: (panelViewType) => true,
  render: (panelView, item, renderArgument3) => {
    if (
      !displayApplyConsumableActionSettings.displayApplyConsumable ||
      !panelView._applyConsumableButton
    ) {
      return;
    }
    const canApplyConsumable =
      item.isConsumable() && renderArgument3 && !renderArgument3.isDream() && item.isValid();
    panelView._applyConsumableButton.setDisplay(
      canApplyConsumable || item.isPlayer() || item.isManager(),
    );
  },
};
