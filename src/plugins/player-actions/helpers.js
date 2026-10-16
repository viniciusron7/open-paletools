/**
 * Helpers for the player action modules: `runIgnoringErrors` (for listeners whose buttons may
 * already be destroyed) and `getCurrentItemDetailsPanelView`, used by the keyboard shortcuts to
 * reach the action panel of the active item details.
 *
 * Invariants:
 * - Lookup order: `_itemDetailController`, `_itemDetailsController`, `itemDetailController`,
 *   `itemDetailsController` of the active controller, then `getCurrentController()`, then
 *   `_panelView`, `panelView`, `_panel`, `panel`; undefined when none.
 */
import { getActiveController } from "../../webapp/navigation.js";

export function runIgnoringErrors(action) {
  try {
    action();
  } catch {}
}

export function getCurrentItemDetailsPanelView() {
  let controller =
    getActiveController()._itemDetailController ||
    getActiveController()._itemDetailsController ||
    getActiveController().itemDetailController ||
    getActiveController().itemDetailsController;
  if (controller && ((controller = controller.getCurrentController()), controller)) {
    return controller._panelView || controller.panelView || controller._panel || controller.panel;
  }
}
