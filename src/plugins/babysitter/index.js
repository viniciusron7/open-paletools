/**
 * Babysitter plugin `babysitterPlugin` (order 3), installed by the plugin list in
 * src/bootstrap/boot.js: SBC submission rate limiter. Once `sbc.delayAfter` submissions were
 * made, a successful submission blocks further submissions for `sbc.delay` seconds and shows a
 * countdown bar.
 *
 * Hooks:
 * - `UTSBCService.prototype.submitChallenge`, wrapped in `run()`.
 *
 * Invariants:
 * - While blocked it shows `plugins.babysitter.warning` (`#SECONDS#` replaced) and returns a new
 *   `EAObservable` that was notified `{success: false}` before being returned; otherwise it calls
 *   the original first, increments the counter and returns the original observable.
 * - The wrapper is always installed; only starting a countdown checks
 *   `babysitter.enabled && babysitter.sbc.enabled` (the counter also grows while disabled).
 * - The countdown runs on `requestAnimationFrame`; when it ends submissions are allowed again and
 *   the counter resets to 0.
 * - `#babysitter-sbc-delay-progressbar` is appended to `body` in `run()`, hidden, and shown or
 *   hidden on CONFIGURATION_SAVED according to `babysitter.enabled`; stylesheet
 *   `paletools-babysitter`.
 * - Nesting follows the real run order of boot.js (V8 sort), not `order`: lock-players (order 11)
 *   runs later, so its `submitChallenge` wrapper runs before this one; sbc-builder-enhancer
 *   (order 6) runs earlier, so this wrapper calls it and skips it while submissions are blocked.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { appendElements, createElement } from "../../core/dom.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { translate } from "../../i18n/translations.js";
import { showErrorNotification } from "../../ui/notifications.js";
import { appendTextInput, appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import babysitterCss from "./babysitter.css";

let babysitterPluginDefinition;

const babysitterSettings = configuration.plugins.babysitter;

babysitterPluginDefinition = {
  run: function () {
    upsertStylesheet("paletools-babysitter", babysitterCss);
    let isSubmitAllowed = true;
    let remainingDelaySeconds = 0;
    let submissionsSinceDelay = 0;
    const delayProgressBar = createElement("div");
    delayProgressBar.id = "babysitter-sbc-delay-progressbar";
    appendElements(document.body, delayProgressBar);
    hideElements(delayProgressBar);
    const originalSubmitChallenge = UTSBCService.prototype.submitChallenge;
    UTSBCService.prototype.submitChallenge = function (...args) {
      if (!isSubmitAllowed) {
        showErrorNotification(
          translate("plugins.babysitter.warning").replace("#SECONDS#", remainingDelaySeconds),
        );
        const rejectedSubmitObservable = new EAObservable();
        rejectedSubmitObservable.notify({
          success: false,
        });
        return rejectedSubmitObservable;
      }
      const submitObservable = originalSubmitChallenge.call(this, ...args);
      submissionsSinceDelay++;
      if (submissionsSinceDelay >= babysitterSettings.sbc.delayAfter) {
        submitObservable.observe(this, (observable, response) => {
          if (response.success) {
            (function (delayMs) {
              if (!babysitterSettings.enabled || !babysitterSettings.sbc.enabled) {
                return;
              }
              showElements(delayProgressBar);
              isSubmitAllowed = false;
              let delayStartTime = Date.now();
              requestAnimationFrame(function updateDelayProgressBar() {
                let elapsedMs = Date.now() - delayStartTime;
                let remainingPercent = Math.max(0, 100 - (elapsedMs / delayMs) * 100);
                delayProgressBar.style.width = remainingPercent + "%";
                remainingDelaySeconds = Math.round((delayMs - elapsedMs) / 1000);
                delayProgressBar.textContent =
                  remainingDelaySeconds > 0 ? remainingDelaySeconds : "";
                if (remainingPercent > 0) {
                  requestAnimationFrame(updateDelayProgressBar);
                } else {
                  isSubmitAllowed = true;
                  submissionsSinceDelay = 0;
                }
              });
            })(1000 * babysitterSettings.sbc.delay);
          }
        });
      }
      return submitObservable;
    };
    listenForEvent(paletoolsEvents.CONFIGURATION_SAVED, () => {
      if (babysitterSettings.enabled) {
        showElements(delayProgressBar);
      } else {
        hideElements(delayProgressBar);
      }
    });
  },
  order: 3,
  settings: {
    name: "babysitter",
    title: "plugins.babysitter.settings.title",
    menu: function () {
      const menuContainer = document.createElement("div");
      appendToggle(menuContainer, "enabled", babysitterSettings.enabled, (isEnabled) => {
        babysitterSettings.enabled = isEnabled;
        persistConfiguration();
      });
      appendTextInput(
        menuContainer,
        "plugins.babysitter.sbc.delay",
        (input) => {
          const delaySeconds = parseInt(input.value);
          if (!isNaN(delaySeconds)) {
            babysitterSettings.sbc.delay = delaySeconds;
            persistConfiguration();
          }
        },
        babysitterSettings.sbc.delay,
      ).setInputType("number");
      appendTextInput(
        menuContainer,
        "plugins.babysitter.sbc.delayAfter",
        (input) => {
          const delayAfter = parseInt(input.value);
          if (!isNaN(delayAfter)) {
            babysitterSettings.sbc.delayAfter = delayAfter;
            persistConfiguration();
          }
        },
        babysitterSettings.sbc.delayAfter,
      ).setInputType("number");
      return menuContainer;
    },
  },
};

export const babysitterPlugin = babysitterPluginDefinition;
