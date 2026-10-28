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
import { ORIGIN } from "./program.mjs";
import { createRenderer, indexParents, Overlay } from "./render.mjs";

/** Renames for printing OT nodes into TG: OT binding -> B binding -> TG binding. */
export function createRenamers({ OT, alignTG, alignOT, missing = [] }) {
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
  return { rename, renamePrivate };
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
  const { rename, renamePrivate } = createRenamers({ OT, alignTG, alignOT, missing });
  const renderer = createRenderer({
    target: TG,
    other: OT,
    overlay,
    locate,
    rename,
    renamePrivate,
  });
  const remote = renderer.remoteEdits({ applyWhileCopying: true });
  const text = renderer.render(TG.program);
  return { text, plan, overlay, stats: renderer.stats, remote, missing };
}
