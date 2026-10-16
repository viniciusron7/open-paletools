// Loads parts of the program into a vm context for focused tests.
//
// The same test can run against the source modules or against the generated userscript:
//   PALETOOLS_TEST_TARGET=src         (default) evaluates src/ modules the way the build does:
//                                     imports removed, `export` dropped, one shared scope;
//   PALETOOLS_TEST_TARGET=userscript  evaluates the matching `// #region <module>` sections of
//                                     the generated userscript: the file named by
//                                     PALETOOLS_USERSCRIPT (`npm test` sets it to a fresh test
//                                     build), else dist/paletools.user.js (`npm run build`).
// Only the requested modules (or function declarations) are evaluated. Every other binding
// resolves to a global of the context, which is where tests inject their fakes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const acorn = require("acorn");
const modules = require("../../scripts/lib/modules.mjs");

const ROOT = path.join(__dirname, "..", "..");
const USERSCRIPT_PATH =
  process.env.PALETOOLS_USERSCRIPT || path.join(ROOT, modules.readManifest(ROOT).output);
const TARGETS = ["src", "userscript"];

function currentTarget() {
  const target = process.env.PALETOOLS_TEST_TARGET || "src";
  assert(TARGETS.includes(target), `PALETOOLS_TEST_TARGET must be one of ${TARGETS.join(", ")}`);
  return target;
}

let userscriptCache;
function userscriptRegions() {
  if (userscriptCache) return userscriptCache;
  assert(
    fs.existsSync(USERSCRIPT_PATH),
    `${USERSCRIPT_PATH} does not exist: run \`npm test\` or \`npm run build\``,
  );
  const source = fs.readFileSync(USERSCRIPT_PATH, "utf8");
  const regions = new Map();
  const pattern = /\/\/ #region (.+)\n([\s\S]*?)\/\/ #endregion \1\n/g;
  for (const match of source.matchAll(pattern)) regions.set(match[1], match[2]);
  userscriptCache = regions;
  return regions;
}

/** Plain statements of one module, without import/export syntax. */
function moduleCode(modulePath, target) {
  if (target === "userscript") {
    const code = userscriptRegions().get(modulePath);
    assert(code !== undefined, `the userscript has no region for ${modulePath}`);
    return code;
  }
  const analysis = modules.analyzeModule(modulePath, ROOT);
  const resources = analysis.imports
    .filter((entry) => entry.asset)
    .map(
      (entry) =>
        `const ${entry.local} = ${JSON.stringify(modules.assetValue(path.join(ROOT, entry.from)))};`,
    );
  return [...resources, modules.stripModuleSyntax(analysis)].join("\n");
}

/** Source text of top-level function declarations of a module. */
function functionCode(modulePath, names, target) {
  const code = moduleCode(modulePath, target);
  const program = acorn.parse(code, { ecmaVersion: 2024, sourceType: "script" });
  return names
    .map((name) => {
      const declaration = program.body.find(
        (statement) => statement.type === "FunctionDeclaration" && statement.id.name === name,
      );
      assert(declaration, `${modulePath} does not declare function ${name}`);
      return code.slice(declaration.start, declaration.end);
    })
    .join("\n");
}

/**
 * Evaluates the function declarations listed in `functions` (`{ "src/x.js": ["name"] }`), then
 * the complete `modules` in manifest (initialization) order, then `epilogue`.
 */
function loadSources(context, { modules: modulePaths = [], functions = {}, epilogue = "" } = {}) {
  const target = currentTarget();
  const order = modules.readManifest(ROOT).modules;
  for (const modulePath of modulePaths)
    assert(order.includes(modulePath), `${modulePath} is not listed in src/manifest.json`);
  const ordered = [...modulePaths].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const parts = [
    // Module 723 of the userscript is strict code; evaluate the sources the same way.
    '"use strict";',
    // In the userscript, resources imported by modules are constants of a separate region.
    target === "userscript" ? (userscriptRegions().get("embedded resources") ?? "") : "",
    ...Object.entries(functions).map(([modulePath, names]) =>
      functionCode(modulePath, names, target),
    ),
    ...ordered.map((modulePath) => moduleCode(modulePath, target)),
    epilogue,
  ];
  const filename =
    target === "userscript" ? USERSCRIPT_PATH : path.join(ROOT, modulePaths[0] || "src");
  vm.runInContext(parts.join("\n"), context, { filename });
  return context;
}

module.exports = { loadSources, currentTarget, TARGETS };
