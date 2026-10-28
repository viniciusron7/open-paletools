# Updating

English | [Português](pt/UPDATING.md) | [Español](es/UPDATING.md)

There are two types of updates:

- **New official Paletools release** (published by Paleta at `https://pale.tools/fifa/dist/latest/paletools.user.js`): port its changes into `src/` using the upstream tools below.
- **New version of this project** (new commits in the repository): `git pull`, see [Obtaining a new version of this project](#obtaining-a-new-version-of-this-project).

## New official Paletools release

`src/` tracks one specific official release, its **base**: `upstream/base.user.js` contains that release byte for byte as published, and `upstream/base.json` records its version. When Paletools publishes a newer release, the update tools port every change into `src/`, preserve all modifications made in this project (Player Snipe, Bulk Buy, plugins in `src/custom-plugins.js` and edits to built-in modules) and verify the structural equivalence of the result.

### With Claude Code (recommended)

Run `/update-paletools` in Claude Code within the project folder. The command runs the tools below, resolves pending conflicts, organizes new release code into modules with descriptive names and comments, runs all checks and summarizes the changes. Local work must be committed before starting (including `upstream/`): the update refuses to run while the files it modifies (`src/`, `upstream/`, `package.json`, `package-lock.json`, `README.md`, `tests/userscript/`) have uncommitted changes, ensuring `git diff` shows only what the port changed.

### From the command line

```sh
npm run upstream:check     # checks for a newer release (-- --exit-code returns 10 when available)
npm run upstream:update    # ports the latest release into src/
npm run upstream:verify    # verifies src/ against the expected program (run after each edit)
```

`npm run upstream:update` prints a summary and writes `.upstream/<version>/report.md`. When it finishes with "done", the port is complete and verified: the new release becomes the base and the boot snapshot is re-recorded. When it finishes with "ported, with work left" (exit code 2: conflicts, module rule errors, differences, a changed webpack runtime or other issues), the report lists the remaining items: resolve them, run `npm run upstream:verify` until it reports "equivalent", then run `npm run upstream:verify -- --finish` to record the new base (pass `--conflicts-resolved` when the port had conflicts, after reviewing each one). Until then, `npm run upstream:update` refuses to start another port.

New code added by the official release arrives with its original identifiers (`_0x...`), and large new blocks are placed in new modules under `src/upstream-new/<version>/`. The userscript already behaves identically to the official release; renaming and moving that code into permanent modules maintains readability (automated by `/update-paletools`; for manual execution, follow section 3 of [.claude/skills/update-paletools/SKILL.md](../.claude/skills/update-paletools/SKILL.md)). Finally, run `npm run verify`, `npm run build`, and install the new `dist/paletools.user.js`.

Options for `npm run upstream:update -- <options>` (the `--` separator is required to pass flags to the script). Unknown options are rejected (exit code 64).

| Option          | Effect                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| `--file <path>` | Ports a locally downloaded release file instead of fetching the latest one over the network.         |
| `--url <url>`   | Downloads the release from an alternate URL.                                                         |
| `--dry-run`     | Computes the port and writes its report to `.upstream/<version>/dry-run/` without modifying files.   |
| `--force`       | Runs the port even if the release is not newer than the base or while a previous port is unfinished. |
| `--allow-dirty` | Allows running with uncommitted changes in `src/` (forfeiting a clean `git diff` of the port).       |

`npm run upstream:status` lists every point where `src/` differs from its base release: this project's own modifications.

### How the port works

1. The base and the new release are deobfuscated (`scripts/upstream/deobfuscate.mjs`): the string table is decoded statically (without executing release code), and hexadecimal numbers, `!0`/`!1` and `obj["name"]` accesses are normalized. All of Paletools resides in a single webpack module of the release, whose id and identifiers (`_0x...`) change in every release.
2. `src/` is built, and the three programs (base, new release and build of `src/`) are aligned statement by statement (`scripts/upstream/lib/align.mjs`). The comparison ignores identifier names and minifier idioms (`a && b()` equals `if (a) b();`), mapping each `_0x...` identifier to its corresponding name in `src/`.
3. A three-way merge (`scripts/upstream/lib/merge.mjs`) applies the new release's changes (relative to the base) onto the build of `src/`, down to individual expressions, list elements and object properties. Where the official release and this project modified the same code incompatibly, it records a **conflict** and retains this project's version at that point (applying the release's surrounding changes normally).
4. The result is written into the module files of `src/` (`scripts/upstream/lib/apply-src.mjs`): modified code is patched in place while preserving names, comments and formatting; new code is printed using `src/` names for existing bindings; modified CSS, images and data files are updated; translation changes go to `src/i18n/`; statements are placed where the official release evaluates them (large new blocks become new modules listed at the corresponding position in `src/manifest.json`; modules reordered by the release move in the manifest); new functions are placed in the module requiring the fewest new imports without creating cycles. Imports and exports are then fixed (`scripts/upstream/lib/fix-links.mjs`), new Web App globals are added to `src/external-globals.json`, the version is updated across all target files, new metadata lines (e.g. `@connect`) are added to `src/userscript-header.js`, and the files are formatted.
5. **Verification.** The same merge, applied in the reverse direction (this project's modifications onto the new official release), produces the expected program. The build of `src/` must be structurally equivalent to it (`scripts/upstream/lib/equivalence.mjs`: identical statements in the same order, identical operators, properties and literals, consistent binding renames, allowing function declarations to move). At conflict points, the expected program also retains this project's version to avoid false verification failures.
6. Once the build is equivalent and no tasks remain (no conflicts, module rule errors or webpack runtime changes), the new release is recorded as the base and the boot snapshot (`tests/userscript/boot-fingerprint.snapshot.json`) is updated automatically.

### Verification scope

- Proves that the build of `src/` is equivalent to the new official release plus this project's modifications, statement by statement, except for top-level statements containing conflicts: those are excluded from the automated comparison and listed by `npm run upstream:verify` for manual review.
- Code outside Paletools' main webpack module (the webpack runtime) is also compared; if the release modified it, the report indicates that it must be ported manually to `src/runtime/webpack-runtime.js`.
- Like the rest of the test suite, verification never executes the script in the live Web App.
- Defects present in the official release are intentionally preserved as-is and documented in [Invariants](INVARIANTS.md).

### Custom code

- Plugins listed in `src/custom-plugins.js` and modules exclusive to this project are not modified by the port. If the official release removes a built-in function or value used by a custom module, the update retains it and reports a `"removed-but-used"` conflict. Keeping custom features in standalone modules (as described in [Adding a feature](ADDING-A-FEATURE.md)) ensures seamless updates.
- Direct edits to built-in modules are preserved; if the official release modifies the same code, a conflict is generated in the report showing the base, local and release versions.
- Settings, `localStorage` keys and translation keys are never renamed by an update.

### Files used

| Path                         | Description                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `upstream/base.user.js`      | Official release tracked by `src/` (committed in git; replaced on each completed update).                                                 |
| `upstream/base.json`         | Version number and SHA-256 hash of the current base.                                                                                      |
| `.upstream/<version>/`       | Temporary working files of a port (not committed): deobfuscated releases, expected program, pre-port build, `report.md` and `state.json`. |
| `src/upstream-new/<version>` | New code from an official release awaiting organization into permanent modules.                                                           |

### Troubleshooting

- **"src/ has uncommitted changes"**: commit or stash local changes (`git stash`) before running the update.
- **Undo a port**: `git restore -- src upstream tests/userscript package.json package-lock.json README.md` restores tracked files; `git clean -fd src` deletes files created by the port (run `git clean -nd src` first to preview the list). Delete `.upstream/<version>/` as well.
- **"the port to ... is not finished"**: finish it with `npm run upstream:verify -- --finish`, or undo it as described above.
- **"upstream/base.user.js is not the release recorded"**: the base file was modified; restore it with `git restore upstream`.
- **Download failure**: download the release manually and pass `--file <path>`.
- **`upstream:verify` reports differences after manual edits**: an edit changed behavior or evaluation order. The output shows the diverging statement in the expected program and in the current build, along with its module.

## Obtaining a new version of this project

```sh
git pull
npm ci          # only required when package-lock.json changed
npm run build
```

Then update the script content in Tampermonkey with the new `dist/paletools.user.js`.

The generated script defines no `@updateURL` or `@downloadURL`, so Tampermonkey never replaces the local build automatically.

## Coexistence with the official Paletools

- The `@name` metadata is set to `open-paletools` (distinct from the official `Paletools`), so Tampermonkey keeps them as two separate scripts. If changing the name in [`src/userscript-header.js`](../src/userscript-header.js), keep an identifier distinct from the official one.
- Keep the official Paletools disabled while using this build to avoid duplicate buttons and hooks.
- Both share the same saved settings in the `paletools:settings` entry of the Web App's `localStorage` (see [Default settings](SETTINGS.md)).
- The in-app update notice (Check for Updates plugin) refers to the official release on `pale.tools`: installing from that prompt installs the official script, serving only as an indicator that a new version is available to be ported with `/update-paletools` or `npm run upstream:update`.
