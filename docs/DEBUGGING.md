# Debugging

English | [Português (Brasil)](pt-BR/DEBUGGING.md) | [Español](es/DEBUGGING.md)

- Runtime errors and `console.log` output appear in the browser's developer tools console on the Web App page.
- The installed script is the generated build file: each module is delimited by `// #region src/...` and `// #endregion src/...` comments, allowing stack trace lines to be mapped directly to their source module.
- An unhandled exception in `run()` halts all subsequent plugins and the Paletools settings screen. Wrapping experimental code in `try`/`catch` blocks is recommended during development.
- Internal debug messages are disabled by default: set `isDebugLoggingEnabled` to `true` in [`src/core/logger.js`](../src/core/logger.js) to enable them.
- If a modified default setting does not take effect, check whether a saved setting in the browser is overriding the new default (see [Default settings](SETTINGS.md)) and verify that the official Paletools is disabled (see [Updating](UPDATING.md)).
- `npm test` executes the complete script in a simulated Web App (see [Tests](TESTING.md)): a plugin whose `run()` throws causes the boot test to fail with `"paletools:appStarted must be dispatched"` prior to browser installation. Because the simulated environment uses fake objects, behavior dependent on the live server still requires verification in the Web App.
