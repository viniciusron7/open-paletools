// Reads the module manifest and turns ES-module sources into the statements that the build
// concatenates inside webpack module 723 of the userscript.
//
// Source modules use a deliberately small subset of ES module syntax:
//   import { a, b } from "./other.js";         named imports of other modules
//   import styles from "./styles.css";           embedded resources (see ASSET_TYPES)
//   export function f() {}  export const x = …   exported declarations
// Everything else (default exports, re-exports, namespace imports) is rejected.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseModule } from "./ast.mjs";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/[\\/]$/, "");
export const MANIFEST_PATH = "src/manifest.json";

/** Embedded resource types: how an imported file becomes a string literal. */
export const ASSET_TYPES = Object.freeze({
  ".css": { kind: "text" },
  ".txt": { kind: "text" },
  ".js.txt": { kind: "text" },
  ".svg": { kind: "data-uri", mime: "image/svg+xml" },
  ".png": { kind: "data-uri", mime: "image/png" },
  ".webp": { kind: "data-uri", mime: "image/webp" },
  ".gz": { kind: "base64" },
});

export function assetType(file) {
  const name = path.basename(file);
  const extension = Object.keys(ASSET_TYPES)
    .filter((candidate) => name.endsWith(candidate))
    .sort((a, b) => b.length - a.length)[0];
  return extension ? ASSET_TYPES[extension] : null;
}

/** Returns the string value an embedded resource stands for. */
export function assetValue(absolutePath) {
  const type = assetType(absolutePath);
  if (!type) throw new Error(`unsupported embedded resource: ${absolutePath}`);
  const bytes = fs.readFileSync(absolutePath);
  if (type.kind === "text") return bytes.toString("utf8");
  if (type.kind === "base64") return bytes.toString("base64");
  return `data:${type.mime};base64,${bytes.toString("base64")}`;
}

export function readManifest(root = ROOT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_PATH), "utf8"));
  for (const key of ["output", "header", "runtime", "modules"])
    if (!(key in manifest)) throw new Error(`${MANIFEST_PATH}: missing "${key}"`);
  const seen = new Set();
  for (const modulePath of manifest.modules) {
    if (seen.has(modulePath)) throw new Error(`${MANIFEST_PATH}: ${modulePath} listed twice`);
    seen.add(modulePath);
  }
  return manifest;
}

const toPosix = (file) => file.split(path.sep).join("/");

/** Resolves an import specifier relative to the importing module (repository-relative path). */
export function resolveSpecifier(fromModule, specifier) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../"))
    throw new Error(`${fromModule}: only relative imports are allowed (${specifier})`);
  return toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(fromModule), specifier)));
}

/**
 * Parses one source module and describes its imports, exports and the text edits that turn it
 * into plain statements.
 */
export function analyzeModule(modulePath, root = ROOT) {
  // CRLF (e.g. a file saved by a Windows editor) would leave extra blank lines in the build.
  const source = fs.readFileSync(path.join(root, modulePath), "utf8").replace(/\r\n/g, "\n");
  let program;
  const comments = [];
  try {
    program = parseModule(source, { onComment: comments });
  } catch (error) {
    throw new Error(`${modulePath}: ${error.message}`);
  }
  // A `@mutable` tag in the comment right above `export let x` declares shared mutable state:
  // other modules may assign it (see scripts/check-modules.mjs and docs/MODULE-RULES.md).
  const isMarkedMutable = (statement) =>
    comments.some(
      (comment) =>
        comment.end <= statement.start &&
        source.slice(comment.end, statement.start).trim() === "" &&
        /@mutable\b/.test(comment.value),
    );
  const imports = []; // { local, imported, from, asset, node }
  const exports = []; // { name, node }
  const edits = []; // [start, end, replacement]
  const fail = (node, message) => {
    throw new Error(`${modulePath}:${node.loc.start.line}: ${message}`);
  };
  for (const statement of program.body) {
    switch (statement.type) {
      case "ImportDeclaration": {
        const from = resolveSpecifier(modulePath, statement.source.value);
        const asset = assetType(from) !== null;
        for (const specifier of statement.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier")
            fail(statement, "namespace imports are not supported");
          if (asset !== (specifier.type === "ImportDefaultSpecifier"))
            fail(
              statement,
              asset ? "embedded resources use a default import" : "use named imports for modules",
            );
          imports.push({
            local: specifier.local.name,
            imported: asset ? "default" : specifier.imported.name,
            from,
            asset,
            node: specifier,
          });
        }
        if (!statement.specifiers.length)
          fail(statement, "side-effect-only imports are not supported");
        edits.push([statement.start, statement.end, ""]);
        break;
      }
      case "ExportNamedDeclaration": {
        if (statement.source || !statement.declaration)
          fail(
            statement,
            "only `export <declaration>` is supported (no export lists or re-exports)",
          );
        const declaration = statement.declaration;
        const names =
          declaration.type === "VariableDeclaration"
            ? declaration.declarations.map((declarator) => {
                if (declarator.id.type !== "Identifier")
                  fail(statement, "exported destructuring is not supported");
                return declarator.id.name;
              })
            : [declaration.id.name];
        const mutable = isMarkedMutable(statement);
        if (mutable && declaration.kind !== "let")
          fail(statement, "only `export let` can be @mutable");
        for (const name of names) exports.push({ name, node: statement, mutable });
        edits.push([statement.start, declaration.start, ""]);
        break;
      }
      case "ExportDefaultDeclaration":
      case "ExportAllDeclaration":
        fail(statement, "default exports and `export *` are not supported");
        break;
      default:
        break;
    }
  }
  return { modulePath, source, program, imports, exports, edits };
}

/** Applies the edits computed by analyzeModule and returns the plain statements. */
export function stripModuleSyntax(analysis) {
  let output = analysis.source;
  for (const [start, end, replacement] of [...analysis.edits].sort((a, b) => b[0] - a[0])) {
    let cut = end;
    // Remove the line break that followed a removed import so no blank lines accumulate.
    if (
      replacement === "" &&
      output[cut] === "\n" &&
      analysis.source.slice(start, end).startsWith("import")
    )
      cut++;
    output = output.slice(0, start) + replacement + output.slice(cut);
  }
  return output.replace(/^\s*\n/, "");
}

/** Analyzes every module of the manifest. */
export function analyzeProject(root = ROOT) {
  const manifest = readManifest(root);
  const modules = manifest.modules.map((modulePath) => analyzeModule(modulePath, root));
  return { manifest, modules };
}
