/**
 * Template of the userscript body: the webpack 5 runtime of the original bundle, preserved as
 * it was. scripts/build.mjs replaces the `@modules` marker comment inside factory 723 with the
 * embedded resources (CSS and other assets as `const`s) followed by every module of
 * src/manifest.json in manifest order, with import/export syntax removed. All modules therefore
 * share the scope of factory 723 and run in strict mode, in the original initialization order.
 *
 * Invariants:
 * - The marker must occur exactly once (the build fails otherwise) and stay inside factory 723,
 *   after "use strict".
 * - The factory parameters `moduleRecord`, `moduleExports` and `importModule` are the only
 *   runtime names module code may use (src/external-globals.json): src/core/events.js calls
 *   `importModule.r(moduleExports)`, src/plugins/player-actions/remove-all-evolutions.js
 *   `importModule(491)`, src/runtime/empty-module-831.js `importModule(831)` and
 *   `importModule.n`.
 * - 491 and 831 are the original bundle's empty modules (`() => {}`), so their exports are
 *   plain `{}` objects without `__esModule`.
 * - `requireModule` caches each record in `moduleCache`: a factory runs once and later imports
 *   return the same exports object.
 * - Keep the helper semantics: `.n` returns a getter yielding `default` for ES modules and the
 *   exports object itself otherwise (this puts `{}` into the plugin list of
 *   src/bootstrap/boot.js); `.d` defines enumerable getters only for names that are not own
 *   properties yet; `.o` is `hasOwnProperty`; `.r` sets `Symbol.toStringTag` 'Module' and
 *   `__esModule`.
 * - The trailing IIFE requires module 723 once and ignores its exports.
 */
(() => {
  var moduleFactories = {
    723: (moduleRecord, moduleExports, importModule) => {
      "use strict";
      /* @modules */
    },
    491: () => {},
    831: () => {},
  };
  var moduleCache = {};
  function requireModule(moduleId) {
    var cachedModule = moduleCache[moduleId];
    if (cachedModule !== undefined) {
      return cachedModule.exports;
    }
    var loadedModule = (moduleCache[moduleId] = {
      exports: {},
    });
    moduleFactories[moduleId](loadedModule, loadedModule.exports, requireModule);
    return loadedModule.exports;
  }
  requireModule.n = (importedModule) => {
    var getDefaultExport =
      importedModule && importedModule.__esModule
        ? () => importedModule.default
        : () => importedModule;
    requireModule.d(getDefaultExport, {
      a: getDefaultExport,
    });
    return getDefaultExport;
  };
  requireModule.d = (exportsTarget, exportDefinitions) => {
    for (var exportName in exportDefinitions) {
      if (
        requireModule.o(exportDefinitions, exportName) &&
        !requireModule.o(exportsTarget, exportName)
      ) {
        Object.defineProperty(exportsTarget, exportName, {
          enumerable: true,
          get: exportDefinitions[exportName],
        });
      }
    }
  };
  requireModule.o = (hasOwnTarget, propertyName) =>
    Object.prototype.hasOwnProperty.call(hasOwnTarget, propertyName);
  requireModule.r = (moduleNamespace) => {
    if (typeof Symbol !== "undefined" && Symbol.toStringTag) {
      Object.defineProperty(moduleNamespace, Symbol.toStringTag, {
        value: "Module",
      });
    }
    Object.defineProperty(moduleNamespace, "__esModule", {
      value: true,
    });
  };
  (() => {
    "use strict";

    requireModule(723);
  })();
})();
