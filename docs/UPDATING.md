# Updating and the official Paletools

## Getting a new version

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
- The in-app "Paletools Update" notice (Check for Updates plugin) is about the official Paletools: installing from it gives you the official script, not this one. You can turn it off in the Paletools settings ("Check for Updates").
