/**
 * Paletools version string. Shown by the donation panel, compared with the published version by
 * the check-for-updates plugin and used as the default `appVersion` setting.
 *
 * Invariants:
 * - Must match `@version` in src/userscript-header.js (a test checks it). check-for-updates
 *   compares it numerically, part by part, with the version file published on pale.tools.
 */
export const paletoolsVersion = "27.1.5";
