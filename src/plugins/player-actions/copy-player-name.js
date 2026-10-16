/**
 * Player action module (default, slot, auction and transfer panels): a 'copy player name' button,
 * shown for players only, and the `copyPlayerName` keyboard shortcut.
 *
 * Invariants:
 * - `inject` registers shortcut `copyPlayerName` (key in
 *   `configuration.plugins.snipe.buttons.customActions.copyPlayerName`, hint selector
 *   `.copy-player-name > .btn-text`); `registerKeyboardShortcut` de-duplicates by name, so the
 *   per-class calls register it once. It acts through `panel._onCopyPlayerName`.
 * - Copies `getStaticData().getFullName()`; translation keys
 *   `plugins.playerActions.copyPlayerName[.success]`.
 *
 * Known issues (kept as-is):
 * - `render`/`setItem` call `_copyPlayerNameButton.setDisplay` whenever the setting is on; a
 *   panel generated while Paletools was disabled, or before the setting was enabled, throws
 *   there.
 */
import { configuration } from "../../config/configuration.js";
import { copyTextToClipboard } from "../../core/clipboard.js";
import { addClasses, appendElements } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { getCurrentItemDetailsPanelView } from "./helpers.js";
import { registerKeyboardShortcut } from "../../ui/keyboard-shortcuts.js";
import { showSuccessNotification } from "../../ui/notifications.js";

const copyPlayerNameActionSettings = configuration.plugins.playerActions;

export const copyPlayerNameActionModule = {
  canRun: (panelViewType) =>
    panelViewType === UTDefaultActionPanelView ||
    panelViewType === UTSlotActionPanelView ||
    panelViewType === UTAuctionActionPanelView ||
    panelViewType === UTTransferActionPanelView,
  inject: () => {
    registerKeyboardShortcut(
      "copyPlayerName",
      () => configuration.plugins.snipe.buttons.customActions.copyPlayerName,
      (copyPlayerName) =>
        (configuration.plugins.snipe.buttons.customActions.copyPlayerName = copyPlayerName),
      "plugins.playerActions.copyPlayerName",
      () => {
        if (!copyPlayerNameActionSettings.copyPlayerName) {
          return;
        }
        const panelView = getCurrentItemDetailsPanelView();
        if (panelView && panelView._onCopyPlayerName) {
          panelView._onCopyPlayerName();
        }
      },
      ".copy-player-name > .btn-text",
    );
  },
  render: (panelView, item) => {
    if (copyPlayerNameActionSettings.copyPlayerName) {
      panelView._copyPlayerNameButton.setDisplay(item.isPlayer());
    }
  },
  setItem: (panelView, item) => {
    if (copyPlayerNameActionSettings.copyPlayerName) {
      panelView._copyPlayerNameButton.setDisplay(item.isPlayer());
    }
  },
  generate: (panelView, getActionsContainer) => {
    if (copyPlayerNameActionSettings.copyPlayerName) {
      panelView._onCopyPlayerName = function () {
        if (panelView._currentItem) {
          copyTextToClipboard(panelView._currentItem.getStaticData().getFullName());
          showSuccessNotification(translate("plugins.playerActions.copyPlayerName.success"));
        }
      };
      panelView._copyPlayerNameButton = new UTGroupButtonControl();
      addClasses(panelView._copyPlayerNameButton, "copy-player-name");
      panelView._copyPlayerNameButton.init();
      panelView._copyPlayerNameButton.setText(translate("plugins.playerActions.copyPlayerName"));
      panelView._copyPlayerNameButton.addTarget(
        panelView,
        () => panelView._onCopyPlayerName(),
        EventType.TAP,
      );
      appendElements(
        getActionsContainer(panelView),
        panelView._copyPlayerNameButton.getRootElement(),
      );
    }
  },
  destroyGeneratedElements: (panelView) => {
    if (panelView._copyPlayerNameButton) {
      panelView._copyPlayerNameButton.destroy();
    }
  },
};
