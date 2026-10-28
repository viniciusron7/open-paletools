# open-paletools

English | [Português](README.pt.md) | [Español](README.es.md)

Modular, deobfuscated source code of the Paletools userscript for the EA SPORTS FC Ultimate Team Web App.

Unofficial: based on Paletools 27.2.1 by Paleta. Not affiliated with Paleta or EA.

## 1. Environment setup

Requires [Git](https://git-scm.com/) and [Node.js](https://nodejs.org/) 22.13 or later.

```sh
git clone https://github.com/viniciusron7/open-paletools.git
cd open-paletools
npm ci          # installs build and test dependencies
```

## 2. Code structure

```
src/
  userscript-header.js   ==UserScript== metadata block
  custom-plugins.js      custom plugins, executed after the built-in ones
  manifest.json          all modules, in initialization order (followed by the build)
  bootstrap/boot.js      waits for the Web App, applies patches and initializes plugins
  plugins/<name>/        one folder per feature (index.js defines the plugin; .css next to it)
  config/                default settings, loading and persistence (localStorage)
  i18n/                  translation tables (en, es, it, pt, de, fr) and translate()
  core/                  generic utilities (DOM, events, HTTP, objects, prototype hooks)
  ui/                    UI components and controls, notifications and shortcuts
  webapp/                Web App integration (navigation, item piles, global patches)
  market/ club/ sbc/ db/ Transfer Market, club, SBC and IndexedDB helpers
  assets/ styles/        images and global stylesheet embedded by the build
  runtime/               webpack runtime of the original bundle (do not edit)
  external-globals.json  Web App, browser and userscript APIs allowed in modules
scripts/                 build, verification and upstream update scripts
upstream/                official release tracked by src/ (base.user.js, base.json)
tests/                   test suite and simulated Web App
docs/                    technical documentation
```

| Component                                      | Location                                                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Script name, `@match`/`@grant` directives      | [`src/userscript-header.js`](src/userscript-header.js)                                                                           |
| Version                                        | `@version` in [`src/userscript-header.js`](src/userscript-header.js) and [`src/config/version.js`](src/config/version.js)        |
| Default settings                               | [`src/config/defaults.js`](src/config/defaults.js) ([details](docs/SETTINGS.md))                                                 |
| UI texts                                       | [`src/i18n/`](src/i18n/), one file per language (English is the reference table)                                                 |
| Custom plugins                                 | [`src/custom-plugins.js`](src/custom-plugins.js) ([creation guide](docs/ADDING-A-FEATURE.md))                                    |
| Player snipe (engine, pauses, prices)          | [`src/plugins/player-snipe/core.js`](src/plugins/player-snipe/core.js)                                                           |
| Player snipe: Web App search/buy, selection    | [`market.js`](src/plugins/player-snipe/market.js) and [`selection.js`](src/plugins/player-snipe/selection.js) in the same folder |
| Bulk Buy (plan, budget, execution)             | [`src/plugins/bulk-buy/core.js`](src/plugins/bulk-buy/core.js)                                                                   |
| Bulk Buy: OVR search, candidates, balance      | [`src/plugins/bulk-buy/market.js`](src/plugins/bulk-buy/market.js)                                                               |
| Sessions, dialogs and mutual exclusion of both | [`src/plugins/market-automation/sessions.js`](src/plugins/market-automation/sessions.js)                                         |
| Buttons and hooks of both automations          | `index.js` of [`player-snipe`](src/plugins/player-snipe/index.js) and [`bulk-buy`](src/plugins/bulk-buy/index.js)                |
| Legacy snipe (shortcuts, queue, confirmation)  | [`src/plugins/snipe/`](src/plugins/snipe/)                                                                                       |
| Auto Snipe (Paletools 27.2.1, Transfers tile)  | [`src/plugins/auto-snipe/`](src/plugins/auto-snipe/)                                                                             |
| Album and gallery Buy button, bought dialog    | [`src/plugins/album/album-view-controller.js`](src/plugins/album/album-view-controller.js)                                       |
| Upstream update tools                          | [`scripts/upstream/`](scripts/upstream/) and base release in [`upstream/`](upstream/)                                            |
| Built-in plugin list and boot sequence         | [`src/bootstrap/boot.js`](src/bootstrap/boot.js)                                                                                 |
| Global Web App patches                         | [`src/webapp/patches.js`](src/webapp/patches.js)                                                                                 |
| Prototype hook engine                          | [`src/core/prototype-override.js`](src/core/prototype-override.js)                                                               |
| Other features                                 | [`src/plugins/`](src/plugins/), one folder per feature (e.g. `sbc-auto-solver`, `my-packs`)                                      |

## 3. Development and validation

- **Creating tools:** create a plugin module under `src/plugins/<name>/` and register it in [`src/custom-plugins.js`](src/custom-plugins.js) ([step-by-step guide](docs/ADDING-A-FEATURE.md)). Standalone modules registered in `custom-plugins.js` are automatically preserved when updating to new Paletools releases.
- **Editing built-in features:** each module in `src/` starts with a header comment describing its responsibilities, installed hooks, invariants and known defects. Refer to [Invariants](docs/INVARIANTS.md), [Module rules](docs/MODULE-RULES.md) and [Default settings](docs/SETTINGS.md) before modifying existing behavior.
- **Validation:**

  ```sh
  npm run verify   # checks module rules, formatting and runs the test suite
  ```

  When intentionally modifying the startup sequence (new plugins, hooks or stylesheets), update the boot snapshot with `npm run update:boot-snapshot` ([testing documentation](docs/TESTING.md)).

## 4. Build and Tampermonkey installation

Generate the final userscript file:

```sh
npm run build   # writes dist/paletools.user.js
```

To install in [Tampermonkey](https://chromewebstore.google.com/detail/dhdgffkkebhmkfjojejmpbldmpobfkfo):

1. Open the dashboard and click **+** to create a new script.
2. Replace the default template with the content of `dist/paletools.user.js` and save.
3. Keep the official Paletools disabled to avoid execution conflicts.

After each change in `src/`, run `npm run build` again and update the script content in Tampermonkey ([build details](docs/BUILD.md)).

## 5. Updating

- **New official Paletools release:** port a new release published by Paleta into `src/` while preserving custom plugins and local changes, verified statement by statement:
  - via [Claude Code](https://claude.com/claude-code): `/update-paletools`;
  - via command line: `npm run upstream:check` and `npm run upstream:update` ([detailed workflow](docs/UPDATING.md)).
- **New version of this repository:** run `git pull`, generate a new build with `npm run build` and update the script in Tampermonkey ([more details](docs/UPDATING.md)).

## 6. Documentation

- [Adding a feature](docs/ADDING-A-FEATURE.md): structure and registration of new plugins.
- [Module rules](docs/MODULE-RULES.md): scope and import constraints enforced by the build.
- [Invariants](docs/INVARIANTS.md): sensitive behaviors (sniping, Bulk Buy, boot) and known defects.
- [Default settings](docs/SETTINGS.md): `localStorage` persistence and resetting values.
- [Debugging](docs/DEBUGGING.md): locating errors and their source modules.
- [Tests](docs/TESTING.md): test suite coverage and updating the boot snapshot.
- [How the build works](docs/BUILD.md): assembling the userscript from `src/`.
- [Commands](docs/COMMANDS.md): reference of project npm scripts.
- [Updating and coexistence with the official Paletools](docs/UPDATING.md): porting official releases and syncing the repository.
