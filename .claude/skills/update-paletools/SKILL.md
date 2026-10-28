---
name: update-paletools
description: Update open-paletools to the latest official Paletools release (https://pale.tools/fifa/dist/latest/paletools.user.js) - port every upstream change into src/ while keeping this project's own tools and plugins working, then make the ported code readable. Use when the user asks to update, sync or port Paletools, or asks whether src/ is behind the official release.
---

# Update open-paletools to the latest Paletools release

`src/` is a readable, modular rewrite of the obfuscated Paletools userscript, plus this project's
own tools (Player Snipe, Bulk Buy, `src/custom-plugins.js` and any plugin the user added). The
command-line tooling in `scripts/upstream/` does the port mechanically and proves it; your job
is to run it, resolve what it could not decide, and make the new code as readable as the rest
of `src/`. Read `docs/UPDATING.md` first if you have not.

The rule that makes the update safe: **the build of `src/` must stay equivalent to the expected
program** (the new release with every change this project makes to it). `npm run upstream:verify`
checks exactly that, statement by statement. Renaming bindings, moving functions between modules,
splitting modules (keeping the evaluation order), rewriting `a && b()` as `if (a) b();`, adding
comments: all fine. Anything that changes behaviour makes it fail. Never "fix" upstream bugs
during an update: preserve them and document them (module comment, `docs/INVARIANTS.md`).

## 1. Check and run the port

1. `git status`: work on a branch, with everything committed (the update refuses to run while the
   files it writes have uncommitted changes: src/, upstream/, package\*.json, README.md,
   tests/userscript/; so `git diff` shows exactly what the port changed). If the user has
   uncommitted work, stop and ask them to commit or stash it. Never pass `--allow-dirty` or
   `--force` on your own.
2. `npm run upstream:check`. If `src/` already follows the latest release, say so and stop.
3. `npm run upstream:update`. It downloads the release, deobfuscates it and the base
   (`upstream/base.user.js`), merges, writes `src/`, fixes imports/exports, formats, verifies and
   writes `.upstream/<version>/report.md`.
   - exit code 0 and "done": equivalent, no conflict; the base and the boot snapshot are
     already recorded. Go to step 3 (polish).
   - exit code 2 ("ported, with work left"): read the report and go to step 2.
   - an error: read it. Without network use `--file <downloaded release>`. If it failed half way,
     restore `src/` with git and fix the cause before running it again.

## 2. Resolve what the tool could not decide

Work through `.upstream/<version>/report.md`, section by section:

- **Conflicts**: both the release and this project changed the same code. `src/` kept this
  project's version of that code (the release's other changes around it were applied). Merge
  the release's change into it by hand so that both changes are there
  (the report shows base / src / release excerpts and the module). Typical cases: the release
  edits a plugin list, a hook or a function that this project customized. Keep the project's
  customizations (Player Snipe, Bulk Buy, the market automation sessions, `customPlugins` in the
  boot, removed dead code); add the release's change next to them. The top-level statements
  that hold a conflict are left out of `upstream:verify` (it lists them), so "equivalent" says
  nothing about them: review them twice and explain them to the user. "removed-but-used" means
  the release removed something this project's own code uses: it was kept; leave it.
- **Differences from the expected program** / **module rule errors**: fix them; the messages
  give the module and the line. Never "fix" a difference by dropping a change of this project:
  if a difference is part of a customization, it is a conflict the tool did not see; tell the
  user. Import cycles: move the new function to a module that does not
  create the cycle (functions are hoisted; only statements that run at load time have an order).
- **Problems** / **unresolved identifiers**: names the release uses that `src/` does not have,
  or code that had no place. Find the counterpart in `src/` (search the deobfuscated release in
  `.upstream/<version>/release.deobfuscated.js` and the old one in `base.deobfuscated.js`).
- **Webpack runtime changed**: port it to `src/runtime/webpack-runtime.js` by hand.

Run `npm run upstream:verify` until it says "equivalent", then `npm run check:modules`.

## 3. Make the ported code readable (always)

The build already behaves like the release; now make the new code look like the rest of `src/`.
After every batch of edits run `npm run upstream:verify` (must stay equivalent) and
`npm run check:modules`.

1. **New modules** in `src/upstream-new/<version>/part-N.js` hold the release's new code, in
   evaluation order. Read them, find out what each part is (translation keys such as
   `plugins.autoSnipe.*`, settings keys `configuration.plugins.<name>`, CSS classes, the plugin
   object with `run()`), and move the code into proper modules: usually a new folder
   `src/plugins/<feature>/` (`index.js` exporting `<feature>Plugin`, plus view/controller/helper
   modules), or the existing module it belongs to. Keep the order: replace `part-N.js` in
   `src/manifest.json` by the new modules **at the same position**, in the same statement order
   (a part may hold several features: split it into consecutive modules). Function declarations
   may go anywhere. Delete the emptied `part-N.js` files and the `src/upstream-new/` folder.
   Large string constants the release inlined (CSS) may move to a `.css` file imported as a
   resource (`import autoSnipeCss from "./auto-snipe.css";`), byte for byte.
   A new plugin of the release reaches the boot through the built-in plugin list of
   `src/bootstrap/boot.js` (the tool already put it at the release's position); keep that
   position and its import.
2. **Names**: rename every `_0x...` identifier the port introduced (`grep -rnE "_0x[0-9a-f]{3,}" src`)
   to a descriptive name: top-level bindings (unique across `src/`, see docs/MODULE-RULES.md) and
   locals. Choose names from what the code does, in the style of the surrounding code. Never
   rename property names, settings keys, translation keys, event names, CSS classes or
   localStorage/IndexedDB keys (docs/INVARIANTS.md, section on persisted data).
3. **Idioms**: rewrite minifier idioms that the port printed (`a && b();`, comma sequences,
   `!0`) as plain statements, like the rest of `src/`.
4. **Comments**: every module starts with a comment (responsibility, hooks it installs,
   invariants, "Known issues (kept as-is)"). Write one for each new module and update the
   comments of changed modules when the release changed their behaviour (new settings, hooks,
   UI). Add new upstream automations that buy and new upstream defects to
   `docs/INVARIANTS.md`; add new features to the "Where the code is" table of `README.md`.
5. **Translations**: new keys are already in `src/i18n/<language>.js` (the tool ports the
   release's tables). Do not translate or edit the release's texts.

## 4. Finish

1. `npm run upstream:verify` (equivalent) and `npm run check:modules` (no problem).
2. If step 1 of this skill ended with exit code 2: `npm run upstream:verify -- --finish` records
   the new base (`upstream/base.user.js`, `upstream/base.json`) and the boot snapshot. With
   conflicts it also needs `--conflicts-resolved`: pass it only after checking each conflict.
3. `npm run format`, then `npm run verify` (module checks, formatting and all tests). If only the
   boot snapshot test fails after renames or module moves, the snapshot may record names:
   run `npm run update:boot-snapshot`, review `git diff tests/userscript/boot-fingerprint.snapshot.json`
   (only renamed entries may change) and run `npm run verify` again.
4. Tell the user, briefly: the versions (from -> to); what the release changed (features, fixes,
   new settings, off by default or not); conflicts and how you resolved them; where the new code
   went; the verification result; anything left for them (e.g. trying the new features in the
   Web App, then `npm run build` and reinstalling `dist/paletools.user.js`). Do not commit
   unless they ask; suggest `git add -A && git commit -m "Update to Paletools <version>"`.

Never edit `upstream/base.user.js` or `upstream/base.json` by hand, never remove the user's own
plugins or tools to make a conflict go away, and never weaken `upstream:verify` to make it pass.
