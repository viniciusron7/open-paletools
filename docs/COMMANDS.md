# Commands

English | [Português](pt/COMMANDS.md) | [Español](es/COMMANDS.md)

Run `npm ci` once after cloning the repository to install the tools required by the remaining commands.

| Command                        | Description                                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                       | Installs the build and test tools pinned in `package-lock.json`.                                                                                                           |
| `npm run build`                | Checks the modules and generates `dist/paletools.user.js` from `src/` with the next [build number](BUILD.md#version-and-build-number).                                     |
| `npm run check:modules`        | Checks only imports, exports and the [module rules](MODULE-RULES.md).                                                                                                      |
| `npm test`                     | Builds a temporary test copy (without modifying `dist/`) and runs all [tests](TESTING.md) against `src/` and the generated userscript.                                     |
| `npm run verify`               | Runs `check:modules` + `format:check` + `npm test`. Recommended before committing.                                                                                         |
| `npm run format`               | Formats the codebase with Prettier (`npm run format:check` only checks formatting).                                                                                        |
| `npm run update:boot-snapshot` | Updates the boot snapshot after intentional changes to the startup sequence (plugins, hooks, CSS).                                                                         |
| `npm run upstream:check`       | Checks whether a newer official Paletools release is available than the one tracked by `src/` ([updating](UPDATING.md)).                                                   |
| `npm run upstream:update`      | Ports the latest official release into `src/` and verifies the equivalence of the result ([updating](UPDATING.md#from-the-command-line)).                                  |
| `npm run upstream:verify`      | Verifies that the build of `src/` remains equivalent to the expected result of the last port (`-- --finish` records the new base; `--conflicts-resolved` after conflicts). |
| `npm run upstream:status`      | Lists every location where `src/` differs from the tracked base release (this project's own modifications).                                                                |

Extra arguments after `--` are passed to `node --test` (e.g. `npm test -- --test-name-pattern=boot`).

In Claude Code, `/update-paletools` automates the full update workflow for a new Paletools release (see [Updating](UPDATING.md)).
