# open-paletools

The Paletools userscript for the EA SPORTS FC Ultimate Team Web App, as readable, modular source code. Change what you want in `src/`, build it with one command and install the result in Tampermonkey.

Unofficial: based on Paletools 27.2.1 by Paleta. Not affiliated with Paleta or EA.

## Install

Requires [Git](https://git-scm.com/) and [Node.js](https://nodejs.org/) 22.13 or later.

```sh
git clone https://github.com/viniciusron7/open-paletools.git
cd open-paletools
npm ci          # installs the build tools (once)
npm run build   # writes dist/paletools.user.js
```

Then, in [Tampermonkey](https://chromewebstore.google.com/detail/dhdgffkkebhmkfjojejmpbldmpobfkfo):

1. Open the dashboard and click **+** (create a new script).
2. Replace the whole template with the content of `dist/paletools.user.js` and save.
3. Disable the official Paletools if you have it installed: with both enabled, they can conflict, or only the official one runs.

After every change in `src/`, run `npm run build` again and replace the script content in Tampermonkey. To get a new version of this project, run `git pull` and do the same ([more about updating](docs/UPDATING.md)).

## Updating to a new Paletools release

When Paleta publishes a new Paletools release, port it into `src/` with one command. Your own plugins and changes are kept, and the result is verified statement by statement against the new release:

- in [Claude Code](https://claude.com/claude-code): `/update-paletools` (ports, resolves conflicts, names and organizes the new code, runs every check);
- from the command line: `npm run upstream:check`, then `npm run upstream:update` ([how it works](docs/UPDATING.md)).

## Where the code is

| What                                           | Where                                                                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Script name, `@match`/`@grant` lines           | [`src/userscript-header.js`](src/userscript-header.js)                                                                           |
| Version                                        | `@version` in [`src/userscript-header.js`](src/userscript-header.js) and [`src/config/version.js`](src/config/version.js)        |
| Default settings                               | [`src/config/defaults.js`](src/config/defaults.js) ([read this first](docs/SETTINGS.md))                                         |
| UI texts                                       | [`src/i18n/`](src/i18n/), one file per language (English is the reference table)                                                 |
| Your own plugins                               | [`src/custom-plugins.js`](src/custom-plugins.js) ([adding a feature](docs/ADDING-A-FEATURE.md))                                  |
| Player snipe (engine, pauses, prices)          | [`src/plugins/player-snipe/core.js`](src/plugins/player-snipe/core.js)                                                           |
| Player snipe: Web App search/buy, selection    | [`market.js`](src/plugins/player-snipe/market.js) and [`selection.js`](src/plugins/player-snipe/selection.js) in the same folder |
| Bulk Buy (plan, budget, execution)             | [`src/plugins/bulk-buy/core.js`](src/plugins/bulk-buy/core.js)                                                                   |
| Bulk Buy: OVR search, candidates, balance      | [`src/plugins/bulk-buy/market.js`](src/plugins/bulk-buy/market.js)                                                               |
| Sessions, dialogs and mutual exclusion of both | [`src/plugins/market-automation/sessions.js`](src/plugins/market-automation/sessions.js)                                         |
| Buttons and hooks of both automations          | `index.js` of [`player-snipe`](src/plugins/player-snipe/index.js) and [`bulk-buy`](src/plugins/bulk-buy/index.js)                |
| Legacy snipe (shortcuts, queue, confirmation)  | [`src/plugins/snipe/`](src/plugins/snipe/)                                                                                       |
| Auto Snipe (Paletools 27.2.1, Transfers tile)  | [`src/plugins/auto-snipe/`](src/plugins/auto-snipe/)                                                                             |
| Album and gallery Buy button, bought dialog    | [`src/plugins/album/album-view-controller.js`](src/plugins/album/album-view-controller.js)                                       |
| Upstream update tools (port a new release)     | [`scripts/upstream/`](scripts/upstream/), the release `src/` follows in [`upstream/`](upstream/)                                 |
| Built-in plugin list and boot sequence         | [`src/bootstrap/boot.js`](src/bootstrap/boot.js)                                                                                 |
| Global Web App patches                         | [`src/webapp/patches.js`](src/webapp/patches.js)                                                                                 |
| Prototype hook engine                          | [`src/core/prototype-override.js`](src/core/prototype-override.js)                                                               |
| Any other feature                              | [`src/plugins/`](src/plugins/), one folder per feature (e.g. `sbc-auto-solver`, `my-packs`)                                      |

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
scripts/                 build and checks; scripts/upstream/ ports new Paletools releases
upstream/                the official release src/ follows (base.user.js, base.json)
tests/                   tests and a simulated Web App
docs/                    documentation (see below)
```

## More documentation

- [Adding a feature](docs/ADDING-A-FEATURE.md): write your own plugin, step by step.
- [Updating and the official Paletools](docs/UPDATING.md): porting a new Paletools release, getting new versions of this project, and running next to the official script.
- [Default settings](docs/SETTINGS.md): why a changed default may not show up, and how to reset the settings.
- [Debugging](docs/DEBUGGING.md): finding errors and their source module.
- [Commands](docs/COMMANDS.md): every npm command of the project.
- [Tests](docs/TESTING.md): what the tests cover and how to update the boot snapshot.
- [Module rules](docs/MODULE-RULES.md): what the build requires from the code in `src/`.
- [How the build works](docs/BUILD.md): how `src/` becomes a single userscript.
- [Invariants](docs/INVARIANTS.md): behavior that is easy to break by accident (sniping, Bulk Buy, boot), and known defects.
