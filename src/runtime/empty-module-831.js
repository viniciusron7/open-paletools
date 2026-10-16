/**
 * Plugin-list entry `getEmptyModule831Default`, the `importModule.n` getter of the empty webpack
 * module 831, kept where the original bundle had it (between the SBC builder enhancer and the
 * smart builder solver in src/manifest.json). Imported only by the plugin list of
 * src/bootstrap/boot.js.
 *
 * Invariants:
 * - `getEmptyModule831Default()` returns module 831's exports object `{}`, not undefined: it
 *   survives the plugin filter and takes part in the sort without `order`, which changes the
 *   effective plugin run order in V8. Removing the entry or making it falsy changes that order
 *   (see src/bootstrap/boot.js).
 * - `importModule(831)` runs when this module is evaluated, as in the original bundle.
 */
var emptyModule831Exports = importModule(831);

export var getEmptyModule831Default = importModule.n(emptyModule831Exports);
