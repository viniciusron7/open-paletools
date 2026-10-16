# Commands

Run `npm ci` once after cloning; the other commands need the tools it installs.

| Command                        | What it does                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                       | Installs the build tools pinned in `package-lock.json`.                                                                                  |
| `npm run build`                | Checks the modules, then generates `dist/paletools.user.js` from `src/` with the next [build number](BUILD.md#version-and-build-number). |
| `npm run check:modules`        | Only checks imports, exports and the [module rules](MODULE-RULES.md).                                                                    |
| `npm test`                     | Builds a test copy (`dist/` is not changed), then runs all [tests](TESTING.md) against `src/` and that copy.                             |
| `npm run verify`               | `check:modules` + `format:check` + `npm test`. Run it before committing.                                                                 |
| `npm run format`               | Formats the code with Prettier (`npm run format:check` only checks).                                                                     |
| `npm run update:boot-snapshot` | Records the boot snapshot again after an intentional change to the start-up (plugins, hooks, CSS).                                       |

Extra arguments after `--` go to `node --test`, for example `npm test -- --test-name-pattern=boot`.
