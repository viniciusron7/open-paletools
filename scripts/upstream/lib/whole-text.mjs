// Applies a merge plan to a whole userscript text (see merge.mjs and render.mjs).
//
// `mergeIntoText` merges OT's changes (relative to B) into TG and returns the resulting
// userscript as text. With TG = the new release and OT = the build of src/ it produces the
// "expected" program: the new release with this project's changes, which the ported src/ must be
// equivalent to (verify.mjs). With TG = the build and OT = the new release it produces the
// build with the release's changes: the same program when there is no conflict (a self-check of
// the merge).
import { classKeyOf } from "./align.mjs";
import { planMerge } from "./merge.mjs";
import { INLINED_FROM, ORIGIN, USE_SITE } from "./program.mjs";
import { createRenderer, indexParents, Overlay } from "./render.mjs";

/** Renames for printing OT nodes into TG: OT binding -> B binding -> TG binding. */
/** A comparable key of a literal-like node (inlined constants are literals). */
const literalKey = (node) => {
  if (!node) return null;
  if (node.type === "Literal") return `${typeof node.value}:${String(node.value)}`;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0)
    return `string:${node.quasis[0].value.cooked}`;
  if (node.type === "UnaryExpression" && node.operator === "void") return "undefined";
  return JSON.stringify(node, (key, value) =>
    ["start", "end", "loc", "range", "raw"].includes(key) ? undefined : value,
  );
};

export function createRenamers({ B = null, TG = null, OT, alignTG, alignOT, missing = [] }) {
  const rename = (identifier) => {
    const binding = OT.bindings.get(identifier);
    if (!binding || binding === "global") return null;
    const base = alignOT.vars.back(binding);
    if (!base) return null; // OT's own binding: keeps its name
    const counterpart = alignTG.vars.get(base);
    if (!counterpart) {
      missing.push({ name: identifier.name, base: base.name, node: identifier });
      return null;
    }
    return counterpart.name;
  };
  const renamePrivate = (node) => {
    const base = alignOT.privates.back(`${classKeyOf(OT, node)}#${node.name}`);
    if (!base) return null;
    const counterpart = alignTG.privates.get(base);
    return counterpart ? counterpart.slice(counterpart.indexOf("#") + 1) : null;
  };
  /**
   * The value an inlined constant read by an OT node has in the merged program: when OT kept the
   * base's value and TG changed it (e.g. the version string), TG's; otherwise null (OT's own).
   */
  const constantFor = (node) => {
    const name = node[INLINED_FROM];
    if (!name || !B || !TG) return null;
    const baseName = alignOT.vars.constants?.back(name);
    const targetName = baseName && alignTG.vars.constants?.get(baseName);
    const baseInit = baseName && B.inlined.get(baseName)?.init;
    const targetInit = targetName && TG.inlined.get(targetName)?.init;
    if (!baseInit || !targetInit) return null;
    const own = literalKey(node);
    if (own !== literalKey(baseInit) || literalKey(targetInit) === own) return null;
    return targetInit;
  };
  return { rename, renamePrivate, constantFor };
}

/**
 * True for nodes inside the target's own top-level statements (those without a counterpart in
 * the base: this project's additions when the target is src/). An inlined copy counts where it
 * is read.
 */
export function createOwnCode(TG, alignTG) {
  const ranges = TG.body
    .filter((statement) => !alignTG.back.has(statement))
    .map((statement) => statement.range);
  return (node) => {
    const offset = (node[USE_SITE] ?? node).range?.[0];
    return offset !== undefined && ranges.some(([start, end]) => offset >= start && offset < end);
  };
}

export function mergeIntoText({ B, TG, OT, alignTG, alignOT, otIsTheirs }) {
  const plan = planMerge({ B, TG, OT, alignTG, alignOT, otIsTheirs });
  const overlay = new Overlay(TG);
  for (const operation of plan.ops) overlay.apply(operation);
  const locate = (node) => {
    const own = node[ORIGIN] ?? node;
    return typeof own.start === "number"
      ? { file: TG.label, text: TG.source, start: own.start, end: own.end }
      : null;
  };
  const missing = [];
  const { rename, renamePrivate, constantFor } = createRenamers({
    B,
    TG,
    OT,
    alignTG,
    alignOT,
    missing,
  });
  const renderer = createRenderer({
    target: TG,
    other: OT,
    constantFor,
    ownCode: createOwnCode(TG, alignTG),
    overlay,
    locate,
    rename,
    renamePrivate,
  });
  const remote = renderer.remoteEdits({ applyWhileCopying: true });
  const text = renderer.render(TG.program);
  return { text, plan, overlay, stats: renderer.stats, remote, missing };
}
