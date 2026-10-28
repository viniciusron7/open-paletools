# How the build works

English | [Português (Brasil)](pt-BR/BUILD.md) | [Español](es/BUILD.md)

[`scripts/build.mjs`](../scripts/build.mjs) validates all modules (see [Module rules](MODULE-RULES.md)) and then assembles the output file:

1. writes the metadata block of [`src/userscript-header.js`](../src/userscript-header.js), appending the build number to `@version` (see below);
2. inserts, inside the webpack runtime of [`src/runtime/webpack-runtime.js`](../src/runtime/webpack-runtime.js), one constant per embedded resource (CSS, images, data) followed by every module of [`src/manifest.json`](../src/manifest.json), in manifest order and with `import`/`export` statements removed. Each module is delimited by `// #region <path>` and `// #endregion <path>` comments.

The output is formatted with Prettier and written to `dist/paletools.user.js` (not committed in git).

At runtime, all modules share a single scope and execute in manifest order, reproducing the initialization order of the original bundle.

The generated script is self-contained: it loads no external code at runtime (no `@require`), only fetching data such as the version check on `pale.tools` and market prices from `fut.gg`.

## Version and build number

`npm run build` writes the `@version` of `src/userscript-header.js` followed by a sequential build number: the first build of version 27.1.5 is `27.1.5.1`, the tenth is `27.1.5.10`.

- The build number counts successful runs of `npm run build` in the local environment and is stored in `.build-number.json` at the project root (not committed in git). Deleting that file resets the counter to 1.
- The counter resets to 1 automatically when `@version` in `src/userscript-header.js` changes (keep [`src/config/version.js`](../src/config/version.js) at the same version, as verified by the test suite).
- A build rejected due to a [module rule](MODULE-RULES.md) violation writes no output and does not increment the counter.
- `npm test`, `npm run verify` and `npm run update:boot-snapshot` build their own temporary copies without modifying `dist/` or the build number.
- Only the `@version` line in the userscript header receives the build suffix; the internal version displayed inside Paletools remains the one defined in `src/config/version.js`.
