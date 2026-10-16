/**
 * Player action module (default and auction panels, installed by player-actions/index.js): a
 * button that copies the current item's `definitionId` to the clipboard.
 *
 * Invariants:
 * - Setting `playerActions.copyPlayerId` is read at generation; the button has class
 *   `paletools-element`.
 *
 * Known issues (kept as-is):
 * - The success notification 'Player ID copied to clipboard!' is hard-coded English.
 */
import { configuration } from "../../config/configuration.js";
import { copyTextToClipboard } from "../../core/clipboard.js";
import { appendElements } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { showSuccessNotification } from "../../ui/notifications.js";

const copyPlayerIdActionSettings = configuration.plugins.playerActions;

export const copyPlayerIdActionModule = {
  canRun: (panelViewType) =>
    panelViewType === UTDefaultActionPanelView || panelViewType === UTAuctionActionPanelView,
  generate: (panelView, getActionsContainer) => {
    if (copyPlayerIdActionSettings.copyPlayerId) {
      panelView._copyPlayerIdButton = new UTGroupButtonControl();
      panelView._copyPlayerIdButton.init();
      panelView._copyPlayerIdButton.setText(translate("plugins.playerActions.copyPlayerId"));
      panelView._copyPlayerIdButton.addTarget(
        panelView,
        () => {
          if (panelView._currentItem) {
            copyTextToClipboard(panelView._currentItem.definitionId);
            showSuccessNotification("Player ID copied to clipboard!");
          }
        },
        EventType.TAP,
      );
      panelView._copyPlayerIdButton.getRootElement().classList.add("paletools-element");
      appendElements(
        getActionsContainer(panelView),
        panelView._copyPlayerIdButton.getRootElement(),
      );
    }
  },
  destroyGeneratedElements: (panelView) => {
    if (panelView._copyPlayerIdButton) {
      panelView._copyPlayerIdButton.destroy();
    }
  },
};
