/**
 * Disable pack animations plugin `disablePackAnimationsPlugin` (order 10), installed by the
 * plugin list in src/bootstrap/boot.js: skips pack-opening animations unless the item is rated at
 * least `minOvr` or, with `override`, has a special rarity not listed in `raritiesToIgnore`.
 *
 * Hooks (installed in `run()`):
 * - `UTPackAnimationView.prototype.runAnimation`: calls the original only when the animation
 *   runs.
 * - `UTPackAnimationViewController.prototype.runAnimation`: calls the original, or
 *   `this.runCallback()` when skipped; that callback is required or the pack-opening flow stalls.
 *
 * Invariants:
 * - The animation runs when the plugin is disabled, when `minOvr` is set and `rating >= minOvr`,
 *   or when `override` is on, `rareflag > Rare` and the rarity is not in `raritiesToIgnore`.
 * - Config keys `enabled`, `minOvr` (null when cleared), `override`, `raritiesToIgnore` (the menu
 *   only offers TOTW).
 *
 * Known issues (kept as-is):
 * - `hideElements(rarityToggles)` runs before the TOTW toggle is pushed, so that toggle is
 *   visible when the menu opens even if `override` is off.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { translate } from "../../i18n/translations.js";
import { appendTextInput, appendToggle } from "../../ui/settings-controls.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import { rarityIdByName } from "../../webapp/rarities.js";
import { maxOvr, minOvr } from "../../webapp/search-criteria-limits.js";

let disablePackAnimationsPluginDefinition;

const disablePackAnimationsSettings = configuration.plugins.disablePackAnimations;

disablePackAnimationsPluginDefinition = {
  run: function () {
    const shouldRunPackAnimation = (item) =>
      !disablePackAnimationsSettings.enabled ||
      !!(
        disablePackAnimationsSettings.minOvr &&
        item &&
        item.rating >= disablePackAnimationsSettings.minOvr
      ) ||
      !(
        !(disablePackAnimationsSettings.override && item && item.rareflag > rarityIdByName.Rare) ||
        disablePackAnimationsSettings.raritiesToIgnore.includes(item.rareflag)
      );
    const originalPackAnimationViewRunAnimation = UTPackAnimationView.prototype.runAnimation;
    UTPackAnimationView.prototype.runAnimation = function (...args) {
      const item = args[0];
      if (shouldRunPackAnimation(item)) {
        originalPackAnimationViewRunAnimation.call(this, ...args);
      }
    };
    const originalPackAnimationControllerRunAnimation =
      UTPackAnimationViewController.prototype.runAnimation;
    UTPackAnimationViewController.prototype.runAnimation = function () {
      if (shouldRunPackAnimation(this.presentedItem)) {
        originalPackAnimationControllerRunAnimation.call(this);
      } else {
        this.runCallback();
      }
    };
  },
  order: 10,
  settings: {
    name: "disablePackAnimations",
    title: "plugins.disablePackAnimations.settings.title",
    menu: function () {
      const container = document.createElement("div");
      const rarityToggles = [];
      appendToggle(container, "enabled", disablePackAnimationsSettings.enabled, (isEnabled) => {
        disablePackAnimationsSettings.enabled = isEnabled;
        persistConfiguration();
      });
      const minOvrInput = appendTextInput(
        container,
        translate("exclude") + " " + translate("search.ovrRange.input.min"),
        (inputElement) => {
          if (parseInt(inputElement.value)) {
            disablePackAnimationsSettings.minOvr = parseInt(inputElement.value);
            persistConfiguration();
          } else {
            inputElement.value = "";
            disablePackAnimationsSettings.minOvr = null;
            persistConfiguration();
          }
        },
        disablePackAnimationsSettings.minOvr,
      );
      minOvrInput.setInputType("number");
      minOvrInput.setInputAttrs({
        min: minOvr,
        max: maxOvr,
      });
      appendToggle(
        container,
        "plugins.disablePackAnimations.settings.override",
        disablePackAnimationsSettings.override,
        (override) => {
          disablePackAnimationsSettings.override = override;
          persistConfiguration();
          if (override) {
            showElements(rarityToggles);
          } else {
            hideElements(rarityToggles);
          }
        },
      );
      if (!disablePackAnimationsSettings.override) {
        hideElements(rarityToggles);
      }
      rarityToggles.push(
        appendToggle(
          container,
          translate("exclude") + " " + translate("item.raretype" + rarityIdByName.TOTW),
          disablePackAnimationsSettings.raritiesToIgnore.includes(rarityIdByName.TOTW),
          (isExcluded) => {
            if (
              isExcluded &&
              !disablePackAnimationsSettings.raritiesToIgnore.includes(rarityIdByName.TOTW)
            ) {
              disablePackAnimationsSettings.raritiesToIgnore.push(rarityIdByName.TOTW);
            } else if (!isExcluded) {
              const index = disablePackAnimationsSettings.raritiesToIgnore.indexOf(
                rarityIdByName.TOTW,
              );
              if (index > -1) {
                disablePackAnimationsSettings.raritiesToIgnore.splice(index, 1);
              }
            }
            persistConfiguration();
          },
        ),
      );
      return container;
    },
  },
};

export const disablePackAnimationsPlugin = disablePackAnimationsPluginDefinition;
