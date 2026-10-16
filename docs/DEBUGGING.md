# Debugging

- The script's errors and `console.log` output appear in the browser's developer tools console on the Web App page.
- The installed script is the generated file: every module sits between `// #region src/...` and `// #endregion src/...` comments, so a line of a stack trace leads you to its source module.
- A `run()` that throws stops every later plugin and the Paletools settings screen. Wrap risky code in `try`/`catch` while you develop.
- Internal debug messages are off: set `isDebugLoggingEnabled` to `true` in [`src/core/logger.js`](../src/core/logger.js) to see them.
- A change that does not show up may be a saved setting winning over a new default: see [Default settings](SETTINGS.md). Also check that the official Paletools is disabled: see [Updating and the official Paletools](UPDATING.md).
- `npm test` runs the whole script in a simulated Web App (see [Tests](TESTING.md)): a plugin whose `run()` throws makes the boot test fail with "paletools:appStarted must be dispatched", before you install the script. The simulated Web App is made of fake objects, so it cannot catch every error.
