// Aligns the statements of two prepared programs (see program.mjs) and learns which binding of
// one corresponds to which binding of the other.
//
// `alignTopLevel(X, Y)` pairs the top-level statements of the main modules of X (always the older
// side, e.g. the base release) and Y (a newer release, or the build of src/):
//   1. ordered statements (everything but function declarations, which are hoisted and may move)
//      are aligned by a longest common subsequence of their digests (hash.mjs);
//   2. every pair of identical statements teaches variable correspondences (`VarMap`): walking
//      both in parallel, each pair of bound identifiers names the same binding;
//   3. function declarations are paired by the learned name of the function, else by a unique
//      digest; their bodies teach more names; repeat until nothing new is learned;
//   4. the alignment is redone with refined digests, where references to top-level bindings
//      carry the canonical (X) name, so that calling another function is a difference;
//   5. statements left over between two aligned ones are paired as "modified" when they declare
//      corresponding names or are similar enough (shared property names, globals, literals);
//      identical statements found elsewhere are "moved".
// `alignList` does the same for the elements of a nested list (statements of a block, class
// members, properties, array elements, arguments), keyed by property name when it can.
import { isNode } from "../../lib/ast.mjs";
import { createDigester, similarity, wordsOf } from "./hash.mjs";
import { indexParents } from "./render.mjs";

/** A one-to-one correspondence between the bindings (or private names) of two sides. */
export class VarMap {
  constructor() {
    this.xy = new Map();
    this.yx = new Map();
    this.conflicts = 0;
  }
  get(x) {
    return this.xy.get(x);
  }
  back(y) {
    return this.yx.get(y);
  }
  /** True when the pair is (now) recorded; false when it contradicts a recorded pair. */
  propose(x, y) {
    const knownY = this.xy.get(x);
    const knownX = this.yx.get(y);
    if (knownY === undefined && knownX === undefined) {
      this.xy.set(x, y);
      this.yx.set(y, x);
      return true;
    }
    if (knownY === y && knownX === x) return true;
    this.conflicts++;
    return false;
  }
  /** Would the pair be accepted? (no side effect) */
  accepts(x, y) {
    const knownY = this.xy.get(x);
    const knownX = this.yx.get(y);
    return (knownY === undefined && knownX === undefined) || (knownY === y && knownX === x);
  }
  get size() {
    return this.xy.size;
  }
  clone() {
    const copy = new VarMap();
    copy.xy = new Map(this.xy);
    copy.yx = new Map(this.yx);
    copy.conflicts = this.conflicts;
    return copy;
  }
}

/**
 * A copy of an alignment whose binding maps can grow independently: planning a merge learns
 * more correspondences, and two merges planned from the same alignment must not see each other's.
 */
export function cloneAlignment(alignment) {
  return { ...alignment, vars: alignment.vars.clone(), privates: alignment.privates.clone() };
}

const SKIPPED_KEYS = new Set([
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

/** Child keys holding nodes or arrays, in a stable order. */
export function nodeKeys(node) {
  return Object.keys(node)
    .filter((key) => !SKIPPED_KEYS.has(key))
    .filter((key) => {
      const value = node[key];
      return isNode(value) || Array.isArray(value);
    })
    .sort();
}

/** Key of the class body a private name belongs to: the nearest enclosing ClassBody. */
export function classKeyOf(side, node) {
  const parents = indexParents(side);
  for (let up = parents.get(node)?.parent; up; up = parents.get(up)?.parent)
    if (up.type === "ClassBody") return `${up.start ?? up.range?.[0]}`;
  return "";
}

/**
 * Walks two subtrees with the same shape in parallel and proposes the variable (and private name)
 * correspondences they imply. Transactional: with `commit: "consistent"` (default) the proposals
 * are recorded only when none contradicts the maps or another proposal; with `commit: "partial"`
 * the non-contradicting ones are recorded anyway. Returns true when all were consistent.
 */
export function pairVariables(x, y, X, Y, vars, privates = null, { commit = "consistent" } = {}) {
  const proposals = [];
  const privateProposals = [];
  const classesX = [];
  const classesY = [];
  let shapeMismatch = false;
  const visit = (a, b) => {
    if (!isNode(a) || !isNode(b)) {
      if (isNode(a) !== isNode(b)) shapeMismatch = true;
      return;
    }
    if (a.type !== b.type) {
      shapeMismatch = true;
      return;
    }
    if (a.type === "Identifier") {
      const bindingA = X.bindings.get(a);
      const bindingB = Y.bindings.get(b);
      if (bindingA && bindingA !== "global" && bindingB && bindingB !== "global")
        proposals.push([bindingA, bindingB]);
      return;
    }
    if (a.type === "PrivateIdentifier") {
      privateProposals.push([`${classKeyOf(X, a)}#${a.name}`, `${classKeyOf(Y, b)}#${b.name}`]);
      return;
    }
    const isClass = a.type === "ClassBody";
    if (isClass) {
      classesX.push(a.start ?? a.range?.[0]);
      classesY.push(b.start ?? b.range?.[0]);
    }
    for (const key of nodeKeys(a)) {
      const valueA = a[key];
      const valueB = b[key];
      if (Array.isArray(valueA)) {
        if (!Array.isArray(valueB) || valueA.length !== valueB.length) {
          shapeMismatch = true;
          continue;
        }
        for (let index = 0; index < valueA.length; index++) visit(valueA[index], valueB[index]);
      } else visit(valueA, valueB);
    }
    if (isClass) {
      classesX.pop();
      classesY.pop();
    }
  };
  visit(x, y);
  // Check the proposals against the maps and against each other.
  const local = new VarMap();
  let consistent = !shapeMismatch;
  for (const [a, b] of proposals) {
    if (!vars.accepts(a, b) || !local.propose(a, b)) consistent = false;
  }
  const localPrivate = new VarMap();
  if (privates)
    for (const [a, b] of privateProposals) {
      if (!privates.accepts(a, b) || !localPrivate.propose(a, b)) consistent = false;
    }
  if (consistent || commit === "partial") {
    for (const [a, b] of proposals) if (vars.accepts(a, b)) vars.propose(a, b);
    if (privates)
      for (const [a, b] of privateProposals) if (privates.accepts(a, b)) privates.propose(a, b);
  }
  return consistent;
}

/** Longest common subsequence of two arrays of strings: pairs of indices, in order. */
export function lcs(a, b) {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return [];
  // Trim the common prefix and suffix first (most lists are mostly unchanged).
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix])
    suffix++;
  const pairs = [];
  for (let i = 0; i < prefix; i++) pairs.push([i, i]);
  const innerA = a.slice(prefix, n - suffix);
  const innerB = b.slice(prefix, m - suffix);
  const rows = innerA.length;
  const columns = innerB.length;
  if (rows && columns) {
    const Table =
      rows * columns > 50_000_000
        ? null
        : rows < 65535 && columns < 65535
          ? Uint16Array
          : Uint32Array;
    if (!Table) throw new Error(`lcs: lists too large (${rows} x ${columns})`);
    const width = columns + 1;
    const table = new Table((rows + 1) * width);
    for (let i = rows - 1; i >= 0; i--)
      for (let j = columns - 1; j >= 0; j--)
        table[i * width + j] =
          innerA[i] === innerB[j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    for (let i = 0, j = 0; i < rows && j < columns; ) {
      if (innerA[i] === innerB[j]) {
        pairs.push([prefix + i, prefix + j]);
        i++;
        j++;
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
      else j++;
    }
  }
  for (let k = suffix; k > 0; k--) pairs.push([n - k, m - k]);
  return pairs;
}

/** Top-level bindings declared by a statement (its own names, in source order). */
export function declaredTopVariables(statement, side) {
  const result = [];
  const seen = new Set();
  const consider = (identifier) => {
    const variable = side.bindings.get(identifier);
    if (
      variable &&
      variable !== "global" &&
      side.topVariables.has(variable) &&
      !seen.has(variable)
    ) {
      if (variable.identifiers.includes(identifier)) {
        seen.add(variable);
        result.push(variable);
      }
    }
  };
  if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
    if (statement.id) consider(statement.id);
  } else if (statement.type === "VariableDeclaration") {
    const stack = statement.declarations.map((declarator) => declarator.id);
    while (stack.length) {
      const node = stack.pop();
      if (!isNode(node)) continue;
      if (node.type === "Identifier") consider(node);
      else if (node.type === "ObjectPattern")
        for (const property of node.properties)
          stack.push(property.type === "RestElement" ? property.argument : property.value);
      else if (node.type === "ArrayPattern") stack.push(...node.elements);
      else if (node.type === "AssignmentPattern") stack.push(node.left);
      else if (node.type === "RestElement") stack.push(node.argument);
    }
  }
  return result;
}

const isOrdered = (statement) => statement.type !== "FunctionDeclaration";

/**
 * Aligns the top-level statements of the main modules of X (older side) and Y.
 * Returns {
 *   pairs: Map(xStatement -> { y, kind: "same" | "moved" | "modified", score }),
 *   back: Map(yStatement -> xStatement),
 *   removed: xStatements without counterpart, added: yStatements without counterpart,
 *   vars: VarMap (X variable -> Y variable, top-level and local), privates: VarMap,
 *   digestX, digestY: refined digest functions in X's namespace (references to unmapped
 *   top-level bindings of Y carry a Y-specific id)
 * }
 */
export function alignTopLevel(X, Y, { similarityThreshold = 0.35 } = {}) {
  const vars = new VarMap();
  const privates = new VarMap();
  const orderedX = X.body.filter(isOrdered);
  const orderedY = Y.body.filter(isOrdered);
  const functionsX = X.body.filter((statement) => !isOrdered(statement));
  const functionsY = Y.body.filter((statement) => !isOrdered(statement));

  const digesters = (strict) => {
    // Unmapped bindings are anonymous (they match anything) until the strict alignment.
    const mappedX = (variable) => (vars.get(variable) ? variable.name : null);
    const mappedY = (variable) => vars.back(variable)?.name ?? null;
    const digestX = createDigester(X, { topIdentity: mappedX, declarationIdentity: mappedX });
    const digestY = createDigester(Y, {
      topIdentity: (variable) =>
        mappedY(variable) ?? (strict ? `${Y.label}:${variable.name}` : null),
      declarationIdentity: mappedY,
    });
    // X's unmapped bindings must not equal anything in Y in strict mode either.
    const digestXStrict = strict
      ? createDigester(X, {
          topIdentity: (variable) => mappedX(variable) ?? `${X.label}:${variable.name}`,
          declarationIdentity: mappedX,
        })
      : digestX;
    return { digestX: digestXStrict, digestY };
  };

  const learnFrom = (pairs) => {
    for (const [x, y] of pairs) pairVariables(x, y, X, Y, vars, privates);
  };

  // Round 0: coarse digests (all top-level bindings anonymous), learn from distinctive pairs first.
  const coarseX = createDigester(X);
  const coarseY = createDigester(Y);
  let orderedPairs = lcs(orderedX.map(coarseX), orderedY.map(coarseY)).map(([i, j]) => [
    orderedX[i],
    orderedY[j],
  ]);
  const count = (list, digest) => {
    const counts = new Map();
    for (const item of list) counts.set(digest(item), (counts.get(digest(item)) ?? 0) + 1);
    return counts;
  };
  {
    const countsX = count(orderedX, coarseX);
    const countsY = count(orderedY, coarseY);
    const distinctive = (pair) =>
      countsX.get(coarseX(pair[0])) === 1 && countsY.get(coarseY(pair[1])) === 1;
    learnFrom(orderedPairs.filter(distinctive));
    learnFrom(orderedPairs.filter((pair) => !distinctive(pair)));
  }

  let functionPairs = new Map(); // fx -> fy
  const declaredBy = (functions, side) => {
    const map = new Map();
    for (const statement of functions)
      if (statement.id) map.set(side.bindings.get(statement.id), statement);
    return map;
  };
  const functionsByVariableY = declaredBy(functionsY, Y);
  const pairFunctions = (digestX, digestY) => {
    const pairs = new Map();
    const usedY = new Set();
    // By learned name.
    for (const fx of functionsX) {
      const vy = vars.get(X.bindings.get(fx.id));
      const fy = vy && functionsByVariableY.get(vy);
      if (fy && !usedY.has(fy)) {
        pairs.set(fx, fy);
        usedY.add(fy);
      }
    }
    // By unique digest among the rest.
    const restX = functionsX.filter((fx) => !pairs.has(fx));
    const restY = functionsY.filter((fy) => !usedY.has(fy));
    const byDigestY = new Map();
    for (const fy of restY) {
      const key = digestY(fy);
      byDigestY.set(key, byDigestY.has(key) ? null : fy);
    }
    const countsX = count(restX, digestX);
    for (const fx of restX) {
      const key = digestX(fx);
      const fy = byDigestY.get(key);
      if (fy && countsX.get(key) === 1) {
        pairs.set(fx, fy);
        usedY.add(fy);
      }
    }
    return pairs;
  };

  // Rounds 1..n: pair functions, learn, refine.
  for (let round = 0; round < 6; round++) {
    const before = vars.size;
    const { digestX, digestY } =
      round === 0 ? { digestX: coarseX, digestY: coarseY } : digesters(false);
    functionPairs = pairFunctions(digestX, digestY);
    learnFrom([...functionPairs].filter(([fx, fy]) => coarseX(fx) === coarseY(fy)));
    if (round > 0) {
      orderedPairs = lcs(orderedX.map(digestX), orderedY.map(digestY)).map(([i, j]) => [
        orderedX[i],
        orderedY[j],
      ]);
      learnFrom(orderedPairs);
    }
    if (vars.size === before && round > 0) break;
  }

  // Final strict alignment.
  const finish = () => {
    const { digestX, digestY } = digesters(true);
    const pairs = new Map();
    const back = new Map();
    const record = (x, y, kind, score = 1) => {
      pairs.set(x, { y, kind, score });
      back.set(y, x);
    };
    const exact = lcs(orderedX.map(digestX), orderedY.map(digestY));
    for (const [i, j] of exact) record(orderedX[i], orderedY[j], "same");
    for (const [fx, fy] of pairFunctions(digestX, digestY))
      record(
        fx,
        fy,
        digestX(fx) === digestY(fy) ? "same" : "modified",
        digestX(fx) === digestY(fy) ? 1 : similarity(wordsOf(fx, X), wordsOf(fy, Y)),
      );

    // Moves: an unpaired ordered statement whose identical twin is unpaired elsewhere.
    const unpairedY = new Map();
    for (const y of orderedY)
      if (!back.has(y)) {
        const key = digestY(y);
        unpairedY.set(key, unpairedY.has(key) ? null : y);
      }
    const unpairedXCounts = count(
      orderedX.filter((x) => !pairs.has(x)),
      digestX,
    );
    for (const x of orderedX) {
      if (pairs.has(x)) continue;
      const key = digestX(x);
      const y = unpairedY.get(key);
      if (y && unpairedXCounts.get(key) === 1) record(x, y, "moved");
    }
    // Moves by name: a declaration (e.g. `let x;`, which src/ may keep next to its users) whose
    // binding corresponds to the one an unpaired statement of Y declares.
    const declaringY = new Map();
    for (const y of orderedY)
      if (!back.has(y))
        for (const variable of declaredTopVariables(y, Y)) declaringY.set(variable, y);
    for (const x of orderedX) {
      if (pairs.has(x)) continue;
      const declared = declaredTopVariables(x, X);
      if (!declared.length) continue;
      const y = declaringY.get(vars.get(declared[0]));
      if (!y || back.has(y)) continue;
      const declaredY = declaredTopVariables(y, Y);
      if (
        declaredY.length !== declared.length ||
        !declared.every((variable, index) => vars.get(variable) === declaredY[index])
      )
        continue;
      if (digestX(x) === digestY(y)) record(x, y, "moved");
      else record(x, y, "modified", similarity(wordsOf(x, X), wordsOf(y, Y)));
    }

    // Modified: inside each gap between two anchors ("same" pairs in order).
    const anchors = exact;
    const gaps = [];
    let previous = [-1, -1];
    for (const anchor of [...anchors, [orderedX.length, orderedY.length]]) {
      const removed = [];
      const added = [];
      for (let i = previous[0] + 1; i < anchor[0]; i++)
        if (!pairs.has(orderedX[i])) removed.push(orderedX[i]);
      for (let j = previous[1] + 1; j < anchor[1]; j++)
        if (!back.has(orderedY[j])) added.push(orderedY[j]);
      if (removed.length && added.length) gaps.push({ removed, added });
      previous = anchor;
    }
    const pairModified = (removed, added, threshold) => {
      // 1. By declared names that correspond.
      for (const x of removed) {
        if (pairs.has(x)) continue;
        const names = declaredTopVariables(x, X);
        if (!names.length) continue;
        const y = added.find(
          (candidate) =>
            !back.has(candidate) &&
            declaredTopVariables(candidate, Y).some((variable) =>
              names.some((name) => vars.get(name) === variable),
            ),
        );
        if (y) record(x, y, "modified", similarity(wordsOf(x, X), wordsOf(y, Y)));
      }
      // 2. By similarity, best first.
      const candidates = [];
      const wordsY = new Map(added.map((y) => [y, wordsOf(y, Y)]));
      for (const x of removed) {
        if (pairs.has(x)) continue;
        const wordsX = wordsOf(x, X);
        for (const y of added) {
          if (back.has(y) || x.type !== y.type) continue;
          const score = similarity(wordsX, wordsY.get(y));
          if (score >= threshold) candidates.push([score, x, y]);
        }
      }
      candidates.sort((a, b) => b[0] - a[0]);
      for (const [score, x, y] of candidates)
        if (!pairs.has(x) && !back.has(y)) record(x, y, "modified", score);
    };
    for (const gap of gaps) pairModified(gap.removed, gap.added, similarityThreshold);
    pairModified(
      functionsX.filter((fx) => !pairs.has(fx)),
      functionsY.filter((fy) => !back.has(fy)),
      0.5,
    );
    return { pairs, back, digestX, digestY };
  };

  let result = finish();
  // Modified pairs teach the names they declare and those of their unchanged parts; realign
  // while that teaches something.
  for (let round = 0; round < 4; round++) {
    const before = vars.size;
    for (const [x, { y, kind }] of result.pairs) {
      if (kind === "same") continue;
      const declaredX = declaredTopVariables(x, X);
      const declaredY = declaredTopVariables(y, Y);
      if (declaredX.length === declaredY.length)
        declaredX.forEach((variable, index) => vars.propose(variable, declaredY[index]));
      learnTolerant(x, y, X, Y, coarseX, coarseY, vars, privates);
    }
    if (vars.size === before) break;
    result = finish();
  }
  const removed = X.body.filter((x) => !result.pairs.has(x));
  const added = Y.body.filter((y) => !result.back.has(y));
  return { ...result, removed, added, vars, privates, X, Y };
}

/**
 * Learns variable correspondences from two versions of an edited node: identical subtrees teach
 * their bindings; lists are aligned (alignList) and their paired elements visited recursively.
 */
export function learnTolerant(x, y, X, Y, digestX, digestY, vars, privates, depth = 0) {
  if (!isNode(x) || !isNode(y) || x.type !== y.type || depth > 60) return;
  if (digestX(x) === digestY(y)) {
    pairVariables(x, y, X, Y, vars, privates, { commit: "partial" });
    return;
  }
  if (x.type === "Identifier") {
    const bindingX = X.bindings.get(x);
    const bindingY = Y.bindings.get(y);
    if (
      bindingX &&
      bindingX !== "global" &&
      bindingY &&
      bindingY !== "global" &&
      vars.accepts(bindingX, bindingY)
    )
      vars.propose(bindingX, bindingY);
    return;
  }
  for (const key of nodeKeys(x)) {
    const valueX = x[key];
    const valueY = y[key];
    if (Array.isArray(valueX)) {
      if (!Array.isArray(valueY)) continue;
      const aligned = alignList(valueX, valueY, X, Y, digestX, digestY);
      for (const [i, j] of aligned.pairs)
        learnTolerant(valueX[i], valueY[j], X, Y, digestX, digestY, vars, privates, depth + 1);
    } else if (isNode(valueX) && isNode(valueY))
      learnTolerant(valueX, valueY, X, Y, digestX, digestY, vars, privates, depth + 1);
  }
}

/** Static key of a list element (object property or class member), or null. */
export function elementKey(node) {
  if (!isNode(node)) return null;
  if (
    (node.type === "Property" ||
      node.type === "MethodDefinition" ||
      node.type === "PropertyDefinition") &&
    !node.computed
  ) {
    const key = node.key;
    const name =
      key.type === "Identifier"
        ? key.name
        : key.type === "PrivateIdentifier"
          ? "#private"
          : key.type === "Literal"
            ? String(key.value)
            : null;
    if (name === null) return null;
    if (key.type === "PrivateIdentifier") return null; // private names differ per release
    return `${node.type}:${node.kind ?? ""}:${node.static ? "static" : ""}:${name}`;
  }
  return null;
}

/**
 * Aligns two lists of nodes (elements of the same field of two corresponding nodes).
 * digestX/digestY are refined digest functions in a common namespace.
 * Returns { pairs: [[i, j, kind, score]], removed: [i], added: [j] } with kind "same" (equal
 * digests) or "modified".
 */
export function alignList(listX, listY, X, Y, digestX, digestY, { threshold = 0.35 } = {}) {
  const result = { pairs: [], removed: [], added: [] };
  const usedX = new Set();
  const usedY = new Set();
  const pair = (i, j) => {
    const same = digestX(listX[i]) === digestY(listY[j]);
    result.pairs.push([
      i,
      j,
      same ? "same" : "modified",
      same ? 1 : similarity(wordsOf(listX[i], X), wordsOf(listY[j], Y)),
    ]);
    usedX.add(i);
    usedY.add(j);
  };
  // Keyed elements (properties, class members): by unique key.
  const keysX = listX.map(elementKey);
  const keysY = listY.map(elementKey);
  const countKeys = (keys) => {
    const counts = new Map();
    for (const key of keys) if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  };
  const countsX = countKeys(keysX);
  const countsY = countKeys(keysY);
  const keyedPairs = [];
  keysX.forEach((key, i) => {
    if (key === null || countsX.get(key) !== 1 || countsY.get(key) !== 1) return;
    keyedPairs.push([i, keysY.indexOf(key)]);
  });
  // Keep only an increasing subsequence of keyed pairs (order matters for evaluation).
  const increasing = lcs(
    keyedPairs.map(([i]) => String(i)),
    [...keyedPairs].sort((a, b) => a[1] - b[1]).map(([i]) => String(i)),
  ).map(([k]) => keyedPairs[k]);
  for (const [i, j] of increasing) pair(i, j);

  // The rest: LCS on digests between the keyed anchors.
  const anchors = [...result.pairs.map(([i, j]) => [i, j]), [listX.length, listY.length]];
  let previous = [-1, -1];
  for (const anchor of anchors.sort((a, b) => a[0] - b[0])) {
    const indicesX = [];
    const indicesY = [];
    for (let i = previous[0] + 1; i < anchor[0]; i++) if (!usedX.has(i)) indicesX.push(i);
    for (let j = previous[1] + 1; j < anchor[1]; j++) if (!usedY.has(j)) indicesY.push(j);
    if (indicesX.length && indicesY.length) {
      const exact = lcs(
        indicesX.map((i) => digestX(listX[i])),
        indicesY.map((j) => digestY(listY[j])),
      );
      for (const [a, b] of exact) pair(indicesX[a], indicesY[b]);
      // Gaps between exact pairs: pair the leftovers.
      const exactAnchors = [...exact, [indicesX.length, indicesY.length]];
      let last = [-1, -1];
      for (const [a, b] of exactAnchors) {
        const gapX = indicesX.slice(last[0] + 1, a).filter((i) => !usedX.has(i));
        const gapY = indicesY.slice(last[1] + 1, b).filter((j) => !usedY.has(j));
        if (gapX.length && gapY.length) {
          if (
            gapX.length === gapY.length &&
            gapX.every((i, k) => listX[i]?.type === listY[gapY[k]]?.type)
          ) {
            // Same count and types: positional (an edited argument, element or statement).
            gapX.forEach((i, k) => pair(i, gapY[k]));
          } else {
            const candidates = [];
            for (const i of gapX)
              for (const j of gapY) {
                if (!isNode(listX[i]) || !isNode(listY[j]) || listX[i].type !== listY[j].type)
                  continue;
                const score = similarity(wordsOf(listX[i], X), wordsOf(listY[j], Y));
                if (score >= threshold) candidates.push([score, i, j]);
              }
            candidates.sort((p, q) => p[0] - q[0] || 0).reverse();
            // Keep the order: accept a candidate only if it does not cross an accepted one.
            const accepted = [];
            for (const [, i, j] of candidates) {
              if (usedX.has(i) || usedY.has(j)) continue;
              if (accepted.some(([ai, aj]) => ai < i !== aj < j)) continue;
              accepted.push([i, j]);
              pair(i, j);
            }
          }
        }
        last = [a, b];
      }
    }
    previous = anchor;
  }
  result.pairs.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < listX.length; i++) if (!usedX.has(i)) result.removed.push(i);
  for (let j = 0; j < listY.length; j++) if (!usedY.has(j)) result.added.push(j);
  return result;
}
