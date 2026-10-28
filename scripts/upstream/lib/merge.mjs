// Three-way structural merge of the main module: base (B), target (TG) and other (OT).
//
// `planMerge` computes the operations that bring into TG the changes OT made relative to B,
// keeping the changes TG itself made. Used both ways:
//   * port:     TG = build of src/ (ours), OT = new release (theirs) -> what to change in src/;
//   * expected: TG = new release, OT = build of src/ before the port -> the new release with this
//     project's changes, the reference the ported src/ must be equivalent to (verify.mjs).
// Both directions produce the same program when there is no conflict.
//
// The merge walks B, TG and OT in parallel from the top-level statements down. A subtree OT did
// not change (same digest as B, with consistent local bindings) is left alone; one only OT
// changed is replaced; lists (statements of a block, class members, properties, array elements,
// arguments) are merged element by element; where both TG and OT changed the same thing
// differently, a conflict is recorded and TG is left as it is there.
//
// Operations (all on TG nodes):
//   { op: "replace", node, with }            replace node by `with` (an OT node)
//   { op: "setChild", node, key, value }      set a non-list child (OT node or null)
//   { op: "remove", parent, key, node }       remove an element of parent[key]
//   { op: "insert", parent, key, after, before, nodes, placement }
//        insert OT nodes into parent[key] between the TG elements `after` and `before` (either may
//        be null); placement "afterLeft" puts them right after `after`, "beforeRight" right
//        before `before` (when TG has its own new elements in that gap)
//   { op: "move", parent, key, node, after, before, placement }   move a TG element
// Top-level operations use parent = TG.factory.body, key = "body".
import { isNode } from "../../lib/ast.mjs";
import { alignList, declaredTopVariables, nodeKeys, pairVariables } from "./align.mjs";
import { createDigester } from "./hash.mjs";

const SCALAR_SKIP = new Set([
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
  "name",
  "value",
  "regex",
  "bigint",
]);

function scalarFields(node) {
  const fields = {};
  for (const key of Object.keys(node)) {
    if (SCALAR_SKIP.has(key)) continue;
    const value = node[key];
    if (value === null || value === undefined || typeof value === "object") continue;
    if (key === "expression" && typeof value === "boolean") continue;
    fields[key] = value;
  }
  return fields;
}

const sameScalars = (a, b) => {
  const fa = scalarFields(a);
  const fb = scalarFields(b);
  const keys = new Set([...Object.keys(fa), ...Object.keys(fb)]);
  for (const key of keys) if (fa[key] !== fb[key]) return false;
  return true;
};

/** Digest functions of the three sides in the base namespace (top-level bindings by B name). */
export function createMergeDigesters(B, TG, OT, alignTG, alignOT) {
  const own = (variable) => variable.name;
  const viaBase = (align, side) => (variable) => {
    const base = align.vars.back(variable);
    return base && B.topVariables.has(base) ? base.name : `${side.label}:${variable.name}`;
  };
  const tgName = viaBase(alignTG, TG);
  const otName = viaBase(alignOT, OT);
  return {
    dB: createDigester(B, { topIdentity: own, declarationIdentity: own }),
    dTG: createDigester(TG, { topIdentity: tgName, declarationIdentity: tgName }),
    dOT: createDigester(OT, { topIdentity: otName, declarationIdentity: otName }),
  };
}

/**
 * Plans the merge. `alignTG` = alignTopLevel(B, TG), `alignOT` = alignTopLevel(B, OT).
 * `otIsTheirs` tells which side is the new release (for the placement of concurrent insertions:
 * at the top level the release's new statements come first, in nested lists this project's).
 * Returns { ops, conflicts, notes, digests }.
 */
export function planMerge({ B, TG, OT, alignTG, alignOT, otIsTheirs }) {
  const digests = createMergeDigesters(B, TG, OT, alignTG, alignOT);
  const { dB, dTG, dOT } = digests;
  const ops = [];
  const conflicts = [];
  const notes = [];
  const varsTG = alignTG.vars;
  const varsOT = alignOT.vars;
  const privatesTG = alignTG.privates;
  const privatesOT = alignOT.privates;

  const text = (side, node) =>
    node?.range ? side.source.slice(node.range[0], node.range[1]) : String(node);
  const describeTop = (b) => {
    const names = declaredTopVariables(b, B).map((variable) => variable.name);
    return names.length ? names.join(", ") : text(B, b).slice(0, 80).replace(/\s+/g, " ");
  };
  const conflict = (kind, path, b, tg, ot, detail = "") =>
    conflicts.push({ kind, path, detail, base: b, target: tg, other: ot });
  // Where both changed the same code, src/ keeps this project's version (the port leaves TG,
  // src/, as it is there). The expected program follows the same rule, so that the port and the
  // expected program agree at the conflicts too: when OT is this project, OT's version wins.
  const projectWins = !otIsTheirs;

  /** OT did not change `ot` relative to `b` (same shape, consistent bindings). */
  const unchangedOT = (b, ot) =>
    dB(b) === dOT(ot) && pairVariables(b, ot, B, OT, varsOT, privatesOT, { commit: "consistent" });
  const unchangedTG = (b, tg) =>
    dB(b) === dTG(tg) && pairVariables(b, tg, B, TG, varsTG, privatesTG, { commit: "consistent" });
  const sameChange = (tg, ot) => dTG(tg) === dOT(ot);

  /** The function of a method (`m() {}`, get/set): it is written as part of its property. */
  const isMethodValue = (parent, key) =>
    key === "value" &&
    ((parent?.type === "Property" && (parent.method || parent.kind !== "init")) ||
      parent?.type === "MethodDefinition");

  function mergeNode(b, tg, ot, path, parents = null) {
    if (unchangedOT(b, ot)) return;
    // A method's function replaced whole (e.g. made async) is replaced with its property.
    const replaceWhole = () =>
      parents && isMethodValue(parents.tg, parents.key) && isMethodValue(parents.ot, parents.key)
        ? ops.push({ op: "replace", node: parents.tg, with: parents.ot, path })
        : ops.push({ op: "replace", node: tg, with: ot, path });
    const tgUnchanged = unchangedTG(b, tg);
    if (!tgUnchanged && sameChange(tg, ot)) return;
    const atomic =
      b.type !== ot.type ||
      b.type !== tg.type ||
      b.type === "Identifier" ||
      b.type === "Literal" ||
      b.type === "PrivateIdentifier" ||
      b.type === "TemplateElement" ||
      b.type === "ThisExpression" ||
      b.type === "Super";
    if (atomic || !sameScalars(b, ot)) {
      if (tgUnchanged) replaceWhole();
      else if (!atomic && sameScalars(tg, ot) && sameScalars(b, tg) === false) {
        // Both changed the same scalar (e.g. an operator) and possibly children: merge children.
        mergeChildren(b, tg, ot, path);
      } else {
        conflict("both-changed", path, b, tg, ot);
        if (projectWins) replaceWhole();
      }
      return;
    }
    if (!sameScalars(b, tg)) {
      // TG changed a scalar (operator, kind...) and OT changed something inside.
      if (tgUnchanged) replaceWhole();
      else mergeChildren(b, tg, ot, path);
      return;
    }
    mergeChildren(b, tg, ot, path);
  }

  function mergeChildren(b, tg, ot, path) {
    const keys = new Set([...nodeKeys(b), ...nodeKeys(ot), ...nodeKeys(tg)]);
    for (const key of [...keys].sort()) {
      const vb = b[key];
      const vtg = tg[key];
      const vot = ot[key];
      if (Array.isArray(vb) || Array.isArray(vot) || Array.isArray(vtg)) {
        if (!Array.isArray(vb) || !Array.isArray(vot) || !Array.isArray(vtg)) {
          conflict("shape", `${path}.${key}`, b, tg, ot);
          if (projectWins) ops.push({ op: "replace", node: tg, with: ot, path });
          continue;
        }
        mergeList(b, tg, ot, key, `${path}.${key}`);
        continue;
      }
      const presentB = isNode(vb);
      const presentTG = isNode(vtg);
      const presentOT = isNode(vot);
      if (!presentB && !presentOT) continue;
      if (presentB && presentOT && presentTG) {
        mergeNode(vb, vtg, vot, `${path}.${key}`, { tg, ot, key });
        continue;
      }
      // A child appears or disappears (e.g. an `else`, an initializer, a default value).
      if (presentB === presentOT) continue; // both absent handled above
      const tgLikeBase = presentB === presentTG && (!presentB || unchangedTG(vb, vtg));
      if (tgLikeBase)
        ops.push({
          op: "setChild",
          node: tg,
          key,
          value: presentOT ? vot : null,
          path: `${path}.${key}`,
        });
      else if (presentTG === presentOT && (!presentOT || sameChange(vtg, vot))) continue;
      else {
        conflict("both-changed", `${path}.${key}`, vb ?? b, vtg ?? tg, vot ?? ot);
        if (projectWins)
          ops.push({
            op: "setChild",
            node: tg,
            key,
            value: presentOT ? vot : null,
            path: `${path}.${key}`,
          });
      }
    }
  }

  function placementFor(topLevel) {
    // At the top level the release's new statements come first (they stay in the module of the
    // statement they follow); in nested lists this project's new elements come first.
    const otFirst = topLevel ? otIsTheirs : !otIsTheirs;
    return otFirst ? "afterLeft" : "beforeRight";
  }

  function mergeList(b, tg, ot, key, path) {
    const listB = b[key];
    const listTG = tg[key];
    const listOT = ot[key];
    const alignedTG = alignList(listB, listTG, B, TG, dB, dTG);
    const alignedOT = alignList(listB, listOT, B, OT, dB, dOT);
    const tgOf = new Map(alignedTG.pairs.map(([i, j, kind]) => [i, { j, kind }]));
    const otOf = new Map(alignedOT.pairs.map(([i, j, kind]) => [i, { j, kind }]));
    const baseOfOT = new Map(alignedOT.pairs.map(([i, j]) => [j, i]));
    const revivedElements = [];
    for (let i = 0; i < listB.length; i++) {
      const inTG = tgOf.get(i);
      const inOT = otOf.get(i);
      const elementPath = `${path}[${i}]`;
      if (!inOT) {
        if (!inTG) continue;
        if (listB[i] === null) continue;
        if (inTG.kind === "same" && unchangedTG(listB[i], listTG[inTG.j]))
          ops.push({ op: "remove", parent: tg, key, node: listTG[inTG.j], path: elementPath });
        else {
          conflict("removed-but-changed", elementPath, listB[i], listTG[inTG.j], null);
          if (projectWins)
            ops.push({ op: "remove", parent: tg, key, node: listTG[inTG.j], path: elementPath });
        }
        continue;
      }
      if (inOT.kind === "same" && (listB[i] === null || unchangedOT(listB[i], listOT[inOT.j])))
        continue;
      if (!inTG) {
        conflict("changed-but-removed", elementPath, listB[i], null, listOT[inOT.j]);
        if (projectWins) revivedElements.push(inOT.j); // inserted again, with OT's new elements
        continue;
      }
      if (listB[i] === null || listTG[inTG.j] === null || listOT[inOT.j] === null) {
        if (listOT[inOT.j] !== listB[i])
          conflict("hole", elementPath, listB[i], listTG[inTG.j], listOT[inOT.j]);
        continue;
      }
      mergeNode(listB[i], listTG[inTG.j], listOT[inOT.j], elementPath);
    }
    // Elements OT added: insert them between the TG counterparts of their neighbours.
    const added = [...alignedOT.added, ...revivedElements].sort((x, y) => x - y);
    if (!added.length) return;
    const runs = [];
    for (const j of added) {
      const last = runs.at(-1);
      if (last && last.at(-1) === j - 1) last.push(j);
      else runs.push([j]);
    }
    for (const run of runs) {
      const tgIndexOfOT = (j) => {
        const i = baseOfOT.get(j);
        return i === undefined ? undefined : tgOf.get(i)?.j;
      };
      let left = null;
      for (let j = run[0] - 1; j >= 0; j--) {
        const index = tgIndexOfOT(j);
        if (index !== undefined) {
          left = index;
          break;
        }
      }
      let right = null;
      for (let j = run.at(-1) + 1; j < listOT.length; j++) {
        const index = tgIndexOfOT(j);
        if (index !== undefined) {
          right = index;
          break;
        }
      }
      ops.push({
        op: "insert",
        parent: tg,
        key,
        after: left === null ? null : listTG[left],
        before: right === null ? null : listTG[right],
        nodes: run.map((j) => listOT[j]),
        placement: placementFor(false),
        path: `${path}+${run[0]}`,
      });
    }
  }

  // ---- top level -------------------------------------------------------------------------
  const topParent = TG.factory.body;
  /**
   * The bindings a statement of `side` declares that the side's own statements (those without a
   * counterpart in B: this project's additions when the side is src/) read or write.
   */
  const ownUsage = (side, alignment) => {
    const ranges = side.body
      .filter((statement) => !alignment.back.has(statement))
      .map((statement) => statement.range)
      .sort((a, b) => a[0] - b[0]);
    const insideOwn = (offset) => {
      let low = 0;
      let high = ranges.length - 1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        const [start, end] = ranges[middle];
        if (offset < start) high = middle - 1;
        else if (offset >= end) low = middle + 1;
        else return true;
      }
      return false;
    };
    return (statement) =>
      declaredTopVariables(statement, side).filter((variable) =>
        variable.references.some(
          (reference) =>
            reference.identifier.range &&
            insideOwn(reference.identifier.range[0]) &&
            !(
              reference.identifier.range[0] >= statement.range[0] &&
              reference.identifier.range[1] <= statement.range[1]
            ),
        ),
      );
  };
  const usedByOwnCode = ownUsage(TG, alignTG);
  const usedByOwnCodeOfOT = ownUsage(OT, alignOT);
  // Statements of OT that TG removed but OT's own code uses: kept (inserted again into TG).
  const revived = new Set();
  for (const b of B.body) {
    const inTG = alignTG.pairs.get(b);
    const inOT = alignOT.pairs.get(b);
    const path = describeTop(b);
    if (!inOT) {
      if (!inTG) continue;
      const used = inTG.kind === "modified" ? [] : usedByOwnCode(inTG.y);
      if (inTG.kind === "modified") {
        conflict("removed-but-changed", path, b, inTG.y, null);
        if (projectWins)
          ops.push({ op: "remove", parent: topParent, key: "body", node: inTG.y, path });
      } else if (used.length)
        conflict(
          "removed-but-used",
          path,
          b,
          inTG.y,
          null,
          `${used.map((variable) => variable.name).join(", ")} is used by code of the target that the base does not have`,
        );
      else ops.push({ op: "remove", parent: topParent, key: "body", node: inTG.y, path });
      continue;
    }
    if (!inTG && inOT.kind !== "modified") {
      const used = usedByOwnCodeOfOT(inOT.y);
      if (used.length) {
        // TG removed it, but code only OT has uses it: keep OT's statement.
        conflict(
          "removed-but-used",
          path,
          b,
          null,
          inOT.y,
          `${used.map((variable) => variable.name).join(", ")} is used by code of the other side that the base does not have`,
        );
        revived.add(inOT.y);
      }
      continue;
    }
    if (inOT.kind === "same" || inOT.kind === "moved") {
      // A moved ordered statement changes the evaluation order: handled with the insertions.
      continue;
    }
    if (!inTG) {
      conflict("changed-but-removed", path, b, null, inOT.y);
      if (projectWins) revived.add(inOT.y);
      continue;
    }
    mergeNode(b, inTG.y, inOT.y, path);
  }

  // New and moved statements of OT, in OT order, placed after the TG counterpart of the
  // statement they follow in OT (functions are hoisted: only their module matters).
  const tgOfOT = (y) => {
    const b = alignOT.back.get(y);
    return b === undefined ? undefined : alignTG.pairs.get(b)?.y;
  };
  // a statement OT moved *and* changed is paired "modified" (align.mjs, moves by
  // name); it must move too. Displaced = paired ordered statements of OT outside the heaviest
  // increasing subsequence of their B positions ("same" pairs weigh most).
  const orderedB = B.body.filter((statement) => statement.type !== "FunctionDeclaration");
  const ordinalB = new Map(orderedB.map((statement, index) => [statement, index]));
  const sequence = OT.body
    .filter((y) => y.type !== "FunctionDeclaration")
    .map((y) => alignOT.back.get(y))
    .filter((b) => b !== undefined && ordinalB.has(b));
  const displaced = new Set();
  {
    const weight = (b) => (alignOT.pairs.get(b).kind === "same" ? 1e6 : 1);
    const best = new Float64Array(sequence.length);
    const previous = new Int32Array(sequence.length).fill(-1);
    // Patience-free O(n^2) is fine for ~2000 statements; keep it simple.
    for (let k = 0; k < sequence.length; k++) {
      best[k] = weight(sequence[k]);
      const key = ordinalB.get(sequence[k]);
      for (let j = 0; j < k; j++)
        if (ordinalB.get(sequence[j]) < key && best[j] + weight(sequence[k]) > best[k]) {
          best[k] = best[j] + weight(sequence[k]);
          previous[k] = j;
        }
    }
    let end = -1;
    for (let k = 0; k < sequence.length; k++) if (end < 0 || best[k] > best[end]) end = k;
    const kept = new Set();
    for (let k = end; k >= 0; k = previous[k]) kept.add(sequence[k]);
    for (const b of sequence) if (!kept.has(b)) displaced.add(b);
  }
  const isMovedOrdered = (y) => {
    const b = alignOT.back.get(y);
    return (
      b !== undefined &&
      (alignOT.pairs.get(b)?.kind === "moved" || displaced.has(b)) &&
      y.type !== "FunctionDeclaration" &&
      alignTG.pairs.get(b)
    );
  };
  const pending = [];
  OT.body.forEach((y, index) => {
    if (!alignOT.back.has(y) || isMovedOrdered(y) || revived.has(y)) pending.push(index);
  });
  const runs = [];
  for (const index of pending) {
    const last = runs.at(-1);
    if (last && last.at(-1) === index - 1) last.push(index);
    else runs.push([index]);
  }
  for (const run of runs) {
    // Statements that run when the module is evaluated follow the previous statement that also
    // runs (function declarations are hoisted, and src/ groups them by module, not by position).
    const ordered = run.some((index) => OT.body[index].type !== "FunctionDeclaration");
    const usable = (statement) => !ordered || statement.type !== "FunctionDeclaration";
    let left = null;
    for (let index = run[0] - 1; index >= 0; index--) {
      const y = OT.body[index];
      if (pending.includes(index) || !usable(y)) continue;
      const counterpart = tgOfOT(y);
      if (counterpart) {
        left = counterpart;
        break;
      }
    }
    let right = null;
    for (let index = run.at(-1) + 1; index < OT.body.length; index++) {
      if (!usable(OT.body[index])) continue;
      const counterpart = tgOfOT(OT.body[index]);
      if (counterpart && !isMovedOrdered(OT.body[index])) {
        right = counterpart;
        break;
      }
    }
    // Split the run into new statements and moved ones (which keep their TG version).
    let batch = [];
    const flush = () => {
      if (!batch.length) return;
      ops.push({
        op: "insert",
        parent: topParent,
        key: "body",
        after: left,
        before: right,
        nodes: batch,
        placement: placementFor(true),
        path: `top+${run[0]}`,
      });
      batch = [];
    };
    for (const index of run) {
      const y = OT.body[index];
      if (isMovedOrdered(y)) {
        flush();
        const b = alignOT.back.get(y);
        const node = alignTG.pairs.get(b).y;
        ops.push({
          op: "move",
          parent: topParent,
          key: "body",
          node,
          after: left,
          before: right,
          placement: placementFor(true),
          path: describeTop(b),
        });
        left = node;
      } else batch.push(y);
    }
    flush();
  }
  return { ops, conflicts, notes, digests };
}
