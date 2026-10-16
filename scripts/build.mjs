#!/usr/bin/env node
// Generates the installable userscript from the modules listed in src/manifest.json.
//
//   npm run build          checks the modules (scripts/check-modules.mjs), then writes
//                          dist/paletools.user.js (the "output" of the manifest) with the next
//                          build number appended to its @version (27.1.5 -> 27.1.5.1, 27.1.5.2...)
//
// The build number counts the successful runs of `npm run build` for the @version of
// src/userscript-header.js, and starts again at 1 when that version changes. It is kept in
// .build-number.json, a local file that is not committed. The tests and update-boot-snapshot
// build their own copy and change neither dist/ nor the build number.
//
// How the output is assembled (see docs/BUILD.md):
//   1. src/userscript-header.js — the ==UserScript== metadata block, copied verbatim apart from
//      the build number on @version;
//   2. src/runtime/webpack-runtime.js — the original webpack runtime. Its `/* @modules */`
//      marker, inside module 723, is replaced by:
//        a. one `const` per embedded resource (CSS, images, data) imported by any module,
//           in manifest order (the "embedded resources" region), then
//        b. every module of the manifest, in manifest order, with its import declarations
//           removed and its `export` keywords dropped. Each module is wrapped in
//           `// #region <path>` / `// #endregion <path>` comments.
//   3. The result is formatted with the project's Prettier configuration.
// All modules therefore share one scope at runtime, exactly like the original bundle, and run in
// the order of the manifest, which is the original initialization order.
import fs from "node:fs";
import path from "node:path";
import prettier from "prettier";
import { checkModules } from "./check-modules.mjs";
import { isMainModule } from "./lib/ast.mjs";
import {
  analyzeProject,
  assetValue,
  readManifest,
  ROOT,
  stripModuleSyntax,
} from "./lib/modules.mjs";

export const MODULES_MARKER = "/* @modules */";

/** Local file (not committed) holding the last build number of a version, see writeUserscript. */
export const BUILD_NUMBER_PATH = ".build-number.json";

const VERSION_LINE = /^(\/\/ @version[ \t]+)(\S+)[ \t]*$/m;

const readHeader = (root, manifest) =>
  fs.readFileSync(path.join(root, manifest.header), "utf8").replace(/\r\n/g, "\n").trimEnd();

/** The `@version` of a metadata block. */
export function headerVersion(header) {
  const match = header.match(VERSION_LINE);
  if (!match) throw new Error("the userscript metadata block has no `// @version` line");
  return match[2];
}

/**
 * The build number the next `npm run build` gives the userscript of `version`: one more than the
 * last build of that version, or 1 when there was none (no build yet, or another version).
 */
export function nextBuildNumber(version, root = ROOT) {
  const file = path.join(root, BUILD_NUMBER_PATH);
  if (!fs.existsSync(file)) return 1;
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // Reported below.
  }
  if (typeof saved?.version !== "string" || !Number.isSafeInteger(saved.builds) || saved.builds < 1)
    throw new Error(
      `${BUILD_NUMBER_PATH} is not valid: fix it, or delete it to count the builds from 1 again`,
    );
  return saved.version === version ? saved.builds + 1 : 1;
}

/** Builds the userscript; with `buildNumber`, its @version becomes `<version>.<buildNumber>`. */
export async function buildUserscript(root = ROOT, { buildNumber } = {}) {
  const { manifest, modules } = analyzeProject(root);
  let header = readHeader(root, manifest);
  if (buildNumber !== undefined) {
    const version = headerVersion(header);
    header = header.replace(VERSION_LINE, (line, prefix) => `${prefix}${version}.${buildNumber}`);
  }
  const runtime = fs.readFileSync(path.join(root, manifest.runtime), "utf8");
  if (runtime.split(MODULES_MARKER).length !== 2)
    throw new Error(`${manifest.runtime} must contain ${MODULES_MARKER} exactly once`);

  const resources = new Map(); // local name -> asset path
  for (const module of modules) {
    for (const entry of module.imports.filter((item) => item.asset)) {
      const previous = resources.get(entry.local);
      if (previous && previous !== entry.from)
        throw new Error(
          `${module.modulePath}: resource name ${entry.local} is already used for ${previous}`,
        );
      resources.set(entry.local, entry.from);
    }
  }
  const parts = [];
  if (resources.size) {
    parts.push("// #region embedded resources");
    for (const [local, file] of resources)
      parts.push(
        `// ${file}\nconst ${local} = ${JSON.stringify(assetValue(path.join(root, file)))};`,
      );
    parts.push("// #endregion embedded resources");
  }
  for (const module of modules) {
    parts.push(`// #region ${module.modulePath}`);
    parts.push(stripModuleSyntax(module).trim());
    parts.push(`// #endregion ${module.modulePath}`);
  }
  // A replacement function: a replacement string would expand `$&`, `$$`, `$'` in the code.
  const code = `${header}\n${runtime.replace(MODULES_MARKER, () => parts.join("\n\n"))}`;
  const options = (await prettier.resolveConfig(path.join(root, manifest.output))) ?? {};
  return prettier.format(code, { ...options, filepath: path.join(root, manifest.output) });
}

/**
 * Runs scripts/check-modules.mjs, then builds. A module that breaks the rules would build into a
 * script that fails in the browser (e.g. a duplicate top-level name is a SyntaxError), so this
 * throws, listing the problems, instead.
 */
export async function buildCheckedUserscript(root = ROOT, options = {}) {
  const { errors } = checkModules(root);
  if (errors.length) {
    const list = errors.map((error) => `  ${error}`).join("\n");
    throw new Error(`${errors.length} problem(s) in the modules, nothing was built:\n${list}`);
  }
  return buildUserscript(root, options);
}

/**
 * `npm run build`: checks and builds the userscript with the next build number on its @version,
 * writes it to the manifest's `output` (dist/), then records that build number. A refused build
 * writes nothing and does not count.
 */
export async function writeUserscript(root = ROOT) {
  const manifest = readManifest(root);
  const version = headerVersion(readHeader(root, manifest));
  const buildNumber = nextBuildNumber(version, root);
  const output = await buildCheckedUserscript(root, { buildNumber });
  const outputPath = path.join(root, manifest.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
  fs.writeFileSync(
    path.join(root, BUILD_NUMBER_PATH),
    `${JSON.stringify({ version, builds: buildNumber }, null, 2)}\n`,
  );
  return {
    outputPath: manifest.output,
    version: `${version}.${buildNumber}`,
    lines: output.split("\n").length - 1,
  };
}

async function main() {
  const { outputPath, version, lines } = await writeUserscript(ROOT);
  console.log(`wrote ${outputPath} (version ${version}, ${lines} lines)`);
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
