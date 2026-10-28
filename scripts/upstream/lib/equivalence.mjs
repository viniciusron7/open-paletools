#!/usr/bin/env node
// Structural equivalence of two userscripts: decides whether a candidate (typically the build of
// src/) is the same program as a reference (a deobfuscated Paletools release, possibly merged with
// this project's additions) and, when it is not, says precisely where they differ.
//
//   node scripts/upstream/lib/equivalence.mjs <reference.user.js> <candidate.user.js>
//        [--renames map.json] [--no-learn] [--holes holes.json] [--max-mismatches N]
//
// Both programs are prepared by ./program.mjs (minifier idioms rewritten as plain statements,
// constants that may move inlined), then compared as ASTs. Accepted differences:
//   * everything the preparation normalizes, formatting and comments;
//   * consistent renaming of variables (alpha-equivalence). Top-level bindings of the main module
//     must follow `renames` (reference name -> candidate name, the same name when absent); with
//     `learn`, the first pairing of two unmapped top-level bindings becomes their rename;
//   * private class members (#name) renamed one-to-one per class: a private name resolves to the
//     nearest enclosing class body that declares it, and every pair of compared class bodies has
//     its own bijection of private names (the obfuscator renames them at each release);
//   * the function declarations of the main module in any order (they are hoisted), paired by
//     name through the renames;
//   * top-level `let NAME;` / `let NAME = <primitive>;` moved to a place where nothing evaluated
//     in between can read NAME (see `letDeclarations`);
//   * a different main module id: outside the main module, a number equal to a side's own main
//     module id (the module table key, `importModule(<id>)`) stands for "the main module";
//   * holes: reference source ranges resolved by hand, which match whatever the candidate has
//     at that place (see `createComparator`).
// Everything else must match in order: the other statements of the main module, and the code
// outside the main module (the webpack runtime) node by node.
//
// Diagnostics: the ordered statements of the main module are aligned before they are compared
// (longest common subsequence of name-insensitive fingerprints), and so is any list of nodes
// whose elements stop matching (lists of different lengths, or a failing element). Unpaired
// elements are reported as missing, extra or moved, with the `// #region <path>` of a build and
// a one-line excerpt, instead of a cascade of positional mismatches. The alignment only shapes
// the report: equivalence still requires every element to pair, in order, and every pair to be
// equal.
//
// Known limits: references are resolved statically (the userscript uses no eval/with); comments,
// Function.prototype.toString() and the `name` of renamed functions and classes are not compared;
// inlining a primitive constant ignores its temporal dead zone (see program.mjs).
import fs from "node:fs";
import { childKeys, isMainModule, isNode } from "../../lib/ast.mjs";
import { isScalar, ORIGIN, prepareProgram } from "./program.mjs";

const DEFAULT_MAX_MISMATCHES = 50;
/** Nodes up to this depth below a list element make its "shape" (a coarser fingerprint). */
const SHAPE_DEPTH = 3;
/** Largest dynamic-programming table of an alignment; longer lists are aligned greedily. */
const DP_LIMIT = 8_000_000;
const ITEMS_SHOWN = 20;
const EXCERPT_WIDTH = 120;

const IGNORED_KEYS = new Set([
  "type",
  "start",
  "end",
  "loc",
  "range",
  "raw",
  "shorthand",
  "extra",
  "directive",
  "leadingComments",
  "trailingComments",
  "comments",
]);

/** Statements whose text is a useful excerpt for a mismatch found inside them. */
const CONTEXT_TYPES = new Set([
  "ExpressionStatement",
  "EmptyStatement",
  "DebuggerStatement",
  "WithStatement",
  "ReturnStatement",
  "LabeledStatement",
  "BreakStatement",
  "ContinueStatement",
  "IfStatement",
  "SwitchStatement",
  "ThrowStatement",
  "TryStatement",
  "WhileStatement",
  "DoWhileStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "FunctionDeclaration",
  "VariableDeclaration",
  "ClassDeclaration",
  "PropertyDefinition",
  "MethodDefinition",
]);

/** Thrown by the comparison at the first difference; not an Error, so no stack is captured. */
class Mismatch {
  constructor(reason, a, b) {
    this.reason = reason;
    this.a = a;
    this.b = b;
  }
}

function fail(reason, a, b) {
  throw new Mismatch(reason, a, b);
}

/** Iterative pre-order walk; `visit` returning false skips the children. */
function forEachNode(root, visit) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (visit(node) === false) continue;
    const keys = childKeys(node);
    for (let k = keys.length - 1; k >= 0; k--) {
      const value = node[keys[k]];
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index--)
          if (isNode(value[index])) stack.push(value[index]);
      } else stack.push(value);
    }
  }
}

// ---------------------------------------------------------------------------
// Source positions, regions and excerpts
// ---------------------------------------------------------------------------
const SOURCE_INFO = new WeakMap();

/** Line starts and `// #region <path>` intervals of a side's source, computed once. */
function sourceInfo(side) {
  let info = SOURCE_INFO.get(side);
  if (info) return info;
  const { source } = side;
  const lineStarts = [0];
  for (let index = source.indexOf("\n"); index !== -1; index = source.indexOf("\n", index + 1))
    lineStarts.push(index + 1);
  const regions = []; // { start, end, path, parent } in source order
  const open = [];
  for (const match of source.matchAll(/^[ \t]*\/\/ #(end)?region (.+?)[ \t]*$/gm)) {
    if (!match[1]) {
      regions.push({
        start: match.index,
        end: Infinity,
        path: match[2],
        parent: open.at(-1) ?? -1,
      });
      open.push(regions.length - 1);
      continue;
    }
    const at = open.findLastIndex((index) => regions[index].path === match[2]);
    if (at >= 0) for (const index of open.splice(at)) regions[index].end = match.index;
  }
  info = { lineStarts, regions };
  SOURCE_INFO.set(side, info);
  return info;
}

/** The last index of a sorted array whose value (by `key`) is <= `value`, or -1. */
function lastAtMost(array, value, key = (item) => item) {
  let low = 0;
  let high = array.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (key(array[middle]) <= value) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

/** 1-based line and column of a source offset. */
export function locate(side, offset) {
  const { lineStarts } = sourceInfo(side);
  const line = lastAtMost(lineStarts, offset);
  return { line: line + 1, column: offset - lineStarts[line] + 1 };
}

/** The path of the build region (`// #region <path>`) around a source offset, or null. */
export function regionAt(side, offset) {
  const { regions } = sourceInfo(side);
  let index = lastAtMost(regions, offset, (region) => region.start);
  while (index >= 0 && regions[index].end < offset) index = regions[index].parent;
  return index >= 0 ? regions[index].path : null;
}

const collapse = (text) => text.replace(/\s+/g, " ").trim();

/** One line of source: `context` (a statement) when short, else a window around `node`. */
function excerpt(side, node, context = node) {
  const { source } = side;
  const range = context?.range ?? node?.range;
  if (!range) return "";
  const [start, end] = range;
  if (end - start <= EXCERPT_WIDTH * 3) {
    const text = collapse(source.slice(start, end));
    if (text.length <= EXCERPT_WIDTH) return text;
  }
  const nodeStart = node?.range?.[0] ?? start;
  const from = nodeStart >= start && nodeStart <= end ? Math.max(start, nodeStart - 40) : start;
  const to = Math.min(end, from + EXCERPT_WIDTH * 2);
  let text = collapse(source.slice(from, to));
  const cut = text.length > EXCERPT_WIDTH || to < end;
  if (text.length > EXCERPT_WIDTH) text = text.slice(0, EXCERPT_WIDTH);
  return `${from > start ? "…" : ""}${text}${cut ? "…" : ""}`;
}

const INLINED_NAMES = new WeakMap();

/**
 * The name of the inlined constant a node was copied from, or null. A copy keeps the source
 * range of the constant's declaration (its use site has no text of its own any more).
 */
function inlinedName(side, node) {
  const origin = node?.[ORIGIN];
  if (!origin) return null;
  let names = INLINED_NAMES.get(side);
  if (!names) {
    names = new Map([...side.inlined].map(([name, { init }]) => [init, name]));
    INLINED_NAMES.set(side, names);
  }
  return names.get(origin) ?? null;
}

/** "line:column [region] `excerpt`" of a node of a side. */
function where(side, node, context = node) {
  const offset = node?.range?.[0] ?? context?.range?.[0] ?? 0;
  const { line, column } = locate(side, offset);
  const region = regionAt(side, offset);
  const name = inlinedName(side, node);
  return (
    `${line}:${column}${region ? ` [${region}]` : ""}${name ? ` (inlined const ${name})` : ""} ` +
    `\`${excerpt(side, node, context)}\``
  );
}

/** "line:column `excerpt`" of a list element. */
function itemText(side, node) {
  if (node === null) return "<array hole>";
  const { line, column } = locate(side, node.range[0]);
  const name = inlinedName(side, node);
  return `${line}:${column} \`${excerpt(side, node)}\`${name ? ` (inlined const ${name})` : ""}`;
}

/** The description of a top-level node used in `unmatched`. */
function unmatchedEntry(side, node, kind, name = null) {
  const [start, end] = node.range;
  return {
    kind,
    name,
    ...locate(side, start),
    region: regionAt(side, start),
    excerpt: excerpt(side, node),
    start,
    end,
  };
}

// ---------------------------------------------------------------------------
// Holes
// ---------------------------------------------------------------------------
/** Index of the reference ranges resolved by hand. */
function holeIndex(list) {
  const holes = list.map((range, index) => {
    const [start, end] = Array.isArray(range) ? range : [];
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start)
      throw new TypeError(`hole ${index} is not a [start, end] range: ${JSON.stringify(range)}`);
    return { start, end, index };
  });
  const byStart = new Map();
  for (const hole of holes) {
    if (!byStart.has(hole.start)) byStart.set(hole.start, []);
    byStart.get(hole.start).push(hole);
  }
  return {
    size: holes.length,
    list: holes,
    /** The hole whose range equals the node's, or -1. */
    equal(node) {
      const range = node.range;
      const hole = range && byStart.get(range[0])?.find((item) => item.end === range[1]);
      return hole ? hole.index : -1;
    },
    /** A hole that contains the node's range, or -1. */
    inside(node) {
      const range = node.range;
      if (range)
        for (const hole of holes)
          if (hole.start <= range[0] && range[1] <= hole.end) return hole.index;
      return -1;
    },
    /** True when a hole lies inside the node without being its whole range. */
    within(node) {
      const range = node.range;
      return (
        !!range &&
        holes.some(
          (hole) =>
            range[0] <= hole.start &&
            hole.end <= range[1] &&
            (hole.start !== range[0] || hole.end !== range[1]),
        )
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Fingerprints and alignment
// ---------------------------------------------------------------------------
const propertyName = (key) =>
  key.type === "Identifier"
    ? key.name
    : key.type === "PrivateIdentifier"
      ? `#${key.name}`
      : key.type === "Literal"
        ? String(key.value)
        : `<${key.type}>`;

const isModuleId = (node, side) =>
  node.type === "Literal" && typeof node.value === "number" && node.value === side.moduleId;

/**
 * Name-insensitive hash of a subtree: node types, operators, property names, literal values and
 * global names, with every bound identifier and every private name as the same token. Whatever
 * the comparator accepts as equal has the same fingerprint (string literal / template without
 * substitutions, `void 0` / global `undefined`, renamed bindings, the main module id outside the
 * main module), so it can only be coarser than the comparison. `shape` hashes the same tokens of
 * the nodes up to SHAPE_DEPTH below the root.
 */
function fingerprint(side, root, outside) {
  let h1 = 0x811c9dc5 | 0;
  let h2 = 0x9e3779b9 | 0;
  let s1 = h1;
  let s2 = h2;
  let inShape = true;
  const mix = (text) => {
    for (let index = 0; index <= text.length; index++) {
      const code = index < text.length ? text.charCodeAt(index) : 0x10000; // token separator
      h1 = Math.imul(h1 ^ code, 0x01000193);
      h2 = Math.imul(h2 ^ code, 0x5bd1e995);
      h2 ^= h2 >>> 15;
      if (inShape) {
        s1 = Math.imul(s1 ^ code, 0x01000193);
        s2 = Math.imul(s2 ^ code, 0x5bd1e995);
        s2 ^= s2 >>> 15;
      }
    }
  };
  const keyToken = (key) =>
    key.type === "PrivateIdentifier"
      ? "#"
      : outside && isModuleId(key, side)
        ? "main"
        : propertyName(key);
  const stack = [root, 0];
  while (stack.length) {
    const depth = stack.pop();
    const node = stack.pop();
    inShape = depth <= SHAPE_DEPTH;
    if (!isNode(node)) {
      mix("∅");
      continue;
    }
    const push = (child) => stack.push(child, depth + 1);
    switch (node.type) {
      case "Identifier": {
        const binding = side.bindings.get(node);
        mix(
          binding === undefined
            ? `n:${node.name}`
            : binding !== "global"
              ? "$"
              : node.name === "undefined"
                ? "undefined"
                : `g:${node.name}`,
        );
        continue;
      }
      case "PrivateIdentifier":
        mix("#");
        continue;
      case "Literal":
        mix(
          node.regex
            ? `r:${node.regex.pattern}/${node.regex.flags}`
            : node.bigint !== undefined
              ? `b:${node.bigint}`
              : typeof node.value === "string"
                ? `s:${node.value}`
                : outside && isModuleId(node, side)
                  ? "main"
                  : `v:${typeof node.value}:${String(node.value)}`,
        );
        continue;
      case "TemplateLiteral":
        if (node.expressions.length === 0) {
          mix(`s:${node.quasis[0].value.cooked}`);
          continue;
        }
        break;
      case "TemplateElement":
        mix(`t:${node.value.raw}`);
        continue;
      case "UnaryExpression":
        if (node.operator === "void" && node.argument.type === "Literal") {
          mix("undefined");
          continue;
        }
        break;
      case "Property":
      case "MethodDefinition":
      case "PropertyDefinition":
        if (!node.computed) {
          mix(`${node.type}:${keyToken(node.key)}`);
          push(node.value ?? null);
          continue;
        }
        break;
      case "MemberExpression":
        if (!node.computed) {
          mix(`.${node.property.type === "PrivateIdentifier" ? "#" : node.property.name}`);
          push(node.object);
          continue;
        }
        break;
      case "BlockStatement":
        if (outside && node === side.factory.body) {
          mix("main module");
          continue;
        }
        break;
      default:
        break;
    }
    mix(node.type);
    if (node.operator) mix(node.operator);
    if (typeof node.kind === "string") mix(node.kind);
    if (node.directive) mix(node.directive);
    const keys = childKeys(node);
    for (const key of keys) if (Array.isArray(node[key])) mix(`${key}:${node[key].length}`);
    for (let k = keys.length - 1; k >= 0; k--) {
      const value = node[keys[k]];
      if (Array.isArray(value))
        for (let index = value.length - 1; index >= 0; index--) push(value[index]);
      else push(value);
    }
  }
  return { exact: `${h1 >>> 0}.${h2 >>> 0}`, shape: `${s1 >>> 0}.${s2 >>> 0}` };
}

const NULL_ITEM = { node: null, exact: "∅", shape: "∅", type: "∅", wildcard: false, soft: false };

/**
 * Pairs [i, j] of a maximum-weight common subsequence of itemsA[fromA..toA) and
 * itemsB[fromB..toB); `weight(i, j)` is 0 when i and j cannot pair and `full` for the best
 * pairing. Common runs of `full` pairs at both ends are taken first; a middle part too large for
 * the table is aligned greedily on `key`.
 */
function commonSubsequence(itemsA, itemsB, range, weight, key, full) {
  let [fromA, toA, fromB, toB] = range;
  const head = [];
  const tail = [];
  while (fromA < toA && fromB < toB && weight(fromA, fromB) === full) head.push([fromA++, fromB++]);
  while (toA > fromA && toB > fromB && weight(toA - 1, toB - 1) === full) tail.push([--toA, --toB]);
  const rows = toA - fromA;
  const columns = toB - fromB;
  const middle = [];
  if (rows > 0 && columns > 0 && (rows + 1) * (columns + 1) <= DP_LIMIT) {
    const width = columns + 1;
    const table = new Int32Array((rows + 1) * width);
    for (let i = rows - 1; i >= 0; i--)
      for (let j = columns - 1; j >= 0; j--) {
        const pairWeight = weight(fromA + i, fromB + j);
        let best = Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
        if (pairWeight > 0) best = Math.max(best, pairWeight + table[(i + 1) * width + j + 1]);
        table[i * width + j] = best;
      }
    for (let i = 0, j = 0; i < rows && j < columns; ) {
      const pairWeight = weight(fromA + i, fromB + j);
      if (pairWeight > 0 && table[i * width + j] === pairWeight + table[(i + 1) * width + j + 1]) {
        middle.push([fromA + i++, fromB + j++]);
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
      else j++;
    }
  } else if (rows > 0 && columns > 0) {
    const positions = new Map(); // key -> ascending indices of B
    for (let j = fromB; j < toB; j++) {
      const value = itemsB[j][key];
      if (!positions.has(value)) positions.set(value, []);
      positions.get(value).push(j);
    }
    let last = fromB - 1;
    for (let i = fromA; i < toA; i++) {
      const list = positions.get(itemsA[i][key]);
      if (!list) continue;
      while (list.length && list[0] <= last) list.shift();
      if (list.length) middle.push([i, (last = list.shift())]);
    }
  }
  return [...head, ...middle, ...tail.reverse()];
}

/**
 * Aligns two lists of items ({ exact, shape, type, wildcard, soft }). Returns pairs in order
 * ({ i, j, how }: "exact", "hole", "shape" or "position"), `moved` pairs (equal fingerprints out
 * of order) and the unpaired indices (`missing` in B, `extra` in B).
 *   1. common subsequence: equal fingerprints weigh 2; a reference item inside a hole (wildcard),
 *      or containing one (soft) and of the same type, weighs 1;
 *   2. in each gap between those pairs: common subsequence of shapes;
 *   3. in each remaining gap with as many items on both sides: items of the same type pair
 *      positionally (a modified statement);
 *   4. unpaired items with equal fingerprints are "moved".
 */
function alignItems(itemsA, itemsB) {
  const weight = (i, j) => {
    const x = itemsA[i];
    const y = itemsB[j];
    if (x.exact === y.exact) return 2;
    return x.wildcard || (x.soft && x.type === y.type) ? 1 : 0;
  };
  const anchors = commonSubsequence(
    itemsA,
    itemsB,
    [0, itemsA.length, 0, itemsB.length],
    weight,
    "exact",
    2,
  );
  const pairs = anchors.map(([i, j]) => ({
    i,
    j,
    how: itemsA[i].exact === itemsB[j].exact ? "exact" : "hole",
  }));
  const shapeWeight = (i, j) => (itemsA[i].shape === itemsB[j].shape ? 1 : 0);
  let previousA = -1;
  let previousB = -1;
  for (const [i, j] of [...anchors, [itemsA.length, itemsB.length]]) {
    if (i - previousA > 1 && j - previousB > 1) {
      const gap = [previousA + 1, i, previousB + 1, j];
      let lastA = gap[0] - 1;
      let lastB = gap[2] - 1;
      for (const [x, y] of [
        ...commonSubsequence(itemsA, itemsB, gap, shapeWeight, "shape", 1),
        [i, j],
      ]) {
        const count = x - lastA - 1;
        if (count > 0 && count === y - lastB - 1)
          for (let k = 1; k <= count; k++)
            if (itemsA[lastA + k].type === itemsB[lastB + k].type)
              pairs.push({ i: lastA + k, j: lastB + k, how: "position" });
        if (x < i) pairs.push({ i: x, j: y, how: "shape" });
        lastA = x;
        lastB = y;
      }
    }
    previousA = i;
    previousB = j;
  }
  pairs.sort((x, y) => x.i - y.i);
  const pairedA = new Set(pairs.map((pair) => pair.i));
  const pairedB = new Set(pairs.map((pair) => pair.j));
  const extraByPrint = new Map();
  itemsB.forEach((item, j) => {
    if (pairedB.has(j)) return;
    if (!extraByPrint.has(item.exact)) extraByPrint.set(item.exact, []);
    extraByPrint.get(item.exact).push(j);
  });
  const moved = [];
  const missing = [];
  itemsA.forEach((item, i) => {
    if (pairedA.has(i)) return;
    const j = extraByPrint.get(item.exact)?.shift();
    if (j === undefined) missing.push(i);
    else {
      moved.push({ i, j, how: "moved" });
      pairedB.add(j);
    }
  });
  const extra = itemsB.map((_, j) => j).filter((j) => !pairedB.has(j));
  return { pairs, moved, missing, extra };
}

// ---------------------------------------------------------------------------
// The comparator
// ---------------------------------------------------------------------------
const isVoidLiteral = (node) =>
  node.type === "UnaryExpression" && node.operator === "void" && node.argument.type === "Literal";
const isGlobalUndefined = (node, side) =>
  node.type === "Identifier" && node.name === "undefined" && side.bindings.get(node) === "global";
/** `text` written as a template without substitutions or as a string literal: same value. */
const plainString = (node) =>
  node.type === "TemplateLiteral" && node.expressions.length === 0
    ? node.quasis[0].value.cooked
    : node.type === "Literal" && typeof node.value === "string"
      ? node.value
      : undefined;

/**
 * Creates the comparison of two prepared programs (`prepareProgram` sides): `a` nodes always
 * belong to `sideA` (the reference), `b` nodes to `sideB` (the candidate).
 *
 * Options:
 *   renames  Map (or object) reference top-level name -> candidate name; names it lacks must be
 *            equal. It is extended in place when `learned` is given.
 *   learned  Set of candidate names that are already the target of a rename, or null (default)
 *            for no learning. With a Set, the first pairing of a reference top-level binding that
 *            `renames` lacks with a candidate top-level binding not in `learned` adds the rename.
 *   holes    [start, end] ranges of the reference source resolved by hand. The outermost
 *            reference node whose range equals a hole, and any list element (statement, member,
 *            argument, array element...) whose range lies inside a hole, matches whatever single
 *            candidate node is at its place without being compared. Inlined copies of a constant
 *            keep the range of its declaration, so a hole around the declaration covers them.
 *
 * Returns { compare, compareOutside, align, fingerprint, report, issues, renames, learned,
 * holes, holesUsed }:
 *   compare(a, b)     compares two nodes, usually two statements, and returns the messages of
 *                     the differences found (empty when equal). It never throws for a difference;
 *                     a list whose elements stop matching is aligned and reported once.
 *   compareOutside()  compares the two whole programs except the bodies of their main modules,
 *                     where a number equal to a side's main module id stands for the main module.
 *   align(listA, listB) aligns two node lists (see alignItems) without comparing them.
 *   fingerprint(side, node) the alignment item of a node: { exact, shape, type, ... }.
 *   report(message, offsetA, offsetB) adds an issue of the caller's own.
 * Every comparison shares the state of the comparator: the bijection of bindings, of class bodies
 * and of private names, and the learned renames. A comparison that fails keeps what it learned
 * before the difference (only the tentative positional comparison of a list element is undone).
 * A private name outside every class body being compared (a comparison that starts inside a
 * class) must be equal. `issues` collects { message, offsetA, offsetB } of every comparison;
 * `holesUsed` holds the indices (into `holes`) of the holes that matched something.
 */
export function createComparator(sideA, sideB, options = {}) {
  const renames =
    options.renames instanceof Map
      ? options.renames
      : new Map(Object.entries(options.renames ?? {}));
  const learned = options.learned ?? null;
  const holes = holeIndex(options.holes ?? []);
  const issues = [];
  const holesUsed = new Set();
  const aToB = new Map();
  const bToA = new Map();
  const classes = new Map(); // class body of A -> { body (of B), aToB, bToA } private names
  const classesB = new Map(); // class body of B -> class body of A
  const classStackA = [];
  const classStackB = [];
  const contextA = []; // statements being compared, for excerpts
  const contextB = [];
  const journal = []; // container, key, ...: the additions a failed tentative comparison undoes
  const prints = new WeakMap();
  const privateNames = new WeakMap();
  let outside = false;

  function remember(container, key, value) {
    if (container instanceof Set) container.add(key);
    else container.set(key, value);
    journal.push(container, key);
  }
  function rollback(mark) {
    while (journal.length > mark) {
      const key = journal.pop();
      journal.pop().delete(key);
    }
  }
  function useHole(index) {
    if (!holesUsed.has(index)) remember(holesUsed, index);
  }
  function report(message, offsetA = null, offsetB = null) {
    const issue = { message, offsetA, offsetB };
    issues.push(issue);
    return issue;
  }
  function issueOf(error) {
    const contextNodeA = contextA.at(-1) ?? error.a;
    const contextNodeB = contextB.at(-1) ?? error.b;
    return {
      message:
        `${error.reason}\n    reference ${where(sideA, error.a, contextNodeA)}` +
        `\n    candidate ${where(sideB, error.b, contextNodeB)}`,
      offsetA: error.a?.range?.[0] ?? null,
      offsetB: error.b?.range?.[0] ?? null,
      // The same difference met again at the same nodes (an inlined constant read in several
      // places) is reported once.
      key: `${error.reason}\n${error.a?.range}\n${error.b?.range}`,
    };
  }

  function itemOf(side, node, reference) {
    if (node === null) return NULL_ITEM;
    let print = prints.get(node);
    if (!print) prints.set(node, (print = fingerprint(side, node, outside)));
    return {
      node,
      exact: print.exact,
      shape: print.shape,
      type: node.type === "VariableDeclaration" ? `${node.type}:${node.kind}` : node.type,
      wildcard: reference && holes.size > 0 && holes.inside(node) >= 0,
      soft: reference && holes.size > 0 && holes.within(node),
    };
  }

  function compareBinding(a, b, bindingA, bindingB) {
    if (bindingA === "global" || bindingB === "global") {
      if (bindingA !== bindingB || a.name !== b.name)
        fail(`global/binding mismatch: ${a.name} vs ${b.name}`, a, b);
      return;
    }
    const topA = sideA.topVariables.has(bindingA);
    const topB = sideB.topVariables.has(bindingB);
    if (topA || topB) {
      if (topA !== topB)
        fail(
          `${topA ? "top-level" : "local"} binding ${a.name} vs ${topB ? "top-level" : "local"} binding ${b.name}`,
          a,
          b,
        );
      if (learned && !renames.has(bindingA.name) && !learned.has(bindingB.name)) {
        remember(renames, bindingA.name, bindingB.name);
        remember(learned, bindingB.name);
      }
      const expected = renames.get(bindingA.name) ?? bindingA.name;
      if (expected !== bindingB.name)
        fail(
          `top-level binding ${bindingA.name} should be ${expected}, found ${bindingB.name}`,
          a,
          b,
        );
    }
    const mappedB = aToB.get(bindingA);
    const mappedA = bToA.get(bindingB);
    if (mappedB === undefined && mappedA === undefined) {
      remember(aToB, bindingA, bindingB);
      remember(bToA, bindingB, bindingA);
      return;
    }
    if (mappedB !== bindingB || mappedA !== bindingA)
      fail(
        `inconsistent renaming: ${a.name} -> ${b.name} (previously ${mappedB?.name ?? "-"} / ${mappedA?.name ?? "-"})`,
        a,
        b,
      );
  }

  function declaredPrivateNames(classBody) {
    let names = privateNames.get(classBody);
    if (!names) {
      names = new Set();
      for (const member of classBody.body)
        if (member.key?.type === "PrivateIdentifier") names.add(member.key.name);
      privateNames.set(classBody, names);
    }
    return names;
  }
  function declaringLevel(stack, name) {
    for (let level = stack.length - 1; level >= 0; level--)
      if (declaredPrivateNames(stack[level]).has(name)) return level;
    return -1;
  }
  /** #name: a one-to-one renaming per pair of declaring class bodies. */
  function comparePrivate(a, b) {
    if (a.type !== "PrivateIdentifier" || b.type !== "PrivateIdentifier")
      fail(`private name vs ${a.type === "PrivateIdentifier" ? b.type : a.type}`, a, b);
    const levelA = declaringLevel(classStackA, a.name);
    const levelB = declaringLevel(classStackB, b.name);
    if (levelA < 0 || levelB < 0) {
      // Outside any compared class body (a partial comparison): only the same name is safe.
      if (levelA !== levelB || a.name !== b.name)
        fail(`private name #${a.name} vs #${b.name}`, a, b);
      return;
    }
    if (levelA !== levelB)
      fail(`private name #${a.name} vs #${b.name}: declared by different classes`, a, b);
    const entry = classes.get(classStackA[levelA]);
    const mappedB = entry.aToB.get(a.name);
    const mappedA = entry.bToA.get(b.name);
    if (mappedB === undefined && mappedA === undefined) {
      remember(entry.aToB, a.name, b.name);
      remember(entry.bToA, b.name, a.name);
      return;
    }
    if (mappedB !== b.name || mappedA !== a.name)
      fail(
        `inconsistent private renaming: #${a.name} -> #${b.name} (previously #${mappedB ?? "-"} / #${mappedA ?? "-"})`,
        a,
        b,
      );
  }

  function compareKeys(a, b) {
    if (a.type === "PrivateIdentifier" || b.type === "PrivateIdentifier")
      return comparePrivate(a, b);
    if (outside && (isModuleId(a, sideA) || isModuleId(b, sideB))) {
      if (!isModuleId(a, sideA) || !isModuleId(b, sideB))
        fail(`property ${propertyName(a)} vs ${propertyName(b)} (main module id)`, a, b);
      return;
    }
    if (propertyName(a) !== propertyName(b))
      fail(`property ${propertyName(a)} vs ${propertyName(b)}`, a, b);
  }

  function compareNodes(a, b) {
    if (holes.size) {
      const hole = holes.equal(a);
      if (hole >= 0) return useHole(hole);
    }
    if (outside && (a === sideA.factory.body || b === sideB.factory.body)) {
      if (a !== sideA.factory.body || b !== sideB.factory.body)
        fail("the main module is at a different place", a, b);
      return;
    }
    if (isVoidLiteral(a) && isGlobalUndefined(b, sideB)) return;
    if (isGlobalUndefined(a, sideA) && isVoidLiteral(b)) return;
    if (a.type !== b.type) {
      const stringA = plainString(a);
      const stringB = plainString(b);
      if (stringA === undefined || stringB === undefined)
        fail(`node type ${a.type} vs ${b.type}`, a, b);
      if (stringA !== stringB) fail("string value differs", a, b);
      return;
    }
    if (!CONTEXT_TYPES.has(a.type)) return compareSameType(a, b);
    contextA.push(a);
    contextB.push(b);
    compareSameType(a, b);
    contextA.pop();
    contextB.pop();
  }

  function compareSameType(a, b) {
    switch (a.type) {
      case "Identifier": {
        const bindingA = sideA.bindings.get(a);
        const bindingB = sideB.bindings.get(b);
        if (bindingA === undefined && bindingB === undefined) {
          if (a.name !== b.name) fail(`name ${a.name} vs ${b.name}`, a, b);
          return;
        }
        if (bindingA === undefined || bindingB === undefined)
          fail(`identifier role differs: ${a.name} vs ${b.name}`, a, b);
        return compareBinding(a, b, bindingA, bindingB);
      }
      case "PrivateIdentifier":
        return comparePrivate(a, b);
      case "Literal":
        if (outside && (isModuleId(a, sideA) || isModuleId(b, sideB))) {
          if (!isModuleId(a, sideA) || !isModuleId(b, sideB))
            fail(`literal ${a.raw} vs ${b.raw} (main module id)`, a, b);
          return;
        }
        if (a.regex || b.regex) {
          if (
            !a.regex ||
            !b.regex ||
            a.regex.pattern !== b.regex.pattern ||
            a.regex.flags !== b.regex.flags
          )
            fail(`regex ${a.raw} vs ${b.raw}`, a, b);
          return;
        }
        if (a.bigint !== undefined || b.bigint !== undefined) {
          if (a.bigint !== b.bigint) fail(`bigint ${a.raw} vs ${b.raw}`, a, b);
          return;
        }
        if (typeof a.value !== typeof b.value || !Object.is(a.value, b.value))
          fail(
            `literal ${JSON.stringify(a.value)?.slice(0, 80)} vs ${JSON.stringify(b.value)?.slice(0, 80)}`,
            a,
            b,
          );
        return;
      case "TemplateElement":
        // Tag functions (String.raw, ...) see the raw text, and invalid escapes cook to null.
        if (a.value.cooked !== b.value.cooked || a.value.raw !== b.value.raw || a.tail !== b.tail)
          fail("template text differs", a, b);
        return;
      case "Property":
      case "MethodDefinition":
      case "PropertyDefinition":
        if (!a.computed && !b.computed) {
          compareKeys(a.key, b.key);
          // `{ __proto__ }` defines an own property; `{ __proto__: value }` sets the prototype.
          if (propertyName(a.key) === "__proto__" && !!a.shorthand !== !!b.shorthand)
            fail("__proto__ shorthand differs", a, b);
          for (const key of ["kind", "method", "static", "computed"])
            if (a[key] !== b[key]) fail(`${key} differs on property ${propertyName(a.key)}`, a, b);
          if (a.value || b.value) {
            if (!a.value || !b.value) fail("property value presence differs", a, b);
            compareNodes(a.value, b.value);
          }
          return;
        }
        break;
      case "MemberExpression":
        if (!a.computed && !b.computed) {
          compareNodes(a.object, b.object);
          if (a.property.type === "PrivateIdentifier" || b.property.type === "PrivateIdentifier")
            comparePrivate(a.property, b.property);
          else if (a.property.name !== b.property.name)
            fail(`member .${a.property.name} vs .${b.property.name}`, a.property, b.property);
          if (!!a.optional !== !!b.optional) fail("optional chaining differs", a, b);
          return;
        }
        break;
      case "LabeledStatement":
      case "BreakStatement":
      case "ContinueStatement":
        if ((a.label?.name ?? null) !== (b.label?.name ?? null)) fail("label differs", a, b);
        if (a.body) compareNodes(a.body, b.body);
        return;
      case "MetaProperty":
        if (a.meta.name !== b.meta.name || a.property.name !== b.property.name)
          fail("meta property differs", a, b);
        return;
      case "UnaryExpression":
        // `delete void 0` is true but `delete undefined` is false (sloppy code).
        if (a.operator === "delete" && a.argument.type !== b.argument?.type)
          fail("delete operand differs", a, b);
        break;
      case "ExpressionStatement":
        // The directive is the raw source text: "use\x20strict" is not a Use Strict Directive.
        if ((a.directive ?? null) !== (b.directive ?? null)) fail("directive differs", a, b);
        break;
      case "ClassBody": {
        const known = classes.get(a);
        if (known ? known.body !== b : classesB.has(b))
          fail("class compared with a different class", a, b);
        if (!known) {
          remember(classes, a, { body: b, aToB: new Map(), bToA: new Map() });
          remember(classesB, b, a);
        }
        classStackA.push(a);
        classStackB.push(b);
        compareFields(a, b);
        classStackA.pop();
        classStackB.pop();
        return;
      }
      default:
        break;
    }
    compareFields(a, b);
  }

  function compareFields(a, b) {
    for (const key of Object.keys(a)) compareField(a, b, key);
    for (const key of Object.keys(b)) if (!Object.hasOwn(a, key)) compareField(a, b, key);
  }

  function compareField(a, b, key) {
    if (IGNORED_KEYS.has(key)) return;
    const valueA = a[key];
    const valueB = b[key];
    if (Array.isArray(valueA) || Array.isArray(valueB)) {
      if (!Array.isArray(valueA) || !Array.isArray(valueB))
        fail(`${a.type}.${key} presence differs`, a, b);
      compareList(a, b, key, valueA, valueB);
    } else if (isNode(valueA) || isNode(valueB)) {
      if (!isNode(valueA) || !isNode(valueB)) fail(`${a.type}.${key} presence differs`, a, b);
      compareNodes(valueA, valueB);
    } else if (
      valueA !== valueB &&
      !(valueA == null && valueB == null) &&
      !(key === "expression" && typeof valueA === "boolean")
    ) {
      fail(`${a.type}.${key}: ${String(valueA)} vs ${String(valueB)}`, a, b);
    }
  }

  /**
   * Lists of the same length are compared element by element. At the first element that differs
   * (or when the lengths differ) the rest is aligned instead, so that one inserted or removed
   * element gives one report, not a mismatch at every later position. Never throws a Mismatch.
   */
  function compareList(ownerA, ownerB, key, listA, listB) {
    if (listA.length !== listB.length) return realign(ownerA, ownerB, key, listA, listB, 0, null);
    for (let index = 0; index < listA.length; index++) {
      const itemA = listA[index];
      const itemB = listB[index];
      if (itemA === null || itemB === null) {
        if (itemA === itemB) continue;
        return realign(ownerA, ownerB, key, listA, listB, index, null);
      }
      if (holes.size) {
        const hole = holes.inside(itemA);
        if (hole >= 0) {
          useHole(hole);
          continue;
        }
      }
      const failure = { mark: journal.length, issueMark: issues.length, depth: contextA.length };
      const classDepth = classStackA.length;
      try {
        compareNodes(itemA, itemB);
      } catch (error) {
        if (!(error instanceof Mismatch)) throw error;
        failure.issue = issueOf(error);
        contextA.length = contextB.length = failure.depth;
        classStackA.length = classStackB.length = classDepth;
        return realign(ownerA, ownerB, key, listA, listB, index, failure);
      }
    }
  }

  function realign(ownerA, ownerB, key, listA, listB, from, failure) {
    const itemsA = listA.slice(from).map((node) => itemOf(sideA, node, true));
    const itemsB = listB.slice(from).map((node) => itemOf(sideB, node, false));
    const { pairs, moved, missing, extra } = alignItems(itemsA, itemsB);
    // The failed element keeps its comparison when the alignment pairs it the same way.
    const kept = failure && pairs[0]?.i === 0 && pairs[0]?.j === 0;
    if (kept) issues.push(failure.issue);
    else if (failure) {
      rollback(failure.mark);
      issues.length = failure.issueMark;
    }
    for (const pair of pairs)
      if (!(kept && pair.i === 0)) compareElement(listA[from + pair.i], listB[from + pair.j]);
    for (const pair of moved) compareElement(listA[from + pair.i], listB[from + pair.j]);
    if (!missing.length && !extra.length && !moved.length) return;
    const counts = [
      missing.length && `${missing.length} missing in the candidate`,
      extra.length && `${extra.length} extra in the candidate`,
      moved.length && `${moved.length} moved`,
    ].filter(Boolean);
    const listed = (label, side, list, indices) =>
      indices.length
        ? `\n    ${label}: ` +
          indices
            .slice(0, ITEMS_SHOWN)
            .map((index) => itemText(side, list[from + index]))
            .join(", ") +
          (indices.length > ITEMS_SHOWN ? `, … ${indices.length - ITEMS_SHOWN} more` : "")
        : "";
    const movedA = moved.map((pair) => pair.i);
    report(
      `${ownerA.type}.${key}: ${counts.join(", ")}` +
        `\n    reference ${where(sideA, ownerA, contextA.at(-1) ?? ownerA)}` +
        `\n    candidate ${where(sideB, ownerB, contextB.at(-1) ?? ownerB)}` +
        listed("missing", sideA, listA, missing) +
        listed("extra", sideB, listB, extra) +
        listed("moved", sideA, listA, movedA),
      listA[from + (missing[0] ?? movedA[0])]?.range?.[0] ?? ownerA.range?.[0] ?? null,
      listB[from + (extra[0] ?? moved[0]?.j)]?.range?.[0] ?? ownerB.range?.[0] ?? null,
    );
  }

  /** Compares a list element (or a top-level statement): inside a hole, it matches anything. */
  function compareElement(a, b) {
    if (a === null || b === null) {
      if (a !== b)
        report(
          `array hole vs element\n    ${a ? `reference ${where(sideA, a)}` : `candidate ${where(sideB, b)}`}`,
          a?.range?.[0] ?? null,
          b?.range?.[0] ?? null,
        );
      return;
    }
    if (holes.size) {
      const hole = holes.inside(a);
      if (hole >= 0) return useHole(hole);
    }
    const depth = contextA.length;
    const classDepth = classStackA.length;
    try {
      compareNodes(a, b);
    } catch (error) {
      if (!(error instanceof Mismatch)) throw error;
      issues.push(issueOf(error));
      contextA.length = contextB.length = depth;
      classStackA.length = classStackB.length = classDepth;
    }
  }

  function compare(a, b) {
    const before = issues.length;
    compareElement(a, b);
    return issues.slice(before).map((issue) => issue.message);
  }

  function compareOutside() {
    outside = true;
    try {
      return compare(sideA.program, sideB.program);
    } finally {
      outside = false;
    }
  }

  return {
    compare,
    compareOutside,
    align: (listA, listB) =>
      alignItems(
        listA.map((node) => itemOf(sideA, node, true)),
        listB.map((node) => itemOf(sideB, node, false)),
      ),
    fingerprint: (side, node) => itemOf(side, node, side === sideA),
    report,
    issues,
    renames,
    learned,
    holesUsed,
    holes: holes.list,
  };
}

// ---------------------------------------------------------------------------
// Top-level declarations of the main module
// ---------------------------------------------------------------------------
const isMovableLet = (statement) =>
  statement.type === "VariableDeclaration" &&
  statement.kind === "let" &&
  statement.declarations.length === 1 &&
  statement.declarations[0].id.type === "Identifier" &&
  (!statement.declarations[0].init || isScalar(statement.declarations[0].init));

/**
 * The identifiers of a top-level statement whose code runs when the statement itself is
 * evaluated, or null when that is all of them. A function declaration runs nothing. A class
 * declaration without static blocks or static field initializers only evaluates its heritage and
 * computed keys: its methods and instance fields can only run through its (top-level) name.
 */
function identifiersEvaluatedNow(statement) {
  if (statement.type === "FunctionDeclaration") return new Set();
  if (statement.type !== "ClassDeclaration") return null;
  const members = statement.body.body;
  const runsStaticCode = members.some(
    (member) =>
      member.type === "StaticBlock" ||
      (member.type === "PropertyDefinition" && member.static && member.value),
  );
  if (runsStaticCode) return null;
  const identifiers = new Set();
  const parts = [statement.superClass, ...members.map((member) => member.computed && member.key)];
  for (const part of parts.filter(Boolean))
    forEachNode(part, (node) => {
      if (node.type === "Identifier") identifiers.add(node);
    });
  return identifiers;
}

/**
 * Describes the top-level `let NAME;` / `let NAME = <primitive literal>;` declarations of the main
 * module: `position` is the number of ordered statements (neither function declarations nor such
 * lets) before the declaration and `reachable` tells whether anything evaluated before it might
 * read NAME. Reachability is over-approximated: the code each earlier statement runs when
 * evaluated and, transitively, everything in the declaration of every top-level binding that code
 * mentions (also inside nested functions) counts. References are attributed to statements by node
 * identity, so the synthetic nodes of the normalization are attributed correctly.
 */
export function letDeclarations(side) {
  const body = side.body;
  const factoryScope = side.scopeManager.acquire(side.factory);
  const topVariables = side.topVariables;
  const statementOf = new Map();
  body.forEach((statement, index) =>
    forEachNode(statement, (node) => {
      if (node.type === "Identifier") statementOf.set(node, index);
    }),
  );
  const evaluatedNow = body.map(identifiersEvaluatedNow);
  const referencesByStatement = body.map(() => new Set());
  const evaluatedByStatement = body.map(() => new Set());
  for (const scope of side.scopeManager.scopes) {
    for (const reference of scope.references) {
      if (!reference.resolved || !topVariables.has(reference.resolved)) continue;
      const index = statementOf.get(reference.identifier);
      if (index === undefined) continue;
      referencesByStatement[index].add(reference.resolved);
      if (evaluatedNow[index] === null || evaluatedNow[index].has(reference.identifier))
        evaluatedByStatement[index].add(reference.resolved);
    }
  }
  // Every declaration of a binding counts (`var g; function g(){}` declares g twice).
  const declaringStatements = new Map();
  for (const variable of topVariables)
    declaringStatements.set(
      variable,
      variable.identifiers
        .map((identifier) => statementOf.get(identifier))
        .filter((index) => index !== undefined),
    );
  const result = [];
  const evaluatedBefore = new Set();
  let position = 0;
  for (let index = 0; index < body.length; index++) {
    const statement = body[index];
    if (isMovableLet(statement)) {
      const variable = factoryScope.set.get(statement.declarations[0].id.name);
      const seen = new Set();
      const pending = [...evaluatedBefore];
      let reachable = false;
      while (pending.length && !reachable) {
        const current = pending.pop();
        if (seen.has(current)) continue;
        seen.add(current);
        if (current === variable) reachable = true;
        for (const declaration of declaringStatements.get(current) ?? [])
          pending.push(...referencesByStatement[declaration]);
      }
      result.push({ statement, name: variable.name, position, reachable });
    } else if (statement.type !== "FunctionDeclaration") position++;
    for (const variable of evaluatedByStatement[index]) evaluatedBefore.add(variable);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
function toSide(input, moduleId, label) {
  if (typeof input === "string")
    return prepareProgram(input, { moduleId: moduleId ?? null, label });
  if (input && input.program && input.factory) {
    if (moduleId != null && moduleId !== input.moduleId)
      throw new Error(`${label}: prepared with module ${input.moduleId}, not ${moduleId}`);
    return input;
  }
  throw new TypeError(`${label}: expected the source of a userscript or a prepared program`);
}

/**
 * Compares a reference userscript with a candidate (sources, or sides from `prepareProgram`).
 *
 * Options:
 *   renames             { referenceName: candidateName } of the main module's top-level bindings
 *   learn               learn the renames that `renames` lacks (default: true when `renames` is
 *                       not given)
 *   referenceModuleId   main module id of each side (default: the largest module of its table)
 *   candidateModuleId
 *   holes               [[start, end], ...] reference ranges resolved by hand (createComparator)
 *   maxMismatches       number of messages returned (default 50); every difference is counted
 *
 * Returns { equivalent, mismatches, mismatchCount, renames, statements, unmatched, holesUsed,
 * unusedHoles, moduleIds, inlined }. `mismatches` are messages sorted by reference position;
 * `unmatched` lists the top-level statements, functions and lets of the main module that have
 * no counterpart ({ kind, name, line, column, region, excerpt, start, end }); `renames` is the
 * final map (given and learned, without identities).
 */
export function verifyEquivalence(referenceSource, candidateSource, options = {}) {
  const sideA = toSide(referenceSource, options.referenceModuleId, "reference");
  const sideB = toSide(candidateSource, options.candidateModuleId, "candidate");
  const renames = new Map(
    options.renames instanceof Map ? options.renames : Object.entries(options.renames ?? {}),
  );
  const learn = options.learn ?? options.renames === undefined;
  const learned = learn ? new Set(renames.values()) : null;
  const comparator = createComparator(sideA, sideB, { renames, learned, holes: options.holes });
  const { compare, report } = comparator;
  const unmatched = { reference: [], candidate: [] };

  comparator.compareOutside();

  // Ordered statements: aligned, then compared pair by pair. The pairs found by fingerprint come
  // first, so that the renames are learned from the most reliable pairs.
  const orderedA = sideA.body.filter((s) => s.type !== "FunctionDeclaration" && !isMovableLet(s));
  const orderedB = sideB.body.filter((s) => s.type !== "FunctionDeclaration" && !isMovableLet(s));
  const alignment = comparator.align(orderedA, orderedB);
  for (const pair of alignment.pairs)
    if (pair.how === "exact" || pair.how === "hole") compare(orderedA[pair.i], orderedB[pair.j]);

  // Function declarations and movable lets are paired by name (through the renames); comparing
  // a pair learns more names, so this repeats until nothing changes.
  const pool = (entries) => {
    const map = new Map();
    for (const entry of entries) {
      if (!map.has(entry.name)) map.set(entry.name, []);
      map.get(entry.name).push(entry);
    }
    return map;
  };
  const functionEntry = (statement) => ({ kind: "function", name: statement.id.name, statement });
  const letEntry = (entry) => ({ kind: "let", ...entry });
  const poolB = {
    function: pool(sideB.body.filter((s) => s.type === "FunctionDeclaration").map(functionEntry)),
    let: pool(letDeclarations(sideB).map(letEntry)),
  };
  let pending = [
    ...sideA.body.filter((s) => s.type === "FunctionDeclaration").map(functionEntry),
    ...letDeclarations(sideA).map(letEntry),
  ];
  const pairedLets = [];
  const pairEntries = (entryA, entryB) => {
    if (entryA.kind === "let") pairedLets.push([entryA, entryB]);
    compare(entryA.statement, entryB.statement);
  };
  const pairByName = () => {
    for (let progress = true; progress; ) {
      progress = false;
      pending = pending.filter((entry) => {
        const target =
          renames.get(entry.name) ?? (learned?.has(entry.name) ? undefined : entry.name);
        const counterparts = target === undefined ? undefined : poolB[entry.kind].get(target);
        if (!counterparts?.length) return true;
        if (learned && !renames.has(entry.name)) {
          renames.set(entry.name, target);
          learned.add(target);
        }
        pairEntries(entry, counterparts.shift());
        progress = true;
        return false;
      });
    }
  };
  // Declarations no comparison named (e.g. never referenced) pair by fingerprint, in order.
  const pairByFingerprint = () => {
    const groups = new Map();
    const group = (key) => {
      if (!groups.has(key)) groups.set(key, { a: [], b: [] });
      return groups.get(key);
    };
    for (const entry of pending)
      if (!renames.has(entry.name))
        group(`${entry.kind}:${comparator.fingerprint(sideA, entry.statement).exact}`).a.push(
          entry,
        );
    for (const kind of ["function", "let"])
      for (const entries of poolB[kind].values())
        for (const entry of entries)
          if (!learned.has(entry.name))
            group(`${kind}:${comparator.fingerprint(sideB, entry.statement).exact}`).b.push(entry);
    let paired = 0;
    for (const { a, b } of groups.values()) {
      if (!a.length || a.length !== b.length) continue;
      a.forEach((entryA, index) => {
        const entryB = b[index];
        poolB[entryA.kind]
          .get(entryB.name)
          .splice(poolB[entryA.kind].get(entryB.name).indexOf(entryB), 1);
        pending.splice(pending.indexOf(entryA), 1);
        renames.set(entryA.name, entryB.name);
        learned.add(entryB.name);
        pairEntries(entryA, entryB);
        paired++;
      });
    }
    return paired;
  };
  pairByName();

  // Then the weaker pairs (modified statements) and the moved ones.
  for (const pair of alignment.pairs)
    if (pair.how === "shape" || pair.how === "position")
      compare(orderedA[pair.i], orderedB[pair.j]);
  for (const pair of alignment.moved) {
    compare(orderedA[pair.i], orderedB[pair.j]);
    report(
      `statement moved` +
        `\n    reference ${where(sideA, orderedA[pair.i])}` +
        `\n    candidate ${where(sideB, orderedB[pair.j])}`,
      orderedA[pair.i].range[0],
      orderedB[pair.j].range[0],
    );
  }
  pairByName();
  while (learned && pending.length && pairByFingerprint() > 0) pairByName();

  // What has no counterpart.
  for (const i of alignment.missing) {
    unmatched.reference.push(unmatchedEntry(sideA, orderedA[i], "statement"));
    report(
      `statement missing in the candidate\n    reference ${where(sideA, orderedA[i])}`,
      orderedA[i].range[0],
    );
  }
  const pairedIndices = alignment.pairs;
  for (const j of alignment.extra) {
    // Sorted with the reference statement that precedes it.
    const before = pairedIndices.filter((pair) => pair.j < j).at(-1);
    unmatched.candidate.push(unmatchedEntry(sideB, orderedB[j], "statement"));
    report(
      `statement extra in the candidate\n    candidate ${where(sideB, orderedB[j])}`,
      before ? orderedA[before.i].range[1] : (sideA.factory.body.range?.[0] ?? 0),
      orderedB[j].range[0],
    );
  }
  for (const entry of pending) {
    const expected = renames.get(entry.name) ?? entry.name;
    unmatched.reference.push(unmatchedEntry(sideA, entry.statement, entry.kind, entry.name));
    report(
      `${entry.kind} ${entry.name}${expected !== entry.name ? ` (expected as ${expected})` : ""} ` +
        `is missing in the candidate\n    reference ${where(sideA, entry.statement)}`,
      entry.statement.range[0],
    );
  }
  for (const kind of ["function", "let"])
    for (const [name, entries] of poolB[kind])
      for (const entry of entries) {
        unmatched.candidate.push(unmatchedEntry(sideB, entry.statement, kind, name));
        report(
          `${kind} ${name} exists only in the candidate\n    candidate ${where(sideB, entry.statement)}`,
          Infinity,
          entry.statement.range[0],
        );
      }

  // `let NAME;` / `let NAME = <primitive>;` may move, e.g. next to the code that assigns them,
  // when nothing evaluated before the later of the two places can read NAME: a read there throws
  // (TDZ) on one side only, and a try/catch could observe that. A let moved later when an ordered
  // statement after it in the reference is before it in the candidate (and earlier conversely).
  const orderedPairs = alignment.pairs;
  for (const [entry, counterpart] of pairedLets) {
    const after = orderedPairs.find((pair) => pair.i >= entry.position);
    const before = orderedPairs.findLast((pair) => pair.i < entry.position);
    const movedLater = after !== undefined && after.j < counterpart.position;
    const movedEarlier = before !== undefined && before.j >= counterpart.position;
    if (movedLater && counterpart.reachable)
      report(
        `let ${entry.name} moved later, after code that may read it` +
          `\n    reference ${where(sideA, entry.statement)}\n    candidate ${where(sideB, counterpart.statement)}`,
        entry.statement.range[0],
        counterpart.statement.range[0],
      );
    if (movedEarlier && entry.reachable)
      report(
        `let ${entry.name} moved earlier, before code that may read it` +
          `\n    reference ${where(sideA, entry.statement)}\n    candidate ${where(sideB, counterpart.statement)}`,
        entry.statement.range[0],
        counterpart.statement.range[0],
      );
  }

  const byKey = new Map();
  const issues = [];
  comparator.issues.forEach((issue, order) => {
    const same = issue.key && byKey.get(issue.key);
    if (same) same.repeats++;
    else {
      const entry = { ...issue, order, repeats: 1 };
      if (issue.key) byKey.set(issue.key, entry);
      issues.push(entry);
    }
  });
  issues.sort((x, y) => (x.offsetA ?? Infinity) - (y.offsetA ?? Infinity) || x.order - y.order);
  const messageOf = ({ message, repeats }) =>
    repeats === 1 ? message : message.replace("\n", ` (found ${repeats} times)\n`);
  const maxMismatches = options.maxMismatches ?? DEFAULT_MAX_MISMATCHES;
  return {
    equivalent: issues.length === 0,
    mismatches: issues.slice(0, maxMismatches).map(messageOf),
    mismatchCount: issues.length,
    renames: Object.fromEntries([...renames].filter(([from, to]) => from !== to)),
    statements: { reference: sideA.body.length, candidate: sideB.body.length },
    unmatched,
    holesUsed: comparator.holesUsed.size,
    unusedHoles: comparator.holes
      .filter((hole) => !comparator.holesUsed.has(hole.index))
      .map((hole) => [hole.start, hole.end]),
    moduleIds: { reference: sideA.moduleId, candidate: sideB.moduleId },
    inlined: { reference: sideA.inlined.size, candidate: sideB.inlined.size },
  };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args.splice(index, 2)[1];
  };
  const flag = (name) => {
    const index = args.indexOf(name);
    if (index >= 0) args.splice(index, 1);
    return index >= 0;
  };
  const readJson = (file) => (file ? JSON.parse(fs.readFileSync(file, "utf8")) : undefined);
  const renames = readJson(option("--renames"));
  const holes = readJson(option("--holes"));
  const maxMismatches = Number(option("--max-mismatches") ?? DEFAULT_MAX_MISMATCHES);
  const learn = flag("--no-learn") ? false : undefined;
  if (args.length !== 2) {
    console.error(
      "usage: equivalence.mjs <reference.user.js> <candidate.user.js> " +
        "[--renames map.json] [--no-learn] [--holes holes.json] [--max-mismatches N]",
    );
    process.exit(2);
  }
  const [reference, candidate] = args.map((file) => fs.readFileSync(file, "utf8"));
  const result = verifyEquivalence(reference, candidate, { renames, learn, holes, maxMismatches });
  const summary =
    `main module ${result.moduleIds.reference} -> ${result.moduleIds.candidate}, statements ` +
    `${result.statements.reference} -> ${result.statements.candidate}, ` +
    `${Object.keys(result.renames).length} renames, ${result.holesUsed} holes used`;
  if (result.equivalent) {
    console.log(`equivalent: ${summary}`);
  } else {
    console.error(`NOT equivalent (${result.mismatchCount} difference(s); ${summary}):`);
    for (const mismatch of result.mismatches) console.error(`  - ${mismatch}`);
    if (result.mismatchCount > result.mismatches.length)
      console.error(`  … ${result.mismatchCount - result.mismatches.length} more`);
    process.exit(1);
  }
}
