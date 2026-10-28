# Commands

Run `npm ci` once after cloning; the other commands need the tools it installs.

| Command                        | What it does                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                       | Installs the build tools pinned in `package-lock.json`.                                                                                                                 |
| `npm run build`                | Checks the modules, then generates `dist/paletools.user.js` from `src/` with the next [build number](BUILD.md#version-and-build-number).                                |
| `npm run check:modules`        | Only checks imports, exports and the [module rules](MODULE-RULES.md).                                                                                                   |
| `npm test`                     | Builds a test copy (`dist/` is not changed), then runs all [tests](TESTING.md) against `src/` and that copy.                                                            |
| `npm run verify`               | `check:modules` + `format:check` + `npm test`. Run it before committing.                                                                                                |
| `npm run format`               | Formats the code with Prettier (`npm run format:check` only checks).                                                                                                    |
| `npm run update:boot-snapshot` | Records the boot snapshot again after an intentional change to the start-up (plugins, hooks, CSS).                                                                      |
| `npm run upstream:check`       | Tells whether a newer official Paletools release is out than the one `src/` follows ([updating](UPDATING.md)).                                                          |
| `npm run upstream:update`      | Ports the latest official release into `src/` and verifies the result ([updating](UPDATING.md#from-the-command-line)).                                                  |
| `npm run upstream:verify`      | Checks that the build of `src/` is still the expected result of the last port (`-- --finish` records the new base; `--conflicts-resolved` after a port with conflicts). |
| `npm run upstream:status`      | Lists the places where `src/` differs from the release it follows (this project's own changes).                                                                         |

Extra arguments after `--` go to `node --test`, for example `npm test -- --test-name-pattern=boot`.

In Claude Code, `/update-paletools` runs the whole update of a new Paletools release (see [Updating](UPDATING.md)).
