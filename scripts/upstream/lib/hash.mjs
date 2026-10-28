// Structural fingerprints ("digests") of AST nodes, insensitive to the names of local bindings.
//
// Two nodes with the same digest have the same shape: same node types, operators, property names,
// literals, global names and private-member *structure*. Bound identifiers do not contribute their
// name: a local binding is the token `#`, and a top-level binding of the main module is either `#`
// (coarse digests) or the canonical id given by `topIdentity` (refined digests), so that renamed
// code still matches while calling a different top-level function does not. Private names are the
// token `#P` (javascript-obfuscator renames them per release).
//
// Digests are 64-bit (two 32-bit FNV-style lanes) written in base 36: collisions are negligible at
// the ~10^6 nodes of a userscript.
import { isNode } from "../../lib/ast.mjs";

/** Fields that never change the meaning of a node. */
const IGNORED = new Set([
  "type",
  "start",
  "end",
  "loc",
  "range",
  "raw",
  "shorthand",
  "extra",
  "leadingComments",
  "trailingComments",
  "comments",
]);

function hashText(text) {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x5bd1e995);
    b ^= b >>> 13;
  }
  a ^= a >>> 16;
  b ^= b >>> 15;
  return (a >>> 0).toString(36) + "." + (b >>> 0).toString(36);
}

/** The sorted child keys and scalar fields of a node (cached per shape). */
const shapeCache = new Map();
function shapeOf(node) {
  const signature = Object.keys(node).join(",");
  const cacheKey = `${node.type}|${signature}`;
  let shape = shapeCache.get(cacheKey);
  if (!shape) {
    const keys = Object.keys(node)
      .filter((key) => !IGNORED.has(key))
      .sort();
    shape = keys;
    shapeCache.set(cacheKey, shape);
  }
  return shape;
}

/**
 * Creates a digest function for the nodes of one prepared side (see program.mjs).
 *   topIdentity(variable) -> string | null: the canonical id of a top-level binding for refined
 *   digests; null (or no function) makes it the anonymous token `#`.
 *   declarationsAnonymous: when true, the declaring occurrence of a top-level binding (its name
 *   in a function/class/variable declaration) is `#` unless declarationIdentity(variable) gives
 *   it an id, so that a declaration can match its counterpart before the two names are known to
 *   correspond.
 */
export function createDigester(
  side,
  { topIdentity = null, declarationsAnonymous = true, declarationIdentity = null } = {},
) {
  const memo = new WeakMap();
  const declaring = new Set();
  if (declarationsAnonymous)
    for (const variable of side.topVariables)
      for (const identifier of variable.identifiers) declaring.add(identifier);

  function identifierToken(node) {
    const binding = side.bindings.get(node);
    if (binding === undefined) return `.${node.name}`;
    if (binding === "global") return `G:${node.name}`;
    if (topIdentity && side.topVariables.has(binding)) {
      // A declaration is anonymous unless its binding is known to correspond (see
      // `declarationIdentity`), so that it can pair with its counterpart first.
      const id = declaring.has(node) ? declarationIdentity?.(binding) : topIdentity(binding);
      if (id !== null && id !== undefined) return `T:${id}`;
    }
    return "#";
  }

  function digest(node) {
    if (node === null || node === undefined) return "0";
    const cached = memo.get(node);
    if (cached !== undefined) return cached;
    let text;
    switch (node.type) {
      case "Identifier":
        text = identifierToken(node);
        break;
      case "PrivateIdentifier":
        text = "#P";
        break;
      case "Literal":
        text = node.regex
          ? `R:/${node.regex.pattern}/${node.regex.flags}`
          : node.bigint !== undefined
            ? `N:${node.bigint}`
            : `L:${typeof node.value}:${JSON.stringify(node.value)}`;
        break;
      case "TemplateElement":
        text = `E:${node.tail}:${JSON.stringify(node.value.cooked)}:${JSON.stringify(node.value.raw)}`;
        break;
      case "TemplateLiteral":
        // A template without substitutions is the same string as a string literal.
        if (node.expressions.length === 0) {
          text = `L:string:${JSON.stringify(node.quasis[0].value.cooked)}`;
          break;
        }
        text = defaultText(node);
        break;
      case "UnaryExpression":
        // `void 0` and the global `undefined` are the same value.
        text =
          node.operator === "void" && node.argument.type === "Literal"
            ? "G:undefined"
            : defaultText(node);
        break;
      default:
        text = defaultText(node);
    }
    const result = text.length <= 24 ? text : hashText(text);
    memo.set(node, result);
    return result;
  }

  function defaultText(node) {
    const parts = [node.type];
    for (const key of shapeOf(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        parts.push(`${key}[${value.map((item) => (isNode(item) ? digest(item) : "_")).join(",")}]`);
      } else if (isNode(value)) {
        parts.push(`${key}=${digest(value)}`);
      } else if (key === "expression" && typeof value === "boolean") {
        // `expression: true` of concise arrows: the normalizer rewrites some of them.
      } else if (value !== undefined && value !== null && typeof value !== "object") {
        parts.push(`${key}:${value}`);
      }
    }
    return parts.join("|");
  }
  return digest;
}

/**
 * The "words" of a node, for similarity: property names, global names, literals and template
 * texts it contains (strings truncated). Two versions of an edited function share most words.
 */
export function wordsOf(node, side, limit = 4000) {
  const words = new Set();
  const stack = [node];
  while (stack.length && words.size < limit) {
    const current = stack.pop();
    if (!isNode(current)) continue;
    switch (current.type) {
      case "Identifier": {
        const binding = side.bindings.get(current);
        if (binding === undefined) words.add(`.${current.name}`);
        else if (binding === "global") words.add(`G:${current.name}`);
        continue;
      }
      case "Literal":
        if (typeof current.value === "string") words.add(`L:${current.value.slice(0, 60)}`);
        else if (current.value !== null && typeof current.value !== "object")
          words.add(`L:${current.value}`);
        continue;
      case "TemplateElement":
        words.add(`T:${(current.value.cooked ?? "").slice(0, 60)}`);
        continue;
      default:
        break;
    }
    for (const key of Object.keys(current)) {
      if (IGNORED.has(key) && key !== "value") continue;
      const value = current[key];
      if (Array.isArray(value)) for (const item of value) stack.push(item);
      else if (isNode(value)) stack.push(value);
    }
  }
  return words;
}

/** Jaccard similarity of two word sets. */
export function similarity(wordsA, wordsB) {
  if (!wordsA.size && !wordsB.size) return 1;
  let common = 0;
  const [small, large] = wordsA.size <= wordsB.size ? [wordsA, wordsB] : [wordsB, wordsA];
  for (const word of small) if (large.has(word)) common++;
  return common / (wordsA.size + wordsB.size - common);
}
