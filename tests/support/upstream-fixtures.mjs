// Shared fixtures of the upstream tests (tests/tooling/upstream-*.test.mjs):
//   * readBaseRelease: the release src/ follows (upstream/base.user.js), which every port
//     replaces, so the tests read what to expect from it instead of assuming a version;
//   * bundle / mergeBothWays: small synthetic userscripts shaped like a release, merged by the
//     engine of scripts/upstream/ in both directions (port and expected program);
//   * createProject / portRelease: a tiny project (manifest, header, runtime, modules, an
//     embedded resource) built and ported like src/ by `npm run upstream:update`.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import prettier from "prettier";
import { buildUserscript } from "../../scripts/build.mjs";
import { checkModules } from "../../scripts/check-modules.mjs";
import { findModuleFactory, parseScript, walk } from "../../scripts/lib/ast.mjs";
import { ROOT } from "../../scripts/lib/modules.mjs";
import { alignTopLevel } from "../../scripts/upstream/lib/align.mjs";
import { applyPlanToSources } from "../../scripts/upstream/lib/apply-src.mjs";
import { verifyEquivalence } from "../../scripts/upstream/lib/equivalence.mjs";
import { fixModuleLinks } from "../../scripts/upstream/lib/fix-links.mjs";
import { planMerge } from "../../scripts/upstream/lib/merge.mjs";
import { findMainModuleId, prepareProgram } from "../../scripts/upstream/lib/program.mjs";
import { mergeIntoText } from "../../scripts/upstream/lib/whole-text.mjs";
import { releaseVersion } from "../../scripts/upstream/release.mjs";

// ---------------------------------------------------------------------------------------------
// The base release
// ---------------------------------------------------------------------------------------------
/** BASE_PATH and BASE_INFO_PATH of scripts/upstream/update.mjs. */
export const BASE_PATH = "upstream/base.user.js";
export const BASE_INFO_PATH = "upstream/base.json";
/** Local copies of the published releases (not committed; the tests that need them skip). */
export const SAVED_RELEASES = path.join(ROOT, "versoes_paletools");

/** The saved copy of a published release, or null when it is not present. */
export function savedRelease(version) {
  const file = path.join(SAVED_RELEASES, `Paletools-${version}.js`);
  return fs.existsSync(file) ? file : null;
}

/**
 * The release src/ follows, as the tests see it: { file, label, source, version, info }.
 * `version` is the one upstream/base.json records (`info`, written by the port with the base),
 * else the @version of the file.
 *
 * Environment (tests only): UPSTREAM_BASE_PATH tests another release in its place (a path
 * relative to the repository, or absolute), e.g.
 *   UPSTREAM_BASE_PATH=versoes_paletools/Paletools-27.2.1.js node --test tests/tooling/upstream-release.test.mjs
 * Its version is then its own @version, unless UPSTREAM_BASE_INFO_PATH names a base.json for it.
 */
export function readBaseRelease() {
  const override = process.env.UPSTREAM_BASE_PATH;
  const file = override ? path.resolve(ROOT, override) : path.join(ROOT, BASE_PATH);
  const source = fs.readFileSync(file, "utf8");
  const infoOverride = process.env.UPSTREAM_BASE_INFO_PATH;
  const infoFile = infoOverride
    ? path.resolve(ROOT, infoOverride)
    : override
      ? null
      : path.join(ROOT, BASE_INFO_PATH);
  if (infoOverride && !fs.existsSync(infoFile))
    throw new Error(`UPSTREAM_BASE_INFO_PATH: ${infoFile} does not exist`);
  const info =
    infoFile && fs.existsSync(infoFile) ? JSON.parse(fs.readFileSync(infoFile, "utf8")) : null;
  return {
    file,
    label: path.relative(ROOT, file),
    source,
    version: info?.version ?? releaseVersion(source),
    info,
  };
}

/** The metadata block of a userscript (up to `// ==/UserScript==`). */
export const metadataHeader = (source) =>
  source.slice(0, source.indexOf("// ==/UserScript==") + "// ==/UserScript==".length);

// ---------------------------------------------------------------------------------------------
// Synthetic releases
// ---------------------------------------------------------------------------------------------
/**
 * A userscript shaped like a release: a webpack-like module table whose largest factory (`id`)
 * is the main module (`body` is its code), an empty module, and the call of the main module.
 */
export const bundle = (body, { id = 723 } = {}) => `(() => {
  var modules = {
    ${id}: (module, exports, require) => {
      "use strict";
${body}
    },
    491: () => {},
  };
  modules[${id}]({}, {}, () => {});
})();
`;

/** A prepared side, as scripts/upstream/update.mjs prepares the three programs of a port. */
export const prepareSide = (source, label) =>
  prepareProgram(source, { label, keepInlinedDeclarations: true });

/**
 * Merges the bodies of three synthetic releases both ways, as `npm run upstream:update` does:
 *   port      the release's changes (base -> other) merged into the target (TG = this project,
 *             OT = the new release, otIsTheirs: true);
 *   expected  the project's changes (base -> target) merged into the release (TG = the new
 *             release, OT = this project, otIsTheirs: false).
 * Without conflicts both are the same program. The new release gets another main module id
 * (909), as real releases do. Returns { B, TG, OT, plan (of the port), port, expected }.
 */
export function mergeBothWays({ base, target, other, otherId = 909 }) {
  const B = prepareSide(bundle(base), "base");
  const TG = prepareSide(bundle(target), "src");
  const OT = prepareSide(bundle(other, { id: otherId }), "release");
  const alignTG = alignTopLevel(B, TG);
  const alignOT = alignTopLevel(B, OT);
  const plan = planMerge({ B, TG, OT, alignTG, alignOT, otIsTheirs: true });
  const port = mergeIntoText({ B, TG, OT, alignTG, alignOT, otIsTheirs: true });
  const expected = mergeIntoText({
    B,
    TG: OT,
    OT: TG,
    alignTG: alignOT,
    alignOT: alignTG,
    otIsTheirs: false,
  });
  return { B, TG, OT, plan, port, expected };
}

/** The text of the main module's body (between its braces) of a userscript. */
export function mainModuleText(source) {
  const program = parseScript(source);
  const factory = findModuleFactory(program, findMainModuleId(program));
  return source.slice(factory.body.start + 1, factory.body.end - 1);
}

/** Asserts that two userscripts are the same program (lib/equivalence.mjs, renames learned). */
export function assertEquivalent(reference, candidate, message = "equivalent", options = {}) {
  const result = verifyEquivalence(reference, candidate, options);
  assert(
    result.equivalent,
    `${message}:\n${result.mismatches.join("\n")}\n--- reference\n${mainModuleText(reference)}\n--- candidate\n${mainModuleText(candidate)}`,
  );
}

/** Asserts that a merge plan has exactly the given conflicts ([kind, ...]). */
export function assertConflicts(plan, kinds) {
  assert.deepEqual(
    plan.conflicts.map((conflict) => conflict.kind),
    kinds,
    plan.conflicts.map((conflict) => `${conflict.kind} at ${conflict.path}`).join("\n"),
  );
}

/** The operations of a plan as `op` strings, e.g. ["replace", "insert"]. */
export const operations = (plan) => plan.ops.map((operation) => operation.op);

// ---------------------------------------------------------------------------------------------
// A tiny project ported like src/
// ---------------------------------------------------------------------------------------------
/** src/runtime/webpack-runtime.js of the tiny project: module 723 holds the modules. */
export const PROJECT_RUNTIME = `/** Template of the userscript body (as src/runtime/webpack-runtime.js). */
(() => {
  var moduleFactories = {
    723: (moduleRecord, moduleExports, importModule) => {
      "use strict";
      /* @modules */
    },
    491: () => {},
  };
  var moduleCache = {};
  function requireModule(moduleId) {
    var cachedModule = moduleCache[moduleId];
    if (cachedModule !== undefined) {
      return cachedModule.exports;
    }
    var loadedModule = (moduleCache[moduleId] = { exports: {} });
    moduleFactories[moduleId](loadedModule, loadedModule.exports, requireModule);
    return loadedModule.exports;
  }
  requireModule(723);
})();
`;

/** src/external-globals.json of the tiny project: the keys of the real one. */
export const PROJECT_GLOBALS = {
  $comment: ["Identifiers the modules use without declaring them (test project)."],
  $runtime: "Parameters of webpack module 723.",
  runtime: ["importModule", "moduleExports", "moduleRecord"],
  $userscriptManager: "APIs granted by the userscript manager.",
  userscriptManager: ["GM_xmlhttpRequest", "unsafeWindow"],
  $browser: "Browser (DOM/BOM) APIs.",
  browser: ["document"],
  $webApp: "Globals of the Web App.",
  webApp: ["addStyle", "services"],
  $undeclaredInOriginal: "Names the original reads undeclared.",
  undeclaredInOriginal: {},
};

/**
 * Creates a project in a new temporary directory: `modules` (path -> text, in manifest order)
 * plus `assets` (path -> text) and the manifest, header, runtime, external globals and Prettier
 * configuration. Returns its root; `cleanup()` removes it.
 */
export function createProject({ modules, assets = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "open-paletools-upstream-merge-"));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  write(
    "src/manifest.json",
    `${JSON.stringify(
      {
        output: "dist/x.user.js",
        header: "src/userscript-header.js",
        runtime: "src/runtime/webpack-runtime.js",
        modules: Object.keys(modules),
      },
      null,
      2,
    )}\n`,
  );
  write(
    "src/userscript-header.js",
    "// ==UserScript==\n// @name Fixture\n// @version 1.0.0\n// ==/UserScript==\n",
  );
  write("src/runtime/webpack-runtime.js", PROJECT_RUNTIME);
  write("src/external-globals.json", `${JSON.stringify(PROJECT_GLOBALS, null, 2)}\n`);
  write(".prettierrc.json", '{\n  "printWidth": 100\n}\n');
  for (const [file, text] of [...Object.entries(modules), ...Object.entries(assets)])
    write(file, text);
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export const readFile = (root, file) => fs.readFileSync(path.join(root, file), "utf8");

/**
 * A release made from a build: the same runtime (as releases and src/runtime/ share it), with
 * `body` as the main module, under module id `id`, in the minified style of a release (other
 * parameter names).
 */
export function releaseFromBuild(built, body, id) {
  const program = parseScript(built);
  const factory = findModuleFactory(program, 723);
  let property = null;
  walk(program, (node) => {
    if (node.type === "Property" && node.value === factory) property = node;
    return property === null;
  });
  const text = `${built.slice(0, property.start)}${id}: (_0xm, _0xe, _0xr) => {\n"use strict";\n${body}\n}${built.slice(property.end)}`;
  return text.replace("requireModule(723);", `requireModule(${id});`);
}

/** formatFiles of scripts/upstream/update.mjs. */
async function formatFiles(root, files) {
  for (const file of files) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) || !/\.(m?js|json)$/.test(file)) continue;
    const options = (await prettier.resolveConfig(absolute)) ?? {};
    const text = fs.readFileSync(absolute, "utf8");
    const formatted = await prettier.format(text, { ...options, filepath: absolute });
    if (formatted !== text) fs.writeFileSync(absolute, formatted);
  }
}

/**
 * Ports a synthetic release into the project at `root`, step by step as `update()` of
 * scripts/upstream/update.mjs: the base release and the new one are the build's runtime with the
 * main modules `baseBody` (module 723) and `releaseBody` (module `releaseId`); the plan is
 * written into the module files, the links are fixed, the files formatted, the modules checked
 * and the project built again. Returns { built, rebuilt, plan, expected (text), applied, links,
 * checkErrors, verification (rebuilt vs expected) }.
 */
export async function portRelease(root, { baseBody, releaseBody, releaseId = 909 }) {
  const built = await buildUserscript(root);
  const baseSource = releaseFromBuild(built, baseBody, 723);
  const releaseSource = releaseFromBuild(built, releaseBody, releaseId);
  const B = prepareSide(baseSource, "base");
  const T = prepareSide(releaseSource, "release");
  const O = prepareSide(built, "src");
  const alignO = alignTopLevel(B, O);
  const alignT = alignTopLevel(B, T);
  const plan = planMerge({ B, TG: O, OT: T, alignTG: alignO, alignOT: alignT, otIsTheirs: true });
  const expected = mergeIntoText({
    B,
    TG: T,
    OT: O,
    alignTG: alignT,
    alignOT: alignO,
    otIsTheirs: false,
  }).text;
  const applied = applyPlanToSources({
    root,
    B,
    O,
    T,
    alignO,
    alignT,
    plan,
    releaseVersion: "2.0.0",
  });
  const releaseGlobals = new Set(
    T.scopeManager.globalScope.through.map((ref) => ref.identifier.name),
  );
  const links = fixModuleLinks(root, { newGlobals: releaseGlobals });
  await formatFiles(root, [
    ...new Set([...applied.files.keys(), ...links.changed, "src/external-globals.json"]),
  ]);
  const checkErrors = checkModules(root).errors;
  const rebuilt = await buildUserscript(root);
  const verification = verifyEquivalence(expected, rebuilt);
  return { built, rebuilt, plan, expected, applied, links, checkErrors, verification };
}
