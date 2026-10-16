# Adding a feature

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

2. Add its default settings to the `plugins` object of [`src/config/defaults.js`](../src/config/defaults.js): `myFeature: { enabled: true },`.
3. Add its texts to [`src/i18n/en.js`](../src/i18n/en.js): `"plugins.myFeature.settings.title": "My Feature",`. Languages without the key fall back to English.
4. Add `"src/plugins/my-feature/index.js"` to [`src/manifest.json`](../src/manifest.json), after the modules it imports and before `"src/custom-plugins.js"` (right before it is fine).
5. In [`src/custom-plugins.js`](../src/custom-plugins.js), import it and add it to the list: `export const customPlugins = [myFeaturePlugin];`. Your plugins run after the built-in plugins, in the order of that list (only the settings plugin, which builds the settings screen, runs after them).
6. Run `npm run update:boot-snapshot`, then `npm run verify`. Review the diff of `tests/userscript/boot-fingerprint.snapshot.json`: it should only add lines for your plugin (its hooks and stylesheets); no existing line may change or move. See [Tests](TESTING.md).
7. Run `npm run build`, install the new `dist/paletools.user.js` and try your feature in the Web App.

## Tips

- For styles, put `my-feature.css` next to `index.js`, import it (`import myFeatureCss from "./my-feature.css";`) and apply it in `run()` with `upsertStylesheet("paletools-my-feature", myFeatureCss)` from [`src/ui/stylesheets.js`](../src/ui/stylesheets.js).
- Web App classes and globals (such as `UTSBCSquadOverviewView` or `services`) can only be used if they are listed in [`src/external-globals.json`](../src/external-globals.json). The build reports any that are missing; add them under `webApp`.
- [`src/plugins/refresh-coins/`](../src/plugins/refresh-coins/) and [`src/plugins/decimal-rating/`](../src/plugins/decimal-rating/) are small plugins worth reading as examples.
- The build only accepts code that follows the [module rules](MODULE-RULES.md), and tells you what to fix.
- A new default for an existing setting may not show up in your browser: see [Default settings](SETTINGS.md).
- When something does not work, see [Debugging](DEBUGGING.md).
