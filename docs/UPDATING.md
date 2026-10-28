# Updating

There are two kinds of updates:

- **A new official Paletools release** (Paleta publishes it at `https://pale.tools/fifa/dist/latest/paletools.user.js`): port its changes into `src/` with the upstream tools below.
- **A new version of this project** (someone pushed to the repository): `git pull`, see [Getting a new version of this project](#getting-a-new-version-of-this-project).

## A new Paletools release

`src/` follows one official release, its **base**: `upstream/base.user.js` is that release, byte for byte as published, and `upstream/base.json` records its version. When Paletools publishes a newer one, the update tools port every change of the release into `src/`, keep everything this project changed (Player Snipe, Bulk Buy, your plugins in `src/custom-plugins.js`, your edits to built-in modules) and prove that the result is exact.

### With Claude Code (recommended)

Run `/update-paletools` in Claude Code, in this folder. It runs the tools below, resolves what they could not decide (conflicts), moves the release's new code into proper modules with descriptive names and comments, runs all checks and tells you what changed. Commit your work before you start (including `upstream/`): the update refuses to run while the files it writes (`src/`, `upstream/`, `package.json`, `package-lock.json`, `README.md`, `tests/userscript/`) have uncommitted changes, so that `git diff` shows exactly what the port changed.

### From the command line

```sh
npm run upstream:check     # is a newer release out? (-- --exit-code: exit code 10 when it is)
npm run upstream:update    # ports the latest release into src/
npm run upstream:verify    # checks src/ against the expected result (run it after every edit)
```

`npm run upstream:update` prints a summary and writes `.upstream/<version>/report.md`. When it ends with "done", the port is complete and verified: the new release is the base and the boot snapshot is recorded again. When it ends with "ported, with work left" (exit code 2: conflicts, module rule errors, differences, a changed webpack runtime or other problems), the report lists what is left: resolve it, run `npm run upstream:verify` until it says "equivalent", then `npm run upstream:verify -- --finish` to record the new base (add `--conflicts-resolved` when the port had conflicts, after checking each of them). Until then, `npm run upstream:update` refuses to start another port.

Either way, the code the release added comes with the release's names (`_0x...`), and large new parts are in new modules under `src/upstream-new/<version>/`. The userscript already behaves exactly like the release; renaming and moving that code into proper modules is for readability (that is what `/update-paletools` does; by hand, follow the steps of [.claude/skills/update-paletools/SKILL.md](../.claude/skills/update-paletools/SKILL.md), section 3). Then run `npm run verify`, `npm run build`, and install the new `dist/paletools.user.js`.

Options of `npm run upstream:update -- <options>` (the `--` is needed: without it npm keeps the options to itself). Unknown options are refused (exit code 64).

| Option          | Effect                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `--file <path>` | Ports a release you downloaded instead of the latest one (no network needed).                    |
| `--url <url>`   | Downloads the release from another address.                                                      |
| `--dry-run`     | Computes the port and writes its report to `.upstream/<version>/dry-run/`; changes nothing else. |
| `--force`       | Ports even when the release is not newer than the base, or while a port is unfinished.           |
| `--allow-dirty` | Runs although `src/` has uncommitted changes (you lose the clean `git diff` of the port).        |

`npm run upstream:status` lists every place where `src/` differs from its base release: this project's own changes, as the update sees them.

### How the port works

1. The base and the new release are deobfuscated (`scripts/upstream/deobfuscate.mjs`): the string table is decoded statically (nothing from the release is executed), hexadecimal numbers, `!0`/`!1` and `obj["name"]` are rewritten. All of Paletools lives in one webpack module of the release, whose id changes between releases; names are random (`_0x...`) and change in every release.
2. `src/` is built, and the three programs (base, new release, build of `src/`) are aligned statement by statement (`scripts/upstream/lib/align.mjs`). The comparison ignores names and minifier idioms (`a && b()` equals `if (a) b();`), so the alignment also learns which `_0x...` name of each release is which name of `src/`.
3. A three-way merge (`scripts/upstream/lib/merge.mjs`) applies the release's changes (relative to the base) to the build of `src/`, down to single expressions, list elements and object properties. Where the release and this project changed the same code differently, it records a **conflict** and keeps this project's version of that code (the release's other changes around it are applied).
4. The result is written into the module files of `src/` (`scripts/upstream/lib/apply-src.mjs`): changed code is patched in place, keeping names, comments and layout; new code is printed from the release with `src/`'s names for existing bindings; changed CSS, images and data files are rewritten; translation changes go to `src/i18n/`; statements are placed where the release evaluates them (a large new block becomes a new module, listed at that place in `src/manifest.json`; a module the release moved is moved in the manifest); new functions go to the module that needs the fewest new imports without creating an import cycle. Then the imports and exports are fixed (`scripts/upstream/lib/fix-links.mjs`), new Web App globals are added to `src/external-globals.json`, the version is updated everywhere it is shown, new metadata lines of the release (e.g. `@connect`) are added to `src/userscript-header.js`, and the files are formatted.
5. **Verification.** The same merge, applied the other way round (this project's changes into the new release), gives the expected program. The build of `src/` must be structurally equivalent to it (`scripts/upstream/lib/equivalence.mjs`: same statements in the same order, same operators, properties and literals, consistent renaming of bindings, functions may move). Each of the two directions checks the other.
6. When the build is equivalent and nothing is left to do (no conflict, no module rule error, no change of the webpack runtime, no problem), the new release becomes the base and the boot snapshot (`tests/userscript/boot-fingerprint.snapshot.json`) is recorded again: an upstream update changes what the script does while booting. Review its diff with git.

### What the verification proves, and what it does not

- It proves that the build of `src/` is the new release plus this project's changes, statement by statement, everywhere except the top-level statements that hold a conflict: those are left out of the comparison (a whole function, for example), and `npm run upstream:verify` lists them every time. Check each of them by hand.
- Code outside Paletools' webpack module (the webpack runtime) is compared too; if the release changed it, the report says so and it must be ported to `src/runtime/webpack-runtime.js` by hand.
- Like the rest of the tests, it never runs the script in the real Web App. A release can depend on a new Web App version: try the new features after installing the build.
- Defects of the release are ported as they are, on purpose, and documented in [Invariants](INVARIANTS.md).

### Your own code

- Plugins listed in `src/custom-plugins.js` and modules that only exist in this project are not changed by the port (new release code is placed next to the release's own code). They use the names of `src/`, which an update does not change. If the release removes a built-in function or value they use, the update keeps it and reports a conflict ("removed-but-used") instead of breaking them. Keep your features in their own modules, as [Adding a feature](ADDING-A-FEATURE.md) describes: they survive every update untouched.
- Edits you made to built-in modules are kept. If the release changes the same code, you get a conflict to resolve (the report shows the base, your version and the release's).
- Settings, localStorage keys and translation keys are not renamed by an update.

### Files

| Path                         | What it is                                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upstream/base.user.js`      | The official release `src/` follows (committed; replaced by each update).                                                                                                              |
| `upstream/base.json`         | Its version and SHA-256.                                                                                                                                                               |
| `.upstream/<version>/`       | Work files of a port (not committed): the deobfuscated releases, the expected program, the build before the port, `report.md`, `state.json`. Delete them when you no longer need them. |
| `src/upstream-new/<version>` | New code of a release waiting to be moved into proper modules (only between a port and its clean-up).                                                                                  |

### Troubleshooting

- **"src/ has uncommitted changes"**: commit or stash them (`git stash`), then run the update again.
- **Undo a port**: `git restore -- src upstream tests/userscript package.json package-lock.json README.md` restores the committed files (commit `upstream/` once, so that git knows it); `git clean -fd src` then deletes the files the port created (it would also delete untracked files of yours in `src/`: run `git clean -nd src` first to see the list). Delete `.upstream/<version>/` too, then port again.
- **"the port to ... is not finished"**: finish it (`npm run upstream:verify -- --finish`), or undo it as above.
- **"upstream/base.user.js is not the release recorded"**: the base was edited; restore it with `git restore upstream`.
- **The download fails**: download the release yourself and use `--file <path>`.
- **`upstream:verify` reports differences after your edits**: an edit changed behaviour (or the evaluation order). The message shows the statement in the expected program and in your build, with its module.

## Getting a new version of this project

```sh
git pull
npm ci          # only needed when package-lock.json changed
npm run build
```

Then replace the script content in Tampermonkey with the new `dist/paletools.user.js`. Keeping your own code in its own plugin folders (see [Adding a feature](ADDING-A-FEATURE.md)) keeps `git pull` simple.

The script has no `@updateURL`/`@downloadURL`, so Tampermonkey never updates or replaces your build by itself: you always install the version you built.

## Running next to the official Paletools

- The script is named `open-paletools`, unlike the official `Paletools`, so Tampermonkey keeps them as two separate scripts. If you rename it in [`src/userscript-header.js`](../src/userscript-header.js), keep it different.
- Disable the official Paletools while you use this one. With both enabled, both may start (duplicate buttons and hooks), or only the official one does and your changes do not show.
- Both use the same saved settings (the `paletools:settings` entry of the Web App's localStorage), see [Default settings](SETTINGS.md).
- The in-app "Paletools Update" notice (Check for Updates plugin) is about the official Paletools: installing from it gives you the official script, not this one. It tells you that a new release is out: port it with `/update-paletools` or `npm run upstream:update`. You can turn the notice off in the Paletools settings ("Check for Updates").
