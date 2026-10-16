/**
 * Player action module (default and slot panels): a lock/unlock button and the `lockPlayer`
 * shortcut, backed by src/club/locked-items.js, for non-loan player items.
 *
 * Invariants:
 * - Gated by `configuration.plugins.lockPlayers.enabled` (not playerActions); shown when
 *   `isPlayer()`, `loans === -1` and `definitionId > 0`. The button is always created at
 *   generation, hidden until render.
 * - Toggle: an unlock override is removed first; else a manually or rule-locked player is
 *   unlocked; else locked. Elements with `data-lock-override-id` get or lose class `locked`.
 * - Shortcut `lockPlayer` (key in `configuration.plugins.snipe.buttons.customActions`, hint
 *   `.lock-player > .btn-text`).
 *
 * Known issues (kept as-is):
 * - The shortcut checks `panel._onFindLowestPrice` before calling `_onLockPlayer`, so it works
 *   only when the find-lowest-price button exists on that panel.
 * - `updateLockPlayerButton` assumes `_lockPlayerButton`; a panel generated while Paletools was
 *   disabled throws on a later render once Paletools and `lockPlayers.enabled` are both on.
 */
import {
  getItemLockOverrideId,
  hasUnlockOverride,
  isItemLocked,
  isItemLockedByRules,
  isItemManuallyLocked,
  lockItem,
  removeUnlockOverride,
  unlockItem,
} from "../../club/locked-items.js";
import { configuration } from "../../config/configuration.js";
import { addClasses, appendElements, queryElements, removeClasses } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { getCurrentItemDetailsPanelView } from "./helpers.js";
import { registerKeyboardShortcut } from "../../ui/keyboard-shortcuts.js";

const lockPlayerActionSettings = configuration.plugins.lockPlayers;

function updateLockPlayerButton(panelView, player) {
  if (lockPlayerActionSettings.enabled && configuration.enabled) {
    if (player.isPlayer() && -1 === player.loans && player.definitionId > 0) {
      panelView._player = player;
      panelView._lockPlayerButton.setText(
        isItemLocked(player)
          ? translate("plugins.lockPlayers.playerAction.unlock")
          : translate("plugins.lockPlayers.playerAction.lock"),
      );
      panelView._lockPlayerButton.setDisplay(true);
    } else {
      panelView._lockPlayerButton.setDisplay(false);
    }
  }
}

export const lockPlayerActionModule = {
  canRun: (panelViewType) =>
    panelViewType === UTDefaultActionPanelView || panelViewType === UTSlotActionPanelView,
  inject: () => {
    registerKeyboardShortcut(
      "lockPlayer",
      () => configuration.plugins.snipe.buttons.customActions.lockPlayer,
      (lockPlayer) => (configuration.plugins.snipe.buttons.customActions.lockPlayer = lockPlayer),
      "plugins.lockPlayers.playerAction.lock",
      () => {
        const panelView = getCurrentItemDetailsPanelView();
        if (panelView && panelView._onFindLowestPrice) {
          panelView._onLockPlayer();
        }
      },
      ".lock-player > .btn-text",
    );
  },
  render: (panelView, item) => updateLockPlayerButton(panelView, item),
  setItem: (panelView, item) => updateLockPlayerButton(panelView, item),
  generate: (panelView, getActionsContainer) => {
    panelView._lockPlayerButton = new UTGroupButtonControl();
    panelView._lockPlayerButton.init();
    addClasses(panelView._lockPlayerButton, "lock-player");
    panelView._onLockPlayer = function () {
      const player = panelView._player;
      const lockOverrideId = getItemLockOverrideId(player);
      const lockOverrideElements = lockOverrideId
        ? queryElements('[data-lock-override-id="' + lockOverrideId + '"]')
        : [];
      const isLockedByDefinition = isItemManuallyLocked(player);
      const isLockedByRule = isItemLockedByRules(player);
      if (hasUnlockOverride(player)) {
        removeUnlockOverride(player);
        if (isItemLocked(player)) {
          panelView._lockPlayerButton.setText(translate("plugins.lockPlayers.playerAction.unlock"));
          addClasses(lockOverrideElements, "locked");
        } else {
          panelView._lockPlayerButton.setText(translate("plugins.lockPlayers.playerAction.lock"));
          removeClasses(lockOverrideElements, "locked");
        }
      } else if (isLockedByDefinition || isLockedByRule) {
        unlockItem(player);
        panelView._lockPlayerButton.setText(translate("plugins.lockPlayers.playerAction.lock"));
        removeClasses(lockOverrideElements, "locked");
      } else {
        lockItem(player);
        panelView._lockPlayerButton.setText(translate("plugins.lockPlayers.playerAction.unlock"));
        addClasses(lockOverrideElements, "locked");
      }
    };
    panelView._lockPlayerButton.addTarget(
      panelView,
      () => panelView._onLockPlayer(),
      EventType.TAP,
    );
    panelView._lockPlayerButton.setDisplay(false);
    appendElements(getActionsContainer(panelView), panelView._lockPlayerButton.getRootElement());
  },
  destroyGeneratedElements: (panelView) => {
    if (panelView._lockPlayerButton) {
      panelView._lockPlayerButton.destroy();
    }
  },
};
