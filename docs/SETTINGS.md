# Default settings

English | [Português (Brasil)](pt-BR/SETTINGS.md) | [Español](es/SETTINGS.md)

The default value of every setting is defined in [`src/config/defaults.js`](../src/config/defaults.js) (`plugins.<name>` stores the settings of each plugin).

Modifying an existing default only affects browsers that have not saved that setting yet. Paletools saves all settings on the first run in the `paletools:settings` entry of the Web App's `localStorage` (shared with the official Paletools), and saved values take precedence over code defaults. New setting keys are always applied to existing installations because saved settings are merged onto the defaults object.

To apply a modified default in a browser that has already run Paletools:

- change the setting directly in the Paletools settings screen inside the Web App, or
- delete the `paletools:settings` entry from the `localStorage` of `https://www.ea.com` (via the browser's developer tools) and reload the Web App, resetting all Paletools settings.

How settings are loaded and persisted is documented at the top of [`src/config/configuration.js`](../src/config/configuration.js).
