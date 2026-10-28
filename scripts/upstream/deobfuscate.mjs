#!/usr/bin/env node
// Static deobfuscator for the upstream Paletools releases (javascript-obfuscator output). It
// resolves the string array, removes its machinery (the string-table function, the decoder, the
// rotation IIFE and every alias of the decoder), rewrites `!0x0`/`!0x1` (true/false),
// hexadecimal numbers, `\x`/`\u` escapes and `obj["name"]` member accesses, and formats the result
// with Prettier. Identifiers keep their obfuscated names (`_0x…`).
//
//   node scripts/upstream/deobfuscate.mjs <release.user.js> <output.js> [--no-verify]
//
// Nothing from the input is executed (no eval, vm or Function): the string table is read as data
// and the rotation loop is interpreted by a small arithmetic evaluator (parseInt, + - * / %).
//
// Input: the release as published (minified, one long line) or a formatted copy. Every change is
// a text edit on the input, so all the text that is not obfuscation machinery (the metadata block
// included) is kept. The edits are token safe: an edit whose text would glue to a neighbouring
// token gets a space (`return!0x0` -> `return true`, `a['b']instanceof` -> `a.b instanceof`), and
// removing the rotation from `(rotation, main)` removes its comma and its own parentheses only.
// (The earlier tool of the paletools repository removed `rotation,(` up to the start of the next
// expression, which unbalances the parentheses of the minified layout `(rotation,((()=>{…})()))`,
// and replaced `!0x0` with `true` without looking at the neighbours (`return!0x0`); both only
// worked on Prettier output. This one gives the same program from both kinds of input.)
//
// Self-check (on by default, --no-verify skips it): the output is parsed again and compared node
// by node with the input, in which the decoder calls stand for their strings and the machinery is
// left out (see `verifyDeobfuscation`). Any other difference fails the run, so a new obfuscator
// layout cannot silently produce a different program.
//
// Layout of every release from 27.0.2 to 27.2.1 (the top-level statements come in any order):
//   function T() { const a = ["…", …]; T = function () { return a; }; return T(); }
//   function D(i, k) {
//     const t = T();
//     return (D = function (i, k) { i = i - OFFSET; let s = t[i]; return s; }), D(i, k);
//   }
//   (function (table, target) { … while (true) try { if (CHECKSUM === target) break; else
//     array.push(array.shift()); } catch { array.push(array.shift()); } })(T, TARGET), main;
// and inside the code, `const _0xabc = D;` aliases (also aliases of aliases) called as
// `_0xabc(0x1f4)`. Encoded string arrays (base64/rc4) are detected and refused.
import fs from "node:fs";
import { tokTypes, tokenizer } from "acorn";
import { analyze } from "eslint-scope";
import prettier from "prettier";
import { childKeys, isMainModule, isNode, parseScript } from "../lib/ast.mjs";
import { findMainModuleId } from "./lib/program.mjs";
import { findMetadataBlock, releaseVersion } from "./release.mjs";

/** The Prettier options of the output (those of the repository: printWidth 100). */
export const PRETTIER_OPTIONS = Object.freeze({ parser: "babel", printWidth: 100 });

const PARSE = { locations: false };
const SCOPE_OPTIONS = { ecmaVersion: 2022, sourceType: "script" };
const IDENTIFIER_NAME = /^[A-Za-z_$][\w$]*$/;
const IDENTIFIER_CHAR = /[\p{ID_Continue}$\\\u200c\u200d]/u;
const STATEMENT_LISTS = new Set([
  "Program.body",
  "BlockStatement.body",
  "StaticBlock.body",
  "SwitchCase.consequent",
]);

const isStringLiteral = (node) => node?.type === "Literal" && typeof node.value === "string";
const isNumberLiteral = (node) => node?.type === "Literal" && typeof node.value === "number";
const isFunction = (node) =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression";
/** `!0` / `!1` (any notation): the minifier's spelling of true / false. */
const isMinifiedBoolean = (node) =>
  node.type === "UnaryExpression" &&
  node.operator === "!" &&
  isNumberLiteral(node.argument) &&
  (node.argument.value === 0 || node.argument.value === 1);
const memberName = (node) =>
  !node.computed && node.property.type === "Identifier"
    ? node.property.name
    : isStringLiteral(node.property)
      ? node.property.value
      : null;
const isMethodCall = (node, name) =>
  node?.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  memberName(node.callee) === name;

/**
 * Iterative pre-order walk (no recursion, so any depth of AST works). `enter(node, parent)`
 * returning false skips the children of `node`.
 */
function traverse(root, enter) {
  const nodes = [root];
  const parents = [null];
  while (nodes.length) {
    const node = nodes.pop();
    const parent = parents.pop();
    if (enter(node, parent) === false) continue;
    const keys = childKeys(node);
    for (let k = keys.length - 1; k >= 0; k--) {
      const value = node[keys[k]];
      if (!Array.isArray(value)) {
        nodes.push(value);
        parents.push(node);
        continue;
      }
      for (let index = value.length - 1; index >= 0; index--) {
        if (!isNode(value[index])) continue;
        nodes.push(value[index]);
        parents.push(node);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Token-safe text edits
// ---------------------------------------------------------------------------
/** True when `left` immediately followed by `right` would read as one token (or a comment). */
function glues(left, right) {
  if (!left || !right) return false;
  if (IDENTIFIER_CHAR.test(left) && IDENTIFIER_CHAR.test(right)) return true;
  if ((left === "+" || left === "-") && left === right) return true;
  return left === "/" && (right === "/" || right === "*");
}

/**
 * Applies non-overlapping edits `{ start, end, text }` (offsets in `source`) and returns the new
 * text. A space is added where an edit (a removal included) would glue two tokens together. The
 * edits are applied from the end, so the right neighbour of each edit is already final; a left
 * neighbour that another edit replaces is checked by that edit (its right neighbour).
 */
export function applyEdits(source, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < sorted.length; index++) {
    const [previous, edit] = [sorted[index - 1], sorted[index]];
    if (edit.start < previous.end)
      throw new Error(
        `overlapping edits at ${previous.start}-${previous.end} and ${edit.start}-${edit.end}`,
      );
  }
  const pieces = [];
  let cursor = source.length;
  let following = ""; // first character of the text already placed after `cursor`
  for (let index = sorted.length - 1; index >= 0; index--) {
    const { start, end, text } = sorted[index];
    if (end < cursor) {
      pieces.push(source.slice(end, cursor));
      following = source[end];
    }
    const before = start > 0 ? source[start - 1] : "";
    let piece = text;
    if (piece === "") {
      if (glues(before, following)) piece = " ";
    } else {
      if (glues(before, piece[0])) piece = ` ${piece}`;
      if (glues(piece.at(-1), following)) piece = `${piece} `;
    }
    if (piece) {
      pieces.push(piece);
      following = piece[0];
    }
    cursor = start;
  }
  pieces.push(source.slice(0, cursor));
  return pieces.reverse().join("");
}

// ---------------------------------------------------------------------------
// The string array machinery
// ---------------------------------------------------------------------------
/** True when a decoder body decodes its strings (base64 / rc4 string array encodings). */
function decodesStrings(body) {
  let encoded = false;
  traverse(body, (node) => {
    if (
      (node.type === "Identifier" &&
        (node.name === "atob" || node.name === "decodeURIComponent")) ||
      (node.type === "MemberExpression" &&
        ["fromCharCode", "charCodeAt"].includes(memberName(node))) ||
      (isStringLiteral(node) && node.value.length >= 64 && /^[A-Za-z0-9+/=]+$/.test(node.value))
    )
      encoded = true;
    return !encoded;
  });
  return encoded;
}

/** The OFFSET of `i = i - OFFSET` (also `i -= OFFSET`, or `+` for a negative one), or null. */
function indexOffset(node) {
  if (node.type !== "AssignmentExpression" || node.left.type !== "Identifier") return null;
  const { operator, right } = node;
  if (
    operator === "=" &&
    right.type === "BinaryExpression" &&
    (right.operator === "-" || right.operator === "+") &&
    right.left.type === "Identifier" &&
    right.left.name === node.left.name &&
    isNumberLiteral(right.right)
  )
    return right.operator === "-" ? right.right.value : -right.right.value;
  if ((operator === "-=" || operator === "+=") && isNumberLiteral(right))
    return operator === "-=" ? right.value : -right.value;
  return null;
}

/**
 * Finds the string table, the decoder and the rotation of a parsed release. Throws a clear error
 * on any other layout.
 */
function locateMachinery(program) {
  const functions = new Map();
  for (const statement of program.body)
    if (statement.type === "FunctionDeclaration") functions.set(statement.id.name, statement);

  // The decoder: a top-level function that reads the table function and shifts its index.
  const candidates = [];
  for (const fn of functions.values()) {
    if (fn.params.length === 0) continue;
    let table = null;
    let offset = null;
    traverse(fn.body, (node) => {
      if (
        node.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        node.arguments.length === 0 &&
        functions.get(node.callee.name)?.params.length === 0
      )
        table = functions.get(node.callee.name);
      offset ??= indexOffset(node);
    });
    if (table && offset !== null) candidates.push({ decoder: fn, table, offset });
  }
  if (candidates.length !== 1)
    throw new Error(
      candidates.length === 0
        ? "string array decoder not found (no top-level function reads a string table function and shifts its index)"
        : `several string array decoder candidates: ${candidates.map((c) => c.decoder.id.name).join(", ")}`,
    );
  const [{ decoder, table, offset }] = candidates;
  if (decodesStrings(decoder.body))
    throw new Error(
      `the string array of ${decoder.id.name} is encoded (base64/rc4), which is not supported`,
    );

  let strings = null;
  traverse(table.body, (node) => {
    if (
      node.type === "ArrayExpression" &&
      node.elements.length > 0 &&
      node.elements.every(isStringLiteral) &&
      (!strings || node.elements.length > strings.length)
    )
      strings = node.elements.map((element) => element.value);
  });
  if (!strings) throw new Error(`the string table ${table.id.name} holds no array of strings`);

  // The rotation: (function (table, target) { … })(T, TARGET), evaluated at the top level.
  let rotation = null;
  traverse(program, (node, parent) => {
    if (rotation) return false;
    if (
      node.type === "CallExpression" &&
      isFunction(node.callee) &&
      node.arguments.length === 2 &&
      node.arguments[0].type === "Identifier" &&
      node.arguments[0].name === table.id.name &&
      isNumberLiteral(node.arguments[1])
    ) {
      rotation = { node, parent, target: node.arguments[1].value };
      return false;
    }
    return !isFunction(node);
  });
  if (rotation) {
    const targetName = rotation.node.callee.params[1]?.name;
    let rotates = false;
    let compares = false;
    traverse(rotation.node.callee.body, (node) => {
      if (
        !rotation.checksum &&
        node.type === "VariableDeclarator" &&
        node.init &&
        callsParseInt(node.init)
      )
        rotation.checksum = node.init;
      if (isMethodCall(node, "push") && isMethodCall(node.arguments[0], "shift")) rotates = true;
      if (
        node.type === "BinaryExpression" &&
        (node.operator === "===" || node.operator === "==") &&
        [node.left, node.right].some(
          (side) => side.type === "Identifier" && side.name === targetName,
        )
      )
        compares = true;
    });
    if (!rotation.checksum || !rotates || !compares)
      throw new Error(
        "unsupported string table rotation (expected a parseInt checksum compared with the target, and push(shift()))",
      );
    if (
      rotation.parent?.type !== "SequenceExpression" &&
      rotation.parent?.type !== "ExpressionStatement"
    )
      throw new Error(`unsupported place of the string table rotation (${rotation.parent?.type})`);
  }
  return { decoder, table, offset, strings, rotation };
}

function callsParseInt(root) {
  let found = false;
  traverse(root, (node) => {
    if (node.type === "CallExpression" && node.callee.type === "Identifier")
      found ||= node.callee.name === "parseInt";
    return !found;
  });
  return found;
}

/** Interprets the rotation checksum: numbers, decoder calls, parseInt and + - * / %. */
function evaluate(node, decode) {
  switch (node.type) {
    case "Literal":
      if (typeof node.value === "number" || typeof node.value === "string") return node.value;
      break;
    case "UnaryExpression":
      if (node.operator === "-") return -evaluate(node.argument, decode);
      if (node.operator === "+") return +evaluate(node.argument, decode);
      break;
    case "BinaryExpression": {
      const left = evaluate(node.left, decode);
      const right = evaluate(node.right, decode);
      switch (node.operator) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return left / right;
        case "%":
          return left % right;
      }
      break;
    }
    case "CallExpression":
      if (node.callee.type !== "Identifier") break;
      if (node.callee.name === "parseInt")
        return parseInt(
          evaluate(node.arguments[0], decode),
          node.arguments[1] ? evaluate(node.arguments[1], decode) : undefined,
        );
      if (isNumberLiteral(node.arguments[0])) return decode(node.arguments[0].value);
      break;
  }
  throw new Error(`unsupported ${node.operator ?? node.type} in the rotation checksum`);
}

/**
 * Returns the string table as the decoder sees it after the rotation: the first left rotation
 * whose checksum equals the target (the loop of the rotation IIFE, interpreted).
 */
function rotateStrings({ strings, offset, rotation }) {
  if (!rotation) return { table: strings, rotations: 0 };
  const count = strings.length;
  for (let rotations = 0; rotations < count; rotations++) {
    const read = (index) => {
      const position = index - offset;
      return Number.isInteger(position) && position >= 0 && position < count
        ? strings[(position + rotations) % count]
        : undefined;
    };
    if (evaluate(rotation.checksum, read) === rotation.target)
      return { table: [...strings.slice(rotations), ...strings.slice(0, rotations)], rotations };
  }
  throw new Error(`the string table rotation does not converge (${count} rotations tried)`);
}

// ---------------------------------------------------------------------------
// Pass 1: decoder calls -> strings, machinery and aliases removed
// ---------------------------------------------------------------------------
/**
 * Scans from `position` in `direction` (-1/+1) over whitespace (and over `skip` characters, such
 * as the parentheses around a node) to `char`, and returns its offset.
 */
function scanTo(source, position, direction, char, skip = "") {
  let index = position;
  while (
    index >= 0 &&
    index < source.length &&
    (/\s/.test(source[index]) || skip.includes(source[index]))
  )
    index += direction;
  if (source[index] !== char) throw new Error(`expected "${char}" at offset ${index}`);
  return index;
}

/** The comma between two expressions of a sequence and the parentheses on both of its sides. */
function separator(source, from, to) {
  let comma = -1;
  let closing = 0;
  let opening = 0;
  for (const token of tokenizer(source.slice(from, to), { ecmaVersion: "latest" })) {
    if (token.type === tokTypes.parenR && comma < 0) closing++;
    else if (token.type === tokTypes.comma && comma < 0) comma = from + token.start;
    else if (token.type === tokTypes.parenL && comma >= 0) opening++;
    else throw new Error(`unexpected "${token.type.label}" in a sequence at offset ${from}`);
  }
  if (comma < 0) throw new Error(`no comma between the expressions of a sequence at ${from}`);
  return { comma, closing, opening };
}

/** The edit removing expression `index` of a sequence, with its comma and own parentheses. */
function sequenceRemoval(source, sequence, index) {
  const expressions = sequence.expressions;
  const node = expressions[index];
  if (index < expressions.length - 1) {
    const { comma, closing } = separator(source, node.end, expressions[index + 1].start);
    let start = node.start;
    for (let count = 0; count < closing; count++) start = scanTo(source, start - 1, -1, "(");
    return { start, end: comma + 1, text: "" };
  }
  const { comma, opening } = separator(source, expressions[index - 1].end, node.start);
  let end = node.end;
  for (let count = 0; count < opening; count++) end = scanTo(source, end, 1, ")") + 1;
  return { start: comma, end, text: "" };
}

/** The edits removing the alias declarators of a declaration (all of it, or runs of them). */
function declaratorRemovals(declaration, parent, isAlias) {
  const declarators = declaration.declarations;
  if (declarators.every(isAlias)) {
    // A declaration that is a statement of a list (or a for-init) can vanish; elsewhere (the
    // body of an `if` without braces) it becomes an empty statement.
    const inList =
      ["Program", "BlockStatement", "StaticBlock", "SwitchCase"].includes(parent?.type) ||
      (parent?.type?.startsWith("For") && parent.body !== declaration);
    return [{ start: declaration.start, end: declaration.end, text: inList ? "" : ";" }];
  }
  const edits = [];
  for (let index = 0; index < declarators.length; ) {
    if (!isAlias(declarators[index])) {
      index++;
      continue;
    }
    let last = index;
    while (last + 1 < declarators.length && isAlias(declarators[last + 1])) last++;
    if (last + 1 < declarators.length)
      edits.push({ start: declarators[index].start, end: declarators[last + 1].start, text: "" });
    else edits.push({ start: declarators[index - 1].end, end: declarators[last].end, text: "" });
    index = last + 1;
  }
  return edits;
}

function decodeAndRemove(source, program, machinery, table) {
  const { decoder, rotation, offset } = machinery;
  const machineryNodes = [decoder, machinery.table, rotation?.node].filter(Boolean);
  const inMachinery = (node) =>
    machineryNodes.some((item) => node.start >= item.start && node.end <= item.end);

  const scopeManager = analyze(program, SCOPE_OPTIONS);
  const resolved = new Map(); // Identifier -> Variable
  for (const scope of scopeManager.scopes)
    for (const reference of scope.references)
      if (reference.resolved) resolved.set(reference.identifier, reference.resolved);

  // Aliases: `const x = D` and, transitively, `const y = x`.
  const derived = new Map(); // Variable -> Variables declared as `const v = Variable`
  for (const scope of scopeManager.scopes)
    for (const variable of scope.variables) {
      const [def] = variable.defs;
      if (variable.defs.length !== 1 || def.type !== "Variable") continue;
      if (def.node.id.type !== "Identifier" || def.node.init?.type !== "Identifier") continue;
      const target = resolved.get(def.node.init);
      if (!target) continue;
      if (!derived.has(target)) derived.set(target, []);
      derived.get(target).push(variable);
    }
  const decoderVariable = scopeManager.globalScope.set.get(decoder.id.name);
  const aliases = new Set([decoderVariable]);
  for (const queue = [decoderVariable]; queue.length; )
    for (const variable of derived.get(queue.pop()) ?? [])
      if (!aliases.has(variable)) {
        aliases.add(variable);
        queue.push(variable);
      }
  const aliasDeclarators = new Set();
  for (const variable of aliases) {
    if (variable === decoderVariable) continue;
    const declarator = variable.defs[0].node;
    aliasDeclarators.add(declarator);
    const writes = variable.references.filter(
      (reference) => reference.isWrite() && reference.identifier !== declarator.id,
    );
    if (writes.length)
      throw new Error(
        `the decoder alias ${variable.name} is reassigned at ${writes[0].identifier.start}`,
      );
  }

  const decode = (index) => {
    const value = table[index - offset];
    if (typeof value !== "string")
      throw new Error(`decoder call with index ${index}, outside the string table`);
    return value;
  };

  const calls = []; // edits: decoder call -> its string
  const removals = []; // edits: alias declarators and the machinery
  const decodedCalls = new Map(); // CallExpression -> string
  const handled = new Set(); // alias references that the edits take care of
  traverse(program, (node, parent) => {
    if (machineryNodes.includes(node)) return false;
    if (
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      aliases.has(resolved.get(node.callee))
    ) {
      // The second argument (the rc4 key of other layouts) is unused here; it must be inert.
      const [index, key] = node.arguments;
      if (!isNumberLiteral(index) || node.arguments.length > 2 || (key && key.type !== "Literal"))
        throw new Error(
          `unsupported decoder call at offset ${node.start}: ${source.slice(node.start, node.end)}`,
        );
      const value = decode(index.value);
      decodedCalls.set(node, value);
      handled.add(node.callee);
      calls.push({ start: node.start, end: node.end, text: JSON.stringify(value) });
      return false;
    }
    if (
      node.type === "VariableDeclaration" &&
      node.declarations.some((declarator) => aliasDeclarators.has(declarator))
    ) {
      for (const declarator of node.declarations)
        if (aliasDeclarators.has(declarator)) handled.add(declarator.init);
      removals.push(
        ...declaratorRemovals(node, parent, (declarator) => aliasDeclarators.has(declarator)),
      );
    }
  });

  // Any other use of an alias (or of the table) would be left dangling by the removal.
  const tableVariable = scopeManager.globalScope.set.get(machinery.table.id.name);
  for (const variable of [...aliases, tableVariable])
    for (const { identifier } of variable.references) {
      if (handled.has(identifier) || inMachinery(identifier)) continue;
      if (aliasDeclarators.has(variable.defs[0].node) && identifier === variable.defs[0].node.id)
        continue; // the initialization of the alias itself
      throw new Error(
        `${variable.name} is used at offset ${identifier.start} in a way this deobfuscator cannot remove`,
      );
    }

  for (const fn of [machinery.table, decoder])
    removals.push({ start: fn.start, end: fn.end, text: "" });
  if (rotation) {
    if (rotation.parent.type === "ExpressionStatement")
      removals.push({ start: rotation.parent.start, end: rotation.parent.end, text: "" });
    else {
      const index = rotation.parent.expressions.indexOf(rotation.node);
      removals.push(sequenceRemoval(source, rotation.parent, index));
    }
  }
  return {
    edits: [...calls, ...removals],
    decodedCalls,
    removed: new Set([...machineryNodes, ...aliasDeclarators]),
    stats: {
      decoderCalls: calls.length,
      aliases: [...aliasDeclarators].filter((declarator) => !inMachinery(declarator)).length,
      removals: removals.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Pass 2: literals and members
// ---------------------------------------------------------------------------
function rewriteLiterals(source, program) {
  const edits = [];
  const kinds = { booleans: 0, numbers: 0, strings: 0, members: 0 };
  const skip = new Set();
  traverse(program, (node, parent) => {
    if (skip.has(node)) return false;
    if (isMinifiedBoolean(node)) {
      edits.push({ start: node.start, end: node.end, text: String(node.argument.value === 0) });
      kinds.booleans++;
      return false;
    }
    if (isNumberLiteral(node) && /^0x/i.test(node.raw)) {
      // `0x1.toFixed()` is valid, `1.toFixed()` is not.
      const text = String(node.value);
      edits.push({
        start: node.start,
        end: node.end,
        text: source[node.end] === "." ? `(${text})` : text,
      });
      kinds.numbers++;
      return false;
    }
    // A statement-level string is left alone: unescaping it could create a directive.
    if (
      isStringLiteral(node) &&
      /\\[xu]/.test(node.raw) &&
      parent?.type !== "ExpressionStatement"
    ) {
      edits.push({ start: node.start, end: node.end, text: JSON.stringify(node.value) });
      kinds.strings++;
      return false;
    }
    if (
      node.type === "MemberExpression" &&
      node.computed &&
      isStringLiteral(node.property) &&
      IDENTIFIER_NAME.test(node.property.value) &&
      !isNumberLiteral(node.object)
    ) {
      // `[`, possibly followed by parentheses around the property (`a[("b")]`).
      let start = scanTo(source, node.property.start - 1, -1, "[", "(");
      if (node.optional) {
        start = scanTo(source, start - 1, -1, ".") - 1;
        if (source[start] !== "?") throw new Error(`expected "?." at offset ${start}`);
      }
      edits.push({
        start,
        end: node.end,
        text: `${node.optional ? "?." : "."}${node.property.value}`,
      });
      skip.add(node.property);
      kinds.members++;
    }
  });
  return { edits, kinds };
}

// ---------------------------------------------------------------------------
// Self-check
// ---------------------------------------------------------------------------
/** The node as the comparison sees it: decoded strings, `!0`, `a["b"]` and removals resolved. */
function canonical(node, side) {
  for (;;) {
    if (side.decodedCalls?.has(node))
      return { type: "Literal", value: side.decodedCalls.get(node), start: node.start };
    if (isMinifiedBoolean(node))
      return { type: "Literal", value: node.argument.value === 0, start: node.start };
    if (node.type === "SequenceExpression") {
      const kept = node.expressions.filter((expression) => !side.removed?.has(expression));
      if (kept.length === 1) {
        node = kept[0];
        continue;
      }
      return kept.length === node.expressions.length ? node : { ...node, expressions: kept };
    }
    if (node.type === "VariableDeclaration") {
      const kept = node.declarations.filter((declarator) => !side.removed?.has(declarator));
      return kept.length === node.declarations.length ? node : { ...node, declarations: kept };
    }
    if (node.type === "MemberExpression" && node.computed) {
      const property = canonical(node.property, side);
      if (
        isStringLiteral(property) &&
        IDENTIFIER_NAME.test(property.value) &&
        !isNumberLiteral(node.object)
      )
        return {
          ...node,
          computed: false,
          property: { type: "Identifier", name: property.value, start: node.property.start },
        };
    }
    return node;
  }
}

const isGone = (node, side) =>
  side.removed?.has(node) ||
  (node.type === "VariableDeclaration" && canonical(node, side).declarations.length === 0) ||
  (node.type === "ExpressionStatement" && side.removed?.has(node.expression));

function canonicalList(list, side, statements) {
  return list.filter(
    (item) =>
      item === null || !(isGone(item, side) || (statements && item.type === "EmptyStatement")),
  );
}

const keyName = (key) =>
  key.type === "Identifier"
    ? key.name
    : key.type === "Literal"
      ? String(key.value)
      : `#${key.name}`;

/**
 * Compares the input program (decoder calls read as their strings, machinery left out) with the
 * deobfuscated output, ignoring what the rewrites and Prettier change on purpose: `!0`, literal
 * notation, `a["b"]` / `a.b`, quoted property keys, empty statements and parentheses. Throws on
 * the first other difference.
 */
function verifyDeobfuscation(input, output, { decodedCalls, removed }, code = "") {
  const inputSide = { decodedCalls, removed };
  const outputSide = {};
  const fail = (a, b, detail) => {
    const line = code ? code.slice(0, b?.start ?? 0).split("\n").length : "?";
    throw new Error(
      `self-check failed: the output differs from the decoded input at input offset ${a?.start} / output line ${line}: ${detail}`,
    );
  };
  const stack = [input, output];
  while (stack.length) {
    const right = stack.pop();
    const left = stack.pop();
    if (left === null || right === null) {
      if (left !== right)
        fail(left, right, `${left?.type ?? "nothing"} vs ${right?.type ?? "nothing"}`);
      continue;
    }
    const a = canonical(left, inputSide);
    const b = canonical(right, outputSide);
    if (a.type !== b.type) fail(a, b, `${a.type} vs ${b.type}`);
    if (a.type === "Literal") {
      const same =
        a.regex || b.regex
          ? a.regex?.pattern === b.regex?.pattern && a.regex?.flags === b.regex?.flags
          : Object.is(a.value, b.value);
      if (!same) fail(a, b, `${String(a.value)} vs ${String(b.value)}`);
      continue;
    }
    if (a.type === "TemplateElement") {
      if (a.value.raw !== b.value.raw || a.value.cooked !== b.value.cooked)
        fail(
          a,
          b,
          `template text ${JSON.stringify(a.value.raw)} vs ${JSON.stringify(b.value.raw)}`,
        );
      continue;
    }
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (["type", "start", "end", "range", "loc", "raw", "directive"].includes(key)) continue;
      const x = a[key];
      const y = b[key];
      if (
        key === "key" &&
        !a.computed &&
        ["Property", "MethodDefinition", "PropertyDefinition"].includes(a.type)
      ) {
        if (keyName(x) !== keyName(y)) fail(a, b, `key ${keyName(x)} vs ${keyName(y)}`);
      } else if (Array.isArray(x) || Array.isArray(y)) {
        const statements = STATEMENT_LISTS.has(`${a.type}.${key}`);
        const xs = canonicalList(x ?? [], inputSide, statements);
        const ys = canonicalList(y ?? [], outputSide, statements);
        if (xs.length !== ys.length)
          fail(a, b, `${a.type}.${key}: ${xs.length} vs ${ys.length} items`);
        for (let index = 0; index < xs.length; index++) stack.push(xs[index], ys[index]);
      } else if (isNode(x) || isNode(y)) {
        stack.push(x && !isGone(x, inputSide) ? x : null, y && !isGone(y, outputSide) ? y : null);
      } else if (x !== y) fail(a, b, `${a.type}.${key}: ${String(x)} vs ${String(y)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
/** Parses the input (stage null) or an intermediate result, which then goes with the error. */
function parseStage(code, stage) {
  try {
    return parseScript(code, PARSE);
  } catch (error) {
    if (!stage)
      throw new Error(`the input is not valid JavaScript: ${error.message}`, { cause: error });
    const failure = new Error(`deobfuscation produced invalid code ${stage}: ${error.message}`, {
      cause: error,
    });
    failure.partialCode = code;
    throw failure;
  }
}

/** Formats code like the output of the deobfuscator (Prettier, PRETTIER_OPTIONS). */
export function formatCode(code) {
  return prettier.format(code, PRETTIER_OPTIONS);
}

/** Puts the metadata block of `source` back verbatim if formatting touched it. */
function keepMetadataBlock(source, code) {
  const original = findMetadataBlock(source);
  if (!original) return code;
  const formatted = findMetadataBlock(code);
  if (!formatted) throw new Error("formatting lost the ==UserScript== block");
  if (formatted.start === 0 && formatted.text === original.text && original.start === 0)
    return code;
  return source.slice(0, original.end) + code.slice(formatted.end);
}

/**
 * Deobfuscates a Paletools release (minified or formatted). Returns:
 *   code          the deobfuscated userscript, formatted by Prettier (PRETTIER_OPTIONS), with the
 *                 metadata block of the input kept verbatim at the top;
 *   mainModuleId  id of the webpack module holding Paletools (the largest), or null;
 *   version       @version of the metadata block, or null;
 *   stats         { strings, offset, rotations, decoderCalls, aliases, removals, rewrites,
 *                   rewriteKinds: { booleans, numbers, strings, members }, verified }.
 * Options: `verify: false` skips the self-check (verifyDeobfuscation); `format(code)` replaces the
 * formatter (default: Prettier with PRETTIER_OPTIONS; the self-check also covers its output).
 */
export async function deobfuscate(source, { verify = true, format = formatCode } = {}) {
  const program = parseStage(source, null);
  const machinery = locateMachinery(program);
  const { table, rotations } = rotateStrings(machinery);
  const pass1 = decodeAndRemove(source, program, machinery, table);
  const decoded = applyEdits(source, pass1.edits);
  const pass2 = rewriteLiterals(decoded, parseStage(decoded, "after decoding the strings"));
  const plain = applyEdits(decoded, pass2.edits);
  parseStage(plain, "after rewriting the literals");
  const code = keepMetadataBlock(source, await format(plain));
  const output = parseStage(code, "after formatting");
  if (verify) verifyDeobfuscation(program, output, pass1, code);
  let version = null;
  try {
    version = releaseVersion(source);
  } catch {
    // No metadata block or no @version (e.g. a test fixture).
  }
  return {
    code,
    mainModuleId: findMainModuleId(output),
    version,
    stats: {
      strings: machinery.strings.length,
      offset: machinery.offset,
      rotations,
      ...pass1.stats,
      rewrites: pass2.edits.length,
      rewriteKinds: pass2.kinds,
      verified: verify,
    },
  };
}

async function main(argv) {
  const verify = !argv.includes("--no-verify");
  const [input, output, ...extra] = argv.filter((argument) => argument !== "--no-verify");
  if (!input || !output || extra.length) {
    console.error("usage: deobfuscate.mjs <release.user.js> <output.js> [--no-verify]");
    process.exit(2);
  }
  const started = performance.now();
  let result;
  try {
    result = await deobfuscate(fs.readFileSync(input, "utf8"), { verify });
  } catch (error) {
    if (error.partialCode) {
      fs.writeFileSync(`${output}.broken.js`, error.partialCode);
      console.error(`the invalid intermediate code was written to ${output}.broken.js`);
    }
    throw error;
  }
  fs.writeFileSync(output, result.code);
  const { stats } = result;
  console.error(
    `Paletools ${result.version ?? "(no @version)"}, main module ${result.mainModuleId}: ` +
      `${stats.strings} strings (offset ${stats.offset}, rotated ${stats.rotations}), ` +
      `${stats.decoderCalls} decoder calls replaced, ${stats.aliases} aliases, ` +
      `${stats.removals} removals, ${stats.rewrites} rewrites` +
      (stats.verified ? ", self-check passed" : ", self-check skipped"),
  );
  console.error(
    `wrote ${output} (${result.code.split("\n").length - 1} lines) in ${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
