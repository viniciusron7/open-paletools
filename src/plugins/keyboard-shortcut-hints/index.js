/**
 * Keyboard shortcut hints plugin `keyboardShortcutHintsPlugin` (order -100, no settings),
 * installed by the plugin list in src/bootstrap/boot.js: renders ` [ key ]` after the elements of
 * assigned keyboard shortcuts through stylesheet `paletools-key-listener`, built from
 * `iterateKeyboardShortcuts()`.
 *
 * Invariants:
 * - Rebuilt on every CONFIGURATION_SAVED (stylesheet removed, then upserted); shortcuts without
 *   `cssSelector` or with the unassigned key are skipped.
 *
 * Known issues (kept as-is):
 * - Order -100 is meant to run it first, but with the inconsistent comparator of
 *   src/bootstrap/boot.js it runs 38th in V8, after player-actions, import-sbc,
 *   sbc-builder-enhancer and sbc-smart-builder (among others) have registered their shortcuts;
 *   those of plugins that run later (repeat-sbc, sbc-template-builder,
 *   add-multiple-players-to-squad) are missing from the initial stylesheet until the next
 *   CONFIGURATION_SAVED.
 */
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { isUnassignedShortcut, iterateKeyboardShortcuts } from "../../ui/keyboard-shortcuts.js";
import { removeStylesheet, upsertStylesheet } from "../../ui/stylesheets.js";

let keyboardShortcutHintsPluginDefinition;

keyboardShortcutHintsPluginDefinition = {
  run: function () {
    function updateShortcutHintStyles() {
      let css = "";
      for (const shortcut of iterateKeyboardShortcuts()) {
        if (!isUnassignedShortcut(shortcut.getKeyCode())) {
          if (shortcut.cssSelector) {
            css +=
              shortcut.cssSelector + ":after { content: ' [ " + shortcut.getKeyCode() + " ]'  }";
          }
        }
      }
      upsertStylesheet("paletools-key-listener", css);
    }
    updateShortcutHintStyles();
    listenForEvent(paletoolsEvents.CONFIGURATION_SAVED, () => {
      removeStylesheet("paletools-key-listener");
      updateShortcutHintStyles();
    });
  },
  order: -100,
};

export const keyboardShortcutHintsPlugin = keyboardShortcutHintsPluginDefinition;
