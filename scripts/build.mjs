#!/usr/bin/env node
// Generates the installable userscript from the modules listed in src/manifest.json.
//
//   npm run build          checks the modules (scripts/check-modules.mjs), then writes
//                          dist/paletools.user.js (the "output" of the manifest)
//
// How the output is assembled (see README.md, "How the build works"):
//   1. src/userscript-header.js — the ==UserScript== metadata block, copied verbatim;
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

export async function buildUserscript(root = ROOT) {
  const { manifest, modules } = analyzeProject(root);
  const header = fs.readFileSync(path.join(root, manifest.header), "utf8").trimEnd();
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
export async function buildCheckedUserscript(root = ROOT) {
  const { errors } = checkModules(root);
  if (errors.length) {
    const list = errors.map((error) => `  ${error}`).join("\n");
    throw new Error(`${errors.length} problem(s) in the modules, nothing was built:\n${list}`);
  }
  return buildUserscript(root);
}

/** Checks and builds the userscript, then writes it to the manifest's `output` (dist/). */
export async function writeUserscript(root = ROOT) {
  const output = await buildCheckedUserscript(root);
  const manifest = readManifest(root);
  const outputPath = path.join(root, manifest.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
  return { outputPath: manifest.output, lines: output.split("\n").length - 1 };
}

async function main() {
  const { outputPath, lines } = await writeUserscript(ROOT);
  console.log(`wrote ${outputPath} (${lines} lines)`);
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
