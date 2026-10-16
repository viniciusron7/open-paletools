# How the build works

[`scripts/build.mjs`](../scripts/build.mjs) checks the modules (see [Module rules](MODULE-RULES.md)), then writes:

1. the metadata block of [`src/userscript-header.js`](../src/userscript-header.js), with the build number added to `@version` (see below);
2. the webpack runtime of [`src/runtime/webpack-runtime.js`](../src/runtime/webpack-runtime.js), where it inserts one constant per embedded resource (CSS, images, data) and every module of [`src/manifest.json`](../src/manifest.json), in manifest order, with `import`/`export` removed. Each module sits between `// #region <path>` and `// #endregion <path>` comments.

The result is formatted with Prettier and written to `dist/paletools.user.js`, which is not committed.

All modules share one scope at runtime, like the original bundle, and run in the order of the manifest, which is the initialization order.

The generated script is self-contained: it loads no external code (no `@require`). It only fetches data, such as the update check on pale.tools and prices from fut.gg.

## Version and build number

`npm run build` writes the `@version` of `src/userscript-header.js` followed by a build number: the first build of version 27.1.5 is `27.1.5.1`, the tenth is `27.1.5.10`.

- The build number counts the successful runs of `npm run build` on your machine. It is stored in `.build-number.json`, at the root of the project, which is not committed. Delete it to count from 1 again.
- It starts again at 1 when the `@version` of `src/userscript-header.js` changes (change [`src/config/version.js`](../src/config/version.js) to the same version: a test checks that they match).
- A build refused because of a [module rule](MODULE-RULES.md) writes nothing and does not count.
- `npm test`, `npm run verify` and `npm run update:boot-snapshot` build their own copy: they change neither `dist/` nor the build number.
- Only the `@version` line of the userscript changes. The version shown inside Paletools, which the update check compares with the official release, stays the one of `src/config/version.js`.
