// Turns the operations of a merge plan (merge.mjs) into text.
//
// The operations are first applied to an overlay of the target's AST (`Overlay`: replaced nodes,
// changed children and lists, without touching the AST itself). The renderer then writes a node:
//   * unchanged target nodes are copied from the target text (with their comments and layout);
//   * changed target nodes are patched: their text with the changed children rewritten, elements
//     inserted or removed in place ("patch mode"); when that is not possible (a node created by
//     the normalization, a child that appears or disappears) the node is printed with astring,
//     its unchanged children still copied;
//   * nodes of the other side are printed with astring from their normalized AST (so minifier
//     idioms come out as plain statements), with their bindings renamed to the target's names.
// Where the text of a node lives is given by `locate(node)` (the target text for a whole
// userscript; the module files of src/ for the build, see apply-src.mjs). Inlined constants (see
// program.mjs) are written where they are declared when they are read once, else where read.
import { GENERATOR, generate } from "astring";
import { childKeys, isNode } from "../../lib/ast.mjs";
import { INLINED_FROM, isPureLiteral, isScalar, ORIGIN, RAW, USE_SITE } from "./program.mjs";

/** Parent links of every node of a prepared side (normalized, inlined). */
export function indexParents(side) {
  if (side.parents) return side.parents;
  const parents = new WeakMap();
  const stack = [[side.program, null, null, null]];
  while (stack.length) {
    const [node, parent, key, index] = stack.pop();
    parents.set(node, { parent, key, index });
    for (const childKey of childKeys(node)) {
      const value = node[childKey];
      if (Array.isArray(value))
        value.forEach(
          (item, position) => isNode(item) && stack.push([item, node, childKey, position]),
        );
      else if (isNode(value)) stack.push([value, node, childKey, null]);
    }
  }
  side.parents = parents;
  return parents;
}

/** The operations of a plan, applied to a view of the target AST. */
export class Overlay {
  constructor(target) {
    this.target = target;
    this.parents = indexParents(target);
    this.replaced = new Map(); // node -> replacement node (or null for "removed child")
    this.children = new Map(); // node -> Map(key -> new value)
    this.dirty = new Set(); // nodes with a change in their subtree (or themselves)
    this.inserted = new Set(); // nodes inserted into a list (other side's, or moved target nodes)
    this.removedFrom = new Map(); // removed node -> { parent, key }
  }
  markDirty(node) {
    for (let current = node; current; current = this.parents.get(current)?.parent) {
      if (this.dirty.has(current) && current !== node) break;
      this.dirty.add(current);
    }
  }
  value(node, key) {
    const changes = this.children.get(node);
    return changes?.has(key) ? changes.get(key) : node[key];
  }
  setValue(node, key, value) {
    if (!this.children.has(node)) this.children.set(node, new Map());
    this.children.get(node).set(key, value);
    this.markDirty(node);
  }
  effective(node) {
    let current = node;
    const seen = new Set();
    while (current && this.replaced.has(current) && !seen.has(current)) {
      seen.add(current);
      current = this.replaced.get(current);
    }
    return current;
  }
  insertInto(parent, key, nodes, { after, before, placement }) {
    const list = [...this.value(parent, key)];
    let index;
    const afterIndex = after ? list.indexOf(after) : -1;
    const beforeIndex = before ? list.indexOf(before) : -1;
    if (placement === "afterLeft" && (after === null || afterIndex >= 0)) {
      index = afterIndex + 1;
      while (index < list.length && this.inserted.has(list[index])) index++;
    } else if (placement !== "afterLeft" && before === null) index = list.length;
    else if (before !== null && beforeIndex >= 0) index = beforeIndex;
    else if (after !== null && afterIndex >= 0) {
      index = afterIndex + 1;
      while (index < list.length && this.inserted.has(list[index])) index++;
    } else index = before === null ? list.length : 0;
    list.splice(index, 0, ...nodes);
    for (const node of nodes) this.inserted.add(node);
    this.setValue(parent, key, list);
  }
  apply(operation) {
    switch (operation.op) {
      case "replace":
        this.replaced.set(operation.node, operation.with);
        this.markDirty(operation.node);
        break;
      case "setChild":
        this.setValue(operation.node, operation.key, operation.value);
        break;
      case "remove": {
        const list = this.value(operation.parent, operation.key).filter(
          (item) => item !== operation.node,
        );
        this.removedFrom.set(operation.node, { parent: operation.parent, key: operation.key });
        this.setValue(operation.parent, operation.key, list);
        break;
      }
      case "insert":
        this.insertInto(operation.parent, operation.key, operation.nodes, operation);
        break;
      case "move": {
        const list = this.value(operation.parent, operation.key).filter(
          (item) => item !== operation.node,
        );
        this.setValue(operation.parent, operation.key, list);
        this.insertInto(operation.parent, operation.key, [operation.node], operation);
        break;
      }
      default:
        throw new Error(`unknown operation ${operation.op}`);
    }
  }
  isChanged(node) {
    return this.dirty.has(node) || this.replaced.has(node);
  }
}

/** Lists whose elements are statements (one per line) rather than comma separated. */
const STATEMENT_LISTS = new Set([
  "Program.body",
  "BlockStatement.body",
  "StaticBlock.body",
  "ClassBody.body",
  "SwitchCase.consequent",
  "SwitchStatement.cases",
]);
const isStatementList = (parent, key) => STATEMENT_LISTS.has(`${parent.type}.${key}`);

/** Slots where any expression but a sequence may stand without parentheses. */
const FREE_SLOTS = new Set([
  "ExpressionStatement.expression",
  "VariableDeclarator.init",
  "ReturnStatement.argument",
  "ThrowStatement.argument",
  "IfStatement.test",
  "WhileStatement.test",
  "DoWhileStatement.test",
  "ForStatement.init",
  "ForStatement.test",
  "ForStatement.update",
  "SwitchStatement.discriminant",
  "SwitchCase.test",
  "Property.value",
  "PropertyDefinition.value",
  "ArrayExpression.elements",
  "CallExpression.arguments",
  "NewExpression.arguments",
  "TemplateLiteral.expressions",
  "AssignmentExpression.right",
  "SpreadElement.argument",
  "SequenceExpression.expressions",
  "ArrowFunctionExpression.body",
  "ForOfStatement.right",
  "ForInStatement.right",
]);
const ATOMS = new Set([
  "Identifier",
  "Literal",
  "ThisExpression",
  "Super",
  "ArrayExpression",
  "TemplateLiteral",
  "TaggedTemplateExpression",
  "MemberExpression",
  "CallExpression",
  "PrivateIdentifier",
]);
const STARTS_AMBIGUOUS = new Set(["ObjectExpression", "FunctionExpression", "ClassExpression"]);

function needsParentheses(node, parent, key) {
  if (!parent || !node) return false;
  const slot = `${parent.type}.${key}`;
  // also a callee, a member object, an operand... (the general rule below).
  if (
    STARTS_AMBIGUOUS.has(node.type) &&
    (slot === "ExpressionStatement.expression" || slot === "ArrowFunctionExpression.body")
  )
    return true;
  if (node.type === "SequenceExpression")
    return slot !== "ExpressionStatement.expression" && slot !== "ForStatement.update";
  if (FREE_SLOTS.has(slot)) return false;
  if (ATOMS.has(node.type)) return false;
  if (!/Expression$|^Literal$|Pattern$/.test(node.type)) return false;
  // Patterns and identifiers on the left of an assignment never need them.
  if (/Pattern$/.test(node.type)) return false;
  return true;
}

/**
 * Creates a renderer for one target.
 *   target: the side whose text is produced; other: the side the inserted nodes come from.
 *   overlay: the plan applied (Overlay).
 *   locate(node) -> { file, text, start, end } | null: where the node's own text is (target
 *     nodes only, after following ORIGIN for inlined copies; null when the node has no text of
 *     its own, e.g. a node created by the normalization).
 *   rename(identifierNode) -> string | null: the target name of an other-side identifier.
 *   renamePrivate(privateIdentifierNode) -> string | null: likewise for #private names.
 * Inlined constants read once (`target.inlined`) are changed where they are declared: call
 * `remoteEdits()` before rendering; it returns [{ node (the copy), location (of the declared
 * initializer), text, replacement (the new initializer node when it was replaced whole) }] and
 * makes `render` write the reads unchanged.
 */
export function createRenderer({
  target,
  other,
  overlay,
  locate,
  rename,
  renamePrivate,
  constantFor = () => null,
  ownCode = () => false,
}) {
  const otherNodes = new WeakSet();
  {
    const stack = [other.program];
    while (stack.length) {
      const node = stack.pop();
      otherNodes.add(node);
      for (const key of childKeys(node)) {
        const value = node[key];
        if (Array.isArray(value)) for (const item of value) isNode(item) && stack.push(item);
        else if (isNode(value)) stack.push(value);
      }
    }
  }
  const isOther = (node) => otherNodes.has(node);
  const stats = { patched: 0, printed: 0, foreign: 0 };
  const remote = new Set(); // inlined copies changed at their declaration

  // a shallow copy whose id carries the target name.
  const renamedId = (node) =>
    node.id ? { ...node, id: { ...node.id, name: rename(node.id) ?? node.id.name } } : node;
  /** astring generator printing other-side nodes with target names. */
  const foreignGenerator = Object.assign(Object.create(GENERATOR), {
    // An inlined constant whose value the other side changed: the merged program's value.
    ...Object.fromEntries(
      ["Literal", "TemplateLiteral", "UnaryExpression", "ObjectExpression", "ArrayExpression"].map(
        (type) => [
          type,
          function (node, state) {
            const replacement = constantFor(node);
            if (replacement && replacement !== node)
              return this[replacement.type](replacement, state);
            return GENERATOR[type].call(this, node, state);
          },
        ],
      ),
    ),
    // astring prints cases and catch clauses inline (no SwitchCase/CatchClause
    // generator): give them their own, so that they can be printed alone and so that
    // printComposed routes them through render() (which reads the overlay).
    SwitchStatement(node, state) {
      state.write("switch (");
      this[node.discriminant.type](node.discriminant, state);
      state.write(") {\n");
      for (const item of node.cases) {
        this.SwitchCase(item, state);
        state.write("\n");
      }
      state.write("}");
    },
    SwitchCase(node, state) {
      if (node.test) {
        state.write("case ");
        this[node.test.type](node.test, state);
        state.write(":");
      } else state.write("default:");
      for (const statement of node.consequent) {
        state.write("\n");
        this[statement.type](statement, state);
      }
    },
    TryStatement(node, state) {
      state.write("try ");
      this[node.block.type](node.block, state);
      if (node.handler) {
        state.write(" ");
        this.CatchClause(node.handler, state);
      }
      if (node.finalizer) {
        state.write(" finally ");
        this[node.finalizer.type](node.finalizer, state);
      }
    },
    CatchClause(node, state) {
      state.write("catch ");
      if (node.param) {
        state.write("(");
        this[node.param.type](node.param, state);
        state.write(") ");
      }
      this[node.body.type](node.body, state);
    },
    // astring writes these binding names itself (`node.id.name`, the lone arrow
    // parameter's `name`), bypassing `Identifier`: rename them here.
    FunctionDeclaration(node, state) {
      GENERATOR.FunctionDeclaration.call(this, renamedId(node), state);
    },
    FunctionExpression(node, state) {
      GENERATOR.FunctionExpression.call(this, renamedId(node), state);
    },
    ClassDeclaration(node, state) {
      GENERATOR.ClassDeclaration.call(this, renamedId(node), state);
    },
    ArrowFunctionExpression(node, state) {
      if (node.params.length !== 1 || node.params[0].type !== "Identifier")
        return GENERATOR.ArrowFunctionExpression.call(this, node, state);
      state.write(node.async ? "async (" : "(", node);
      this[node.params[0].type](node.params[0], state);
      state.write(") => ");
      if (node.body.type === "ObjectExpression") {
        state.write("(");
        this.ObjectExpression(node.body, state);
        state.write(")");
      } else this[node.body.type](node.body, state);
    },
    Identifier(node, state) {
      state.write(rename(node) ?? node.name, node);
    },
    PrivateIdentifier(node, state) {
      state.write(`#${renamePrivate?.(node) ?? node.name}`, node);
    },
    Property(node, state) {
      if (node.shorthand && !node.computed && node.key.type === "Identifier") {
        const valueName =
          node.value.type === "Identifier"
            ? (rename(node.value) ?? node.value.name)
            : node.value.type === "AssignmentPattern" && node.value.left.type === "Identifier"
              ? (rename(node.value.left) ?? node.value.left.name)
              : node.key.name;
        if (valueName !== node.key.name) {
          state.write(`${node.key.name}: `);
          this[node.value.type](node.value, state);
          return;
        }
      }
      GENERATOR.Property.call(this, node, state);
    },
  });

  function printForeign(node) {
    stats.foreign++;
    return generate(node, { generator: foreignGenerator, indent: "  " });
  }

  // Remote edits applied while copying text (whole-userscript targets, where the declaration of
  // an inlined constant is in the text being written).
  const inlineRemote = [];
  function copySpan(text, start, end) {
    const inside = inlineRemote.filter(
      (edit) =>
        edit.location.text === text && edit.location.start >= start && edit.location.end <= end,
    );
    if (!inside.length) return text.slice(start, end);
    inside.sort((a, b) => a.location.start - b.location.start);
    let result = "";
    let position = start;
    for (const edit of inside) {
      if (edit.location.start < position) continue;
      result += text.slice(position, edit.location.start) + edit.text;
      position = edit.location.end;
    }
    return result + text.slice(position, end);
  }

  const isInlinedCopy = (node) => Boolean(node[USE_SITE] && node[INLINED_FROM]);
  const readOnce = (node) => target.inlined?.get(node[INLINED_FROM])?.references === 1;
  const changed = (node) => overlay.isChanged(node) || overlay.replaced.has(node);

  /** Where a child is written in its parent's text: an inlined copy is written where read. */
  const locateInParent = (child) =>
    isInlinedCopy(child) ? locate(child[USE_SITE]) : locate(child);

  function remoteEdits({ applyWhileCopying = false } = {}) {
    const edits = applyWhileCopying ? inlineRemote : [];
    const candidates = new Set([...overlay.dirty, ...overlay.replaced.keys()]);
    // A constant read several times whose every read gets the same new value (e.g. the version
    // string) changes at its declaration too.
    const byConstant = new Map();
    for (const node of candidates)
      if (isInlinedCopy(node) && !readOnce(node)) {
        if (!byConstant.has(node[INLINED_FROM])) byConstant.set(node[INLINED_FROM], []);
        byConstant.get(node[INLINED_FROM]).push(node);
      }
    const allReads = new Map(); // constant name -> every inlined copy of it in the target
    if (byConstant.size) {
      const stack = [target.program];
      while (stack.length) {
        const node = stack.pop();
        if (node[INLINED_FROM]) {
          if (!allReads.has(node[INLINED_FROM])) allReads.set(node[INLINED_FROM], []);
          allReads.get(node[INLINED_FROM]).push(node);
        }
        for (const key of childKeys(node)) {
          const value = node[key];
          if (Array.isArray(value)) for (const item of value) isNode(item) && stack.push(item);
          else if (isNode(value)) stack.push(value);
        }
      }
    }
    for (const [name, reads] of byConstant) {
      // Every read changes, except reads in the target's own code (code the base does not
      // have, e.g. this project's plugins): those follow the constant's new value.
      const changedReads = new Set(reads);
      const others = (allReads.get(name) ?? []).filter((node) => !changedReads.has(node));
      if (!others.every((node) => ownCode(node))) continue;
      if (reads.length + others.length !== target.inlined?.get(name)?.references) continue;
      // only a primitive literal may move to the declaration (evaluation order).
      if (!reads.every((node) => overlay.replaced.has(node) && isScalar(overlay.effective(node))))
        continue;
      const texts = reads.map((node) => render(overlay.effective(node)));
      if (texts.some((text) => text !== texts[0])) continue;
      const location = locate(reads[0]);
      if (!location) continue;
      for (const node of reads) remote.add(node);
      edits.push({
        node: reads[0],
        location,
        text: texts[0],
        replacement: overlay.effective(reads[0]),
      });
    }
    for (const node of candidates) {
      if (!isInlinedCopy(node) || !readOnce(node) || remote.has(node)) continue;
      const location = locate(node);
      if (!location) continue;
      const replacement = overlay.effective(node);
      // a new value that is not a literal is written where it is read.
      if (replacement !== node && replacement !== null && !isPureLiteral(replacement)) continue;
      const text =
        replacement !== node ? render(replacement) : (tryPatch(node) ?? printComposed(node));
      remote.add(node);
      edits.push({ node, location, text, replacement: replacement !== node ? replacement : null });
    }
    return edits;
  }

  function render(node, parent = null, key = null) {
    if (remote.has(node)) {
      const read = locate(node[USE_SITE]);
      return read ? read.text.slice(read.start, read.end) : node[INLINED_FROM];
    }
    const effective = overlay.effective(node);
    if (effective === null) return "";
    let text;
    if (isOther(effective)) text = printForeign(effective);
    else text = renderTarget(effective);
    if (
      effective !== node &&
      effective.type !== node.type &&
      needsParentheses(effective, parent, key)
    )
      return `(${text})`;
    return text;
  }

  function renderTarget(node) {
    if (!overlay.isChanged(node)) {
      const location = isInlinedCopy(node) ? locate(node[USE_SITE]) : locate(node);
      if (location) return copySpan(location.text, location.start, location.end);
      return printComposed(node);
    }
    const patched = tryPatch(node);
    if (patched !== null) {
      stats.patched++;
      return patched;
    }
    return printComposed(node);
  }

  /** Patch mode; null when the node cannot be patched. */
  function tryPatch(node) {
    const location = locate(node);
    if (!location) return null;
    const edits = [];
    const changes = overlay.children.get(node);
    const keys = new Set([...childKeys(node), ...(changes ? changes.keys() : [])]);
    for (const key of keys) {
      const original = node[key];
      const current = overlay.value(node, key);
      if (Array.isArray(original)) {
        if (!Array.isArray(current)) return null;
        if (!patchList(node, key, original, current, location, edits)) return null;
        continue;
      }
      if (original === current) {
        if (!isNode(original) || !changed(original)) continue;
        const childLocation = locateInParent(original);
        if (!childLocation || childLocation.text !== location.text) return null;
        edits.push([childLocation.start, childLocation.end, render(original, node, key)]);
        continue;
      }
      // setChild: a child replaced, added or removed.
      if (!isNode(original) || !isNode(current)) return null;
      const childLocation = locateInParent(original);
      if (!childLocation || childLocation.text !== location.text) return null;
      const text = render(current, node, key);
      edits.push([
        childLocation.start,
        childLocation.end,
        current.type !== original.type && needsParentheses(current, node, key) ? `(${text})` : text,
      ]);
    }
    return spliced(location, edits);
  }

  function spliced(location, edits) {
    edits.sort((a, b) => a[0] - b[0]);
    let text = "";
    let position = location.start;
    for (const [start, end, replacement] of edits) {
      if (start < position || end > location.end) return null; // overlapping or outside
      text += copySpan(location.text, position, start) + replacement;
      position = end;
    }
    return text + copySpan(location.text, position, location.end);
  }

  function patchList(node, key, original, current, location, edits) {
    if (!original.length) return current.length === 0;
    const statements = isStatementList(node, key);
    const located = original.map((item) => (item === null ? null : locateInParent(item)));
    const sameList =
      current.length === original.length && current.every((item, i) => item === original[i]);
    if (located.some((item) => !item || item.text !== location.text)) {
      // Elements without text of their own (normalization) or holes: only in-place changes of
      // elements that have their own text can be patched.
      if (!sameList) return false;
      for (let i = 0; i < original.length; i++) {
        const item = original[i];
        if (!isNode(item) || !changed(item)) continue;
        if (!located[i] || located[i].text !== location.text) return false;
        edits.push([located[i].start, located[i].end, render(item, node, key)]);
      }
      return true;
    }
    if (sameList) {
      for (let i = 0; i < original.length; i++) {
        const item = original[i];
        if (!changed(item)) continue;
        edits.push([located[i].start, located[i].end, render(item, node, key)]);
      }
      return true;
    }
    // Rebuild the region from the first to the last original element, keeping the separators
    // (and the comments in them) that precede the original elements.
    const regionStart = located[0].start;
    let regionEnd = located.at(-1).end;
    // a list emptied of its elements loses its trailing comma too (`f(a,)` -> `f()`).
    if (!statements && current.length === 0) {
      const comma = /^\s*,/.exec(location.text.slice(regionEnd, location.end));
      if (comma) regionEnd += comma[0].length;
    }
    const originalIndex = new Map(original.map((item, i) => [item, i]));
    const separatorBefore = (i) => copySpan(location.text, located[i - 1].end, located[i].start);
    const defaultSeparator = statements ? "\n" : ", ";
    let text = "";
    let first = true;
    for (const item of current) {
      const i = originalIndex.get(item);
      if (i !== undefined) {
        const rendered = changed(item)
          ? render(item, node, key)
          : copySpan(location.text, located[i].start, located[i].end);
        if (!first) text += i > 0 ? separatorBefore(i) : defaultSeparator;
        text += rendered;
      } else {
        if (!first) text += defaultSeparator;
        text += render(item, node, key);
      }
      first = false;
    }
    // `x => ...` has no parentheses around its parameter: add them.
    if (
      node.type === "ArrowFunctionExpression" &&
      key === "params" &&
      !/\(\s*$/.test(location.text.slice(location.start, regionStart))
    )
      text = `(${text})`;
    edits.push([regionStart, regionEnd, text]);
    return true;
  }

  /** Prints a target node with astring; its unchanged children keep their text. */
  function printComposed(node) {
    stats.printed++;
    const resolve = (value) => (isNode(value) ? overlay.effective(value) : value);
    const copy = { ...node };
    const keys = new Set([...childKeys(node), ...(overlay.children.get(node)?.keys() ?? [])]);
    for (const key of keys) {
      const value = overlay.value(node, key);
      copy[key] = Array.isArray(value) ? value.map(resolve) : resolve(value);
    }
    const generator = Object.create(foreignGenerator);
    for (const type of [...Object.keys(GENERATOR), "SwitchCase", "CatchClause"]) {
      const base = foreignGenerator[type];
      generator[type] = function (child, state) {
        if (child === copy || isOther(child)) return base.call(this, child, state);
        state.write(render(child));
      };
    }
    return generate(copy, { generator, indent: "  " });
  }

  return { render, remoteEdits, printForeign, stats, isOther };
}

/** The raw (source) statement a normalized statement belongs to. */
export const rawStatementOf = (statement) => statement[RAW] ?? statement;
