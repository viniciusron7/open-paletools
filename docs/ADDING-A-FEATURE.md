# Adding a feature

English | [Português](pt/ADDING-A-FEATURE.md) | [Español](es/ADDING-A-FEATURE.md)

A feature is a plugin: an object with a `run()` function, executed once when the Web App is ready to install the plugin's hooks, and optionally a `settings` block for the Paletools settings screen.

1. Create `src/plugins/my-feature/index.js`:

   ```js
   /**
    * My Feature plugin (`myFeaturePlugin`): behavior description and installed hooks.
    */
   import { configuration, persistConfiguration } from "../../config/configuration.js";
   import { appendToggle } from "../../ui/settings-controls.js";

   const myFeatureSettings = configuration.plugins.myFeature;

   export const myFeaturePlugin = {
     run() {
       // Wrap a Web App method: call the original, add custom behavior, return its result.
       const originalSetSquad = UTSBCSquadOverviewView.prototype.setSquad;
       UTSBCSquadOverviewView.prototype.setSquad = function (...args) {
         const result = originalSetSquad.apply(this, args);
         if (configuration.enabled && myFeatureSettings.enabled) {
           // Custom code: `this` is the view, `args[0]` is the squad.
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

2. Add the default settings to the `plugins` object of [`src/config/defaults.js`](../src/config/defaults.js): `myFeature: { enabled: true },`.
3. Add the UI texts to [`src/i18n/en.js`](../src/i18n/en.js): `"plugins.myFeature.settings.title": "My Feature",`. Languages without the key fall back to the English text.
4. Add `"src/plugins/my-feature/index.js"` to [`src/manifest.json`](../src/manifest.json), after the modules it imports and before `"src/custom-plugins.js"`.
5. In [`src/custom-plugins.js`](../src/custom-plugins.js), import the plugin and add it to the list: `export const customPlugins = [myFeaturePlugin];`. Custom plugins run after the built-in plugins, in the order of that list (only the settings plugin, which builds the settings screen, runs after them).
6. Run `npm run update:boot-snapshot`, then `npm run verify`. Review the diff of `tests/userscript/boot-fingerprint.snapshot.json`: it should only add lines for the new plugin (its hooks and stylesheets); no existing line should change or move. See [Tests](TESTING.md).
7. Run `npm run build` and install the generated `dist/paletools.user.js` to test the feature in the Web App.

## Technical notes

- For styles, place `my-feature.css` next to `index.js`, import it (`import myFeatureCss from "./my-feature.css";`) and apply it in `run()` with `upsertStylesheet("paletools-my-feature", myFeatureCss)` from [`src/ui/stylesheets.js`](../src/ui/stylesheets.js).
- Web App classes and globals (such as `UTSBCSquadOverviewView` or `services`) can only be used if listed in [`src/external-globals.json`](../src/external-globals.json). The build reports any missing identifiers; add them under `webApp`.
- [`src/plugins/refresh-coins/`](../src/plugins/refresh-coins/) and [`src/plugins/decimal-rating/`](../src/plugins/decimal-rating/) serve as examples of small plugins.
- The build strictly enforces the [module rules](MODULE-RULES.md) and reports any required fixes.
- A new default for an existing setting may not take effect immediately in the browser: see [Default settings](SETTINGS.md).
- For troubleshooting errors, see [Debugging](DEBUGGING.md).
- Standalone plugins listed in `src/custom-plugins.js` are preserved untouched across updates to new Paletools releases. If an official release removes a built-in function or value used by a custom plugin, the update retains it and reports a conflict (see [Updating](UPDATING.md#custom-code)).
