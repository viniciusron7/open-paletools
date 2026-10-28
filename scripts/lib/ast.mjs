// Small ESTree helpers shared by the build, the module checks and the upstream tools.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";

export const PARSE_OPTIONS = Object.freeze({
  ecmaVersion: 2024,
  sourceType: "script",
  locations: true,
  ranges: true,
  allowHashBang: true,
});

/** Parses a classic script, such as a whole userscript. */
export function parseScript(source, options = {}) {
  return parse(source, { ...PARSE_OPTIONS, ...options });
}

/**
 * Finds the factory function of webpack module `moduleId` (the `id: (module, exports, require)
 * => {...}` property of the module table) in a userscript of this project or of Paletools.
 */
export function findModuleFactory(program, moduleId) {
  let found = null;
  walk(program, (node) => {
    if (found) return false;
    if (
      node.type === "Property" &&
      !node.computed &&
      ((node.key.type === "Literal" && node.key.value === moduleId) ||
        (node.key.type === "Identifier" && node.key.name === String(moduleId))) &&
      (node.value.type === "ArrowFunctionExpression" || node.value.type === "FunctionExpression")
    ) {
      found = node.value;
      return false;
    }
    return true;
  });
  return found;
}

/** Gives synthetic nodes (created by a transformation) the source range of their content. */
export function fillMissingRanges(node, fallback = [0, 0]) {
  rangeFromChildren(node);
  rangeFromParent(node, fallback);
}

/** Post-order: a synthetic node spans its children, once their own ranges are known. */
function rangeFromChildren(node) {
  let start = Infinity;
  let end = -Infinity;
  for (const key of childKeys(node)) {
    for (const child of [].concat(node[key])) {
      if (!isNode(child)) continue;
      rangeFromChildren(child);
      if (child.range) {
        start = Math.min(start, child.range[0]);
        end = Math.max(end, child.range[1]);
      }
    }
  }
  if (!node.range && Number.isFinite(start)) node.range = [start, end];
}

/** Pre-order: a node without any ranged descendant takes its parent's range. */
function rangeFromParent(node, fallback) {
  if (!node.range) node.range = fallback;
  for (const key of childKeys(node)) {
    for (const child of [].concat(node[key])) if (isNode(child)) rangeFromParent(child, node.range);
  }
}

/**
 * True when the script whose `import.meta.url` is given was started directly by Node
 * (`node scripts/x.mjs`), also when its path contains spaces or symbolic links.
 */
export function isMainModule(importMetaUrl) {
  if (!process.argv[1]) return false;
  // Both sides are resolved: with --preserve-symlinks-main the module URL keeps the link.
  const self = fs.realpathSync(fileURLToPath(importMetaUrl));
  let main;
  try {
    main = fs.realpathSync(path.resolve(process.argv[1]));
  } catch {
    return false; // The entry point is not a file (e.g. `node -e`), so it is not this module.
  }
  return self === main;
}

export function parseModule(source, options = {}) {
  return parse(source, {
    ecmaVersion: 2024,
    sourceType: "module",
    locations: true,
    ranges: true,
    ...options,
  });
}

const NON_CHILD_KEYS = new Set([
  "type",
  "start",
  "end",
  "loc",
  "range",
  "raw",
  "regex",
  "bigint",
  "name",
  "operator",
  "kind",
  "computed",
  "static",
  "async",
  "generator",
  "method",
  "shorthand",
  "prefix",
  "delegate",
  "optional",
  "await",
  "directive",
  "sourceType",
  "tail",
  "cooked",
]);

export function isNode(value) {
  return value !== null && typeof value === "object" && typeof value.type === "string";
}

/** Returns the keys of `node` that hold child nodes or arrays of child nodes. */
export function childKeys(node) {
  const keys = [];
  for (const key of Object.keys(node)) {
    if (NON_CHILD_KEYS.has(key)) continue;
    const value = node[key];
    if (isNode(value) || (Array.isArray(value) && value.some(isNode))) keys.push(key);
  }
  return keys;
}

/** Depth-first walk calling `visit(node, parent, key, index)` before the children. */
export function walk(node, visit, parent = null, key = null, index = null) {
  if (visit(node, parent, key, index) === false) return;
  for (const childKey of childKeys(node)) {
    const value = node[childKey];
    if (Array.isArray(value)) {
      for (let childIndex = 0; childIndex < value.length; childIndex++) {
        if (isNode(value[childIndex])) walk(value[childIndex], visit, node, childKey, childIndex);
      }
    } else walk(value, visit, node, childKey, null);
  }
}
