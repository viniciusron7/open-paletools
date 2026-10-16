# Default settings

The default value of every setting is in [`src/config/defaults.js`](../src/config/defaults.js) (`plugins.<name>` holds the settings of each plugin).

Changing an existing default only affects browsers that have not saved that setting yet. Paletools saves all its settings on the first run, in the `paletools:settings` entry of the Web App's localStorage (shared with the official Paletools), and saved values win over the defaults. New settings keys always reach existing installs, because the saved settings are merged into the defaults.

To try a changed default in a browser that already ran Paletools, either:

- change the setting in the Paletools settings screen, or
- delete the `paletools:settings` entry from the localStorage of `https://www.ea.com` (in the browser's developer tools) and reload the Web App. This resets all Paletools settings.

How the settings are loaded and saved is described at the top of [`src/config/configuration.js`](../src/config/configuration.js).
