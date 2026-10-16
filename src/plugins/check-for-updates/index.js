/**
 * Check for updates plugin `checkForUpdatesPlugin` (order 10002), installed by the plugin list in
 * src/bootstrap/boot.js: compares `paletoolsVersion` with `<paletoolsBaseUrl>/fifa/version.txt`
 * and, when a newer version exists, shows a dialog with the install link and the changelog from
 * `/fifa/dist/<version>/changelog.txt`.
 *
 * Invariants:
 * - `run()` is async and boot awaits it, so every plugin after it in the effective run order
 *   (it runs 36th of the 73 built-in entries, see src/bootstrap/boot.js), the plugins of
 *   src/custom-plugins.js, the settings plugin and APP_LOADED wait until the check settles.
 * - Runs only when `configuration.enabled && checkForUpdates.enabled` and
 *   `canAccessExternalHosts()`; the flags are re-checked before the dialog; every error is
 *   swallowed. Both requests use `cache: "no-store"`.
 * - Versions must match `v?digits(.digits)*` with safe-integer parts; parts are compared
 *   numerically and missing parts count as 0.
 * - The changelog is HTML-escaped (`&`, `<`, `>`) and newlines become `<br />` before injection;
 *   keep the escaping, the text comes from a remote host.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { paletoolsVersion } from "../../config/version.js";
import { canAccessExternalHosts, paletoolsBaseUrl, requestHttp } from "../../core/http.js";
import { showDialog } from "../../ui/dialog.js";
import { appendToggle } from "../../ui/settings-controls.js";

let checkForUpdatesPluginDefinition;

const checkForUpdatesSettings = configuration.plugins.checkForUpdates;

function parsePaletoolsVersion(versionText) {
  const normalizedVersion = versionText.trim().replace(/^v/i, "");
  if (!/^\d+(?:\.\d+)*$/.test(normalizedVersion)) {
    return null;
  }
  const parts = normalizedVersion.split(".").map(Number);
  return parts.every(Number.isSafeInteger)
    ? {
        value: normalizedVersion,
        parts: parts,
      }
    : null;
}

checkForUpdatesPluginDefinition = {
  run: async function () {
    if (configuration.enabled && checkForUpdatesSettings.enabled) {
      try {
        if (!(await canAccessExternalHosts())) {
          return;
        }
        const versionResponse = await requestHttp(
          paletoolsBaseUrl + "/fifa/version.txt",
          "GET",
          null,
          {
            cache: "no-store",
          },
        );
        if (versionResponse.ok === false) {
          return;
        }
        const latestVersionText =
          typeof versionResponse.text === "function"
            ? await versionResponse.text()
            : versionResponse.responseText;
        if (typeof latestVersionText !== "string") {
          return;
        }
        const latestVersion = parsePaletoolsVersion(latestVersionText);
        const currentVersion = parsePaletoolsVersion(paletoolsVersion);
        if (
          !latestVersion ||
          !currentVersion ||
          !(function (latestParts, currentParts) {
            for (
              let index = 0;
              index < Math.max(latestParts.length, currentParts.length);
              index++
            ) {
              const difference = (latestParts[index] || 0) - (currentParts[index] || 0);
              if (difference !== 0) {
                return difference > 0;
              }
            }
            return false;
          })(latestVersion.parts, currentVersion.parts)
        ) {
          return;
        }
        const changelogHtml = await (async function (version) {
          try {
            const changelogResponse = await requestHttp(
              paletoolsBaseUrl + "/fifa/dist/" + version + "/changelog.txt",
              "GET",
              null,
              {
                cache: "no-store",
              },
            );
            if (changelogResponse.ok === false || changelogResponse.status >= 400) {
              return "";
            }
            const changelogText =
              typeof changelogResponse.text === "function"
                ? await changelogResponse.text()
                : changelogResponse.responseText;
            return typeof changelogText === "string" && changelogText.trim()
              ? changelogText
                  .replace(/&/g, "&amp;")
                  .replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;")
                  .replace(/\r\n|\r|\n/g, "<br />")
              : "";
          } catch {
            return "";
          }
        })(latestVersion.value);
        if (!configuration.enabled || !checkForUpdatesSettings.enabled) {
          return;
        }
        const installUrl = "" + paletoolsBaseUrl;
        showDialog(
          [
            {
              labelEnum: enums.UIDialogOptions.OK,
            },
          ],
          "Paletools Update v" + latestVersion.value,
          'Install from <a href="' +
            installUrl +
            '" target="_blank" rel="noopener noreferrer">' +
            installUrl +
            "</a>" +
            (changelogHtml ? "<br /><br />" + changelogHtml : ""),
        );
      } catch {}
    }
  },
  order: 10002,
  settings: {
    name: "checkForUpdates",
    title: "plugins.checkForUpdates.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", checkForUpdatesSettings.enabled, (isEnabled) => {
        checkForUpdatesSettings.enabled = isEnabled;
        persistConfiguration();
      });
      return container;
    },
  },
};

export const checkForUpdatesPlugin = checkForUpdatesPluginDefinition;
