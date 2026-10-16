/**
 * Your own plugins (see docs/ADDING-A-FEATURE.md). src/bootstrap/boot.js runs them after
 * the built-in plugin list, in the order of this list, and then the settings plugin, which adds
 * their settings tiles to the Paletools settings screen.
 *
 * To add one: import it here and add it to the list, and list its module in src/manifest.json
 * before this file (this module is evaluated right before src/bootstrap/boot.js).
 *
 * Invariants:
 * - The list is appended after the built-in plugins are sorted, so it never changes their run
 *   order; the `order` property of these plugins is not used.
 * - Like the built-in plugins, a `run()` that throws stops every later plugin and the settings
 *   screen.
 */
export const customPlugins = [];
