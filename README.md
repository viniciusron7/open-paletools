# Paletools — customizable source

The Paletools userscript for the EA SPORTS FC Ultimate Team Web App, as readable, modular source code. Change what you want in `src/`, run one command, and you get a single file to install in Tampermonkey (or another userscript manager). The generated script is self-contained: it loads no external code (no `@require`). It only fetches data, such as the update check on pale.tools and prices from fut.gg.

Unofficial: based on Paletools 27.1.5 by Paleta. Not affiliated with Paleta or EA.

## Quick start

Requires [Git](https://git-scm.com/) and [Node.js](https://nodejs.org/) 22.13 or later.

```sh
git clone https://github.com/viniciusron7/open-paletools paletools
cd paletools
npm ci          # installs the build tools (once)
npm run build   # writes dist/paletools.user.js
```

Then install it:

1. Open the Tampermonkey dashboard and click **+** (create a new script).
2. Replace the whole template with the content of `dist/paletools.user.js` and save.
3. Disable the official Paletools if you have it installed. With both enabled, both may start (duplicate buttons and hooks), or only the official one does and your changes do not show.
4. Open the Web App.

After every change: run `npm run build` again and replace the script content in Tampermonkey.

Good to know:

- The script is named `open-paletools`, unlike the official `Paletools`, so Tampermonkey keeps them as two separate scripts. If you rename it, keep it different.
- It has no `@updateURL`/`@downloadURL`, so Tampermonkey never replaces your build. To get new versions of this project: `git pull`, rebuild and paste again.
- The in-app "Paletools Update" notice (Check for Updates plugin) is about the official Paletools: installing from it gives you the official script, not this one. You can turn it off in the Paletools settings.

## Where to change things

| What                                           | Where                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| Script name, `@match`/`@grant` lines           | `src/userscript-header.js`                                           |
| Version                                        | `@version` in `src/userscript-header.js` and `src/config/version.js` |
| Default settings                               | `src/config/defaults.js` (see the note below)                        |
| UI texts                                       | `src/i18n/<language>.js` (English is the reference table)            |
| Your own plugins                               | `src/custom-plugins.js` (see [Adding a feature](#adding-a-feature))  |
| Player snipe (engine, pauses, prices)          | `src/plugins/player-snipe/core.js`                                   |
| Player snipe: Web App search/buy, selection    | `src/plugins/player-snipe/{market,selection}.js`                     |
| Bulk Buy (plan, budget, execution)             | `src/plugins/bulk-buy/core.js`                                       |
| Bulk Buy: OVR search, candidates, balance      | `src/plugins/bulk-buy/market.js`                                     |
| Sessions, dialogs and mutual exclusion of both | `src/plugins/market-automation/sessions.js`                          |
| Buttons and hooks of both automations          | `src/plugins/{player-snipe,bulk-buy}/index.js`                       |
| Legacy snipe (shortcuts, queue, confirmation)  | `src/plugins/snipe/`                                                 |
| Built-in plugin list and boot sequence         | `src/bootstrap/boot.js`                                              |
| Global Web App patches                         | `src/webapp/patches.js`                                              |
| Prototype hook engine                          | `src/core/prototype-override.js`                                     |
| Any other feature                              | `src/plugins/<name>/` (e.g. `sbc-auto-solver`, `my-packs`)           |

Every module starts with a comment that describes what it does, the hooks it installs, its invariants and its known issues. Before changing sniping, Bulk Buy or the boot, read [`docs/INVARIANTS.md`](docs/INVARIANTS.md).

**Changing a default setting** only affects browsers that have not saved that setting yet. Paletools saves all its settings on the first run, in the `paletools:settings` entry of the Web App's localStorage (shared with the official Paletools), and saved values win over the defaults. To try a changed default, change the setting in the Paletools settings screen, or delete `paletools:settings` (this resets all Paletools settings). New settings keys always reach existing installs.

### Project layout

```
src/
  userscript-header.js   ==UserScript== metadata block
  custom-plugins.js      your own plugins, run after the built-in ones
  manifest.json          every module, in initialization order (the build follows it)
  bootstrap/boot.js      waits for the Web App, applies patches, runs the plugins
  plugins/<name>/        one folder per feature (index.js defines the plugin; .css next to it)
  config/                default settings, loading and saving (localStorage)
  i18n/                  translation tables (en, es, it, pt, de, fr) and translate()
  core/                  generic utilities (DOM, events, HTTP, objects, prototype hooks)
  ui/                    UI components and controls, notifications, shortcuts
  webapp/                Web App integration (navigation, item piles, global patches)
  market/ club/ sbc/ db/ Transfer Market, club, SBC and IndexedDB helpers
  assets/ styles/        images and the global stylesheet, embedded by the build
  runtime/               webpack runtime of the original bundle (do not edit)
  external-globals.json  Web App, browser and userscript APIs the modules may use
scripts/                 build and checks
tests/                   tests and a simulated Web App
docs/INVARIANTS.md       behavior rules that are easy to break
```

## Adding a feature

A feature is a plugin: an object with a `run()` function, called once when the Web App is ready, that installs the plugin's hooks, and optionally a `settings` tile for the Paletools settings screen.

1. Create `src/plugins/my-feature/index.js`:

   ```js
   /**
    * My Feature plugin (`myFeaturePlugin`): what it does, and the hooks it installs.
    */
   import { configuration, persistConfiguration } from "../../config/configuration.js";
   import { appendToggle } from "../../ui/settings-controls.js";

   const myFeatureSettings = configuration.plugins.myFeature;

   export const myFeaturePlugin = {
     run() {
       // Wrap a Web App method: call the original, add your behavior, return its result.
       const originalSetSquad = UTSBCSquadOverviewView.prototype.setSquad;
       UTSBCSquadOverviewView.prototype.setSquad = function (...args) {
         const result = originalSetSquad.apply(this, args);
         if (configuration.enabled && myFeatureSettings.enabled) {
           // Your code: `this` is the view, `args[0]` the squad.
         }
         return result;
       };
     },
     settings: {
       name: "my-feature",
       title: "plugins.myFeature.settings.title",
       menu() {
         const container = document.createElement("div");
         appendToggle(container, "enabled", myFeatureSettings.enabled, (isEnabled) => {
           myFeatureSettings.enabled = isEnabled;
           persistConfiguration();
         });
         return container;
       },
     },
   };
   ```

2. Add its default settings to the `plugins` object of `src/config/defaults.js`: `myFeature: { enabled: true },`.
3. Add its texts to `src/i18n/en.js`: `"plugins.myFeature.settings.title": "My Feature",`. Languages without the key fall back to English.
4. Add `"src/plugins/my-feature/index.js"` to `src/manifest.json`, after the modules it imports and before `"src/custom-plugins.js"` (right before it is fine).
5. In `src/custom-plugins.js`, import it and add it to the list: `export const customPlugins = [myFeaturePlugin];`. Your plugins run after the built-in plugins, in the order of that list (only the settings plugin, which builds the settings screen, runs after them).
6. Run `npm run update:boot-snapshot`, then `npm run verify`. Review the diff of `tests/userscript/boot-fingerprint.snapshot.json`: it should only add lines for your plugin (its hooks and stylesheets); no existing line may change or move.
7. Install the new `dist/paletools.user.js` and try your feature in the Web App.

Tips:

- For styles, put `my-feature.css` next to `index.js`, import it (`import myFeatureCss from "./my-feature.css";`) and apply it in `run()` with `upsertStylesheet("paletools-my-feature", myFeatureCss)` from `src/ui/stylesheets.js`.
- Web App classes and globals (such as `UTSBCSquadOverviewView` or `services`) can only be used if they are listed in `src/external-globals.json`. The build reports any that are missing; add them under `webApp`.
- `src/plugins/refresh-coins/` and `src/plugins/decimal-rating/` are small plugins worth reading as examples.

## Debugging

- The script's errors and `console.log` output appear in the browser's developer tools console on the Web App page.
- The installed script is the generated file: every module sits between `// #region src/...` and `// #endregion src/...` comments, so a line of a stack trace leads you to its source module.
- A `run()` that throws stops every later plugin and the Paletools settings screen. Wrap risky code in `try`/`catch` while you develop.
- Internal debug messages are off: set `isDebugLoggingEnabled` to `true` in `src/core/logger.js` to see them.

## Commands

| Command                        | What it does                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `npm ci`                       | Installs the build tools pinned in `package-lock.json`.                                            |
| `npm run build`                | Checks the modules, then generates `dist/paletools.user.js` from `src/`.                           |
| `npm run check:modules`        | Only checks imports, exports and the module rules below.                                           |
| `npm test`                     | Builds, then runs all tests (against `src/` and the generated userscript).                         |
| `npm run verify`               | `check:modules` + `format:check` + `npm test`. Run it before committing.                           |
| `npm run format`               | Formats the code with Prettier (`npm run format:check` only checks).                               |
| `npm run update:boot-snapshot` | Records the boot snapshot again after an intentional change to the start-up (plugins, hooks, CSS). |

## Module rules

The build puts all modules in one shared scope, in the order of `src/manifest.json`, like the original bundle. That is why these rules exist. `npm run build` and `npm run check:modules` enforce them, and the build writes nothing while one is broken.

- Imports are named and point to a module of the manifest: `import { a, b } from "./file.js"`. Exports are declarations, such as `export function`, `export const`, `export let` or `export class`. No aliases (`as`), default exports, export lists, re-exports, namespace or side-effect imports.
- Anything a module uses must be declared in it, imported, or listed in `src/external-globals.json`.
- Top-level names, including the names of imported resources, must be unique across the whole project.
- No import cycles, no unused imports or exports.
- Do not assign an imported variable (the only exceptions are `export let` bindings marked `@mutable` in their comment). Changing the properties of an exported object is fine.
- A module's top-level code runs in manifest order, so it must not read something declared by a module that comes later in the manifest, directly or through a function it calls.
- No `import.meta`, no top-level `await` or `this`.
- Other files can be imported as embedded resources: `.css`, `.txt` and `.js.txt` as text, `.svg`/`.png`/`.webp` as data URIs, `.gz` as base64 (`import styles from "./my-feature.css"`). They are embedded byte for byte.
- Changing the manifest order changes the initialization order of existing code: only do it on purpose.

## How the build works

`scripts/build.mjs` checks the modules, then writes the metadata block of `src/userscript-header.js` followed by the webpack runtime of `src/runtime/`, where it inserts one constant per embedded resource and every module of the manifest (with `import`/`export` removed) between `// #region <path>` and `// #endregion <path>` comments. The result is formatted with Prettier and written to `dist/paletools.user.js`, which is not committed.

## Tests

- `tests/*.test.cjs`: Player snipe, Bulk Buy and their integration with the Web App, using fake objects. They run against `src/` and against the generated userscript.
- `tests/userscript/boot.test.mjs`: runs the whole userscript in a simulated Web App (no network, no EA account) and compares every call, hook, listener, stylesheet and request of the start-up with `boot-fingerprint.snapshot.json`. It records what the script does, not whether it is right, so also try your changes in the Web App.
- `tests/tooling/`: the build and the module checks.

Known defects of the original script were kept on purpose; they are listed in the module comments and in `docs/INVARIANTS.md`.
