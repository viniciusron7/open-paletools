// Writes a merge plan (merge.mjs, TG = the build of src/, OT = the new release) into src/.
//
// The build (scripts/build.mjs) concatenates the modules of src/manifest.json between
// `// #region <path>` / `// #endregion <path>` comments, with their imports removed and `export`
// dropped, and inlines the embedded resources as constants of the "embedded resources" region.
// `mapBuildToSources` pairs every node of the build with the node of src/ it came from (same
// shape, other positions), so the renderer (render.mjs) can patch the module files themselves:
//   * changed top-level statements are rewritten in their module (patched in place when possible,
//     keeping comments and layout);
//   * new statements are inserted in the module of the statement they follow;
//   * removed statements are deleted (with the comment block right above them);
//   * moved statements move; a whole module that moves moves in the manifest instead;
//   * a changed embedded resource (CSS, images, data) is written to its file; a changed
//     translation table (read once, inlined) is patched where it is declared (src/i18n/).
// Imports and exports are then fixed by fix-links.mjs.
import fs from "node:fs";
import path from "node:path";
import { findModuleFactory, parseModule, parseScript, walk } from "../../lib/ast.mjs";
import { ASSET_TYPES, assetType, readManifest } from "../../lib/modules.mjs";
import { declaredTopVariables, nodeKeys } from "./align.mjs";
import { INLINED_DECLARATION, ORIGIN, RAW } from "./program.mjs";
import { createRenderer, Overlay } from "./render.mjs";
import { createOwnCode, createRenamers } from "./whole-text.mjs";

const keyOf = (node) => `${node.type}:${node.start}:${node.end}`;

/**
 * Pairs the nodes of a build of src/ with the nodes of the module files.
 * Returns { locate(buildNode), statementOf(rawBuildStatement), modules: Map(path -> { text,
 * program, statements: [{ outer, inner }] }), assets: Map(key of an initializer -> asset path) }.
 */
export function mapBuildToSources(buildSource, root, mainModuleId = 723) {
  const program = parseScript(buildSource);
  const factory = findModuleFactory(program, mainModuleId);
  if (!factory) throw new Error("the build has no main module");
  const markers = [...buildSource.matchAll(/\/\/ #(region|endregion) (.+)$/gm)].map((match) => ({
    kind: match[1],
    name: match[2].trim(),
    index: match.index,
  }));
  const regionAt = (offset) => {
    const stack = [];
    for (const marker of markers) {
      if (marker.index > offset) break;
      if (marker.kind === "region") stack.push(marker.name);
      else stack.pop();
    }
    return stack.at(-1) ?? null;
  };
  const byRegion = new Map();
  for (const statement of factory.body.body) {
    const region = regionAt(statement.start);
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region).push(statement);
  }
  const nodes = new Map(); // key of a build node -> { file, node }
  const modules = new Map();
  const statementInfo = new Map(); // key of a raw build statement -> { file, outer, inner }
  const assets = new Map(); // key of a resource initializer -> asset path
  for (const [region, statements] of byRegion) {
    if (region === null) continue;
    if (region === "embedded resources") {
      for (const statement of statements) {
        const before = buildSource.slice(0, statement.start);
        const comment = before.match(/\/\/ (src\/\S+)\s*$/);
        const declarator = statement.declarations?.[0];
        if (comment && declarator?.init) {
          assets.set(keyOf(declarator.init), comment[1]);
          statementInfo.set(keyOf(statement), { file: comment[1], asset: true });
        }
      }
      continue;
    }
    const file = region;
    const text = fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
    const moduleProgram = parseModule(text);
    const sourceStatements = moduleProgram.body
      .filter((statement) => statement.type !== "ImportDeclaration")
      .map((statement) => ({
        outer: statement,
        inner: statement.type === "ExportNamedDeclaration" ? statement.declaration : statement,
      }));
    if (sourceStatements.length !== statements.length)
      throw new Error(
        `${file}: ${sourceStatements.length} statements in src/, ${statements.length} in the build`,
      );
    modules.set(file, { text, program: moduleProgram, statements: sourceStatements });
    statements.forEach((statement, index) => {
      const { outer, inner } = sourceStatements[index];
      statementInfo.set(keyOf(statement), { file, outer, inner });
      pairNodes(statement, inner, file);
    });
  }
  function pairNodes(buildNode, sourceNode, file) {
    if (!buildNode || !sourceNode || buildNode.type !== sourceNode.type)
      throw new Error(
        `${file}: the build and src/ differ at ${sourceNode?.loc?.start.line ?? "?"} (${buildNode?.type} vs ${sourceNode?.type})`,
      );
    nodes.set(keyOf(buildNode), { file, node: sourceNode });
    for (const key of nodeKeys(buildNode)) {
      const a = buildNode[key];
      const b = sourceNode[key];
      if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length)
          throw new Error(`${file}: list ${key} differs between the build and src/`);
        a.forEach((item, index) => item && pairNodes(item, b[index], file));
      } else if (a && typeof a === "object") pairNodes(a, b, file);
    }
  }
  const locate = (node) => {
    const own = node[ORIGIN] ?? node;
    if (typeof own.start !== "number") return null;
    const key = keyOf(own);
    const asset = assets.get(key);
    if (asset)
      return { file: asset, asset: true, text: buildSource, start: own.start, end: own.end };
    const found = nodes.get(key);
    if (!found) return null;
    const { text } = modules.get(found.file);
    return { file: found.file, text, start: found.node.start, end: found.node.end };
  };
  const statementOf = (rawStatement) =>
    typeof rawStatement.start === "number" ? statementInfo.get(keyOf(rawStatement)) : undefined;
  return { locate, statementOf, modules, assets };
}

/** Start of the comment block right above a statement (no blank line in between). */
export function leadingCommentStart(text, start) {
  let position = start;
  for (;;) {
    // Whitespace back to the previous line, at most one line break (no blank line).
    let cursor = position;
    while (cursor > 0 && (text[cursor - 1] === " " || text[cursor - 1] === "\t")) cursor--;
    if (cursor > 0 && text[cursor - 1] === "\n") cursor--;
    while (cursor > 0 && (text[cursor - 1] === " " || text[cursor - 1] === "\t")) cursor--;
    if (cursor === position && position !== start) return position;
    let commentStart = -1;
    if (text.slice(cursor - 2, cursor) === "*/") {
      commentStart = text.lastIndexOf("/*", cursor - 2);
    } else {
      const lineStart = text.lastIndexOf("\n", cursor - 1) + 1;
      const line = text.slice(lineStart, cursor);
      const slashes = line.indexOf("//");
      if (slashes >= 0 && line.slice(0, slashes).trim() === "") commentStart = lineStart + slashes;
    }
    if (commentStart < 0) return position;
    const lineStart = text.lastIndexOf("\n", commentStart - 1) + 1;
    if (text.slice(lineStart, commentStart).trim() !== "") return position;
    position = lineStart;
  }
}

function decodeAssetValue(file, value) {
  const type = assetType(file);
  if (!type) throw new Error(`unsupported resource ${file}`);
  if (type.kind === "text") return Buffer.from(value, "utf8");
  if (type.kind === "base64") return Buffer.from(value, "base64");
  const comma = value.indexOf(",");
  if (!value.startsWith("data:") || comma < 0) throw new Error(`${file}: not a data URI`);
  return Buffer.from(value.slice(comma + 1), "base64");
}

function literalValue(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0].value.cooked;
  return null;
}

/**
 * Applies the plan (TG = O, the build of src/; OT = T, the new release) to the files of src/.
 * Writes nothing when `dryRun`. Returns { files: Map(path -> new content), manifest (new module
 * list or null), notes, problems, stats }.
 */
export function applyPlanToSources({
  root,
  B = null,
  O,
  T,
  alignO,
  alignT,
  plan,
  releaseVersion = null,
  dryRun = false,
}) {
  const mapping = mapBuildToSources(O.source, root, O.moduleId);
  const overlay = new Overlay(O);
  for (const operation of plan.ops) overlay.apply(operation);
  const missing = [];
  const { rename, renamePrivate, constantFor } = createRenamers({
    B,
    TG: O,
    OT: T,
    alignTG: alignO,
    alignOT: alignT,
    missing,
  });
  const renderer = createRenderer({
    target: O,
    other: T,
    constantFor,
    ownCode: createOwnCode(O, alignO),
    overlay,
    locate: mapping.locate,
    rename,
    renamePrivate,
  });
  const notes = [];
  const problems = [];
  const edits = new Map(); // file -> [[start, end, text]]
  const addEdit = (file, start, end, text) => {
    if (!edits.has(file)) edits.set(file, []);
    edits.get(file).push([start, end, text]);
  };
  const assetWrites = new Map();

  // 1. Inlined constants changed at their declaration (translations, resources).
  for (const edit of renderer.remoteEdits()) {
    if (edit.location.asset) {
      const value = literalValue(edit.replacement);
      if (value === null) {
        problems.push(
          `${edit.location.file}: the new value is not a plain string; port it by hand`,
        );
        continue;
      }
      assetWrites.set(edit.location.file, decodeAssetValue(edit.location.file, value));
      notes.push(`resource ${edit.location.file} updated`);
    } else addEdit(edit.location.file, edit.location.start, edit.location.end, edit.text);
  }

  // 2. Top-level statements.
  const body = O.factory.body;
  const original = body.body;
  const current = overlay.value(body, "body");
  const inCurrent = new Set(current);
  const groups = new Map(); // raw build statement -> normalized pieces (in order)
  for (const statement of original) {
    const raw = statement[RAW] ?? statement;
    if (!groups.has(raw)) groups.set(raw, []);
    groups.get(raw).push(statement);
  }
  const moved = new Set(original.filter((statement) => overlay.inserted.has(statement)));
  const removals = new Map(); // raw build statement -> { file, start, end, changed, inner }
  for (const [raw, pieces] of groups) {
    const info = mapping.statementOf(raw);
    const removed = pieces.filter((piece) => !inCurrent.has(piece) || moved.has(piece));
    const changed = pieces.some((piece) => overlay.isChanged(piece) || overlay.replaced.has(piece));
    if (!removed.length && !changed) continue;
    if (!info || info.asset) {
      if (pieces.some((piece) => !piece[INLINED_DECLARATION]))
        problems.push(
          `a changed statement has no place in src/: ${O.source.slice(raw.start, raw.start + 80)}`,
        );
      continue;
    }
    const { file, outer, inner } = info;
    const { text } = mapping.modules.get(file);
    if (removed.length === pieces.length) {
      const start = leadingCommentStart(text, outer.start);
      let end = outer.end;
      while (text[end] === "\n" && text[end + 1] === "\n") end++;
      // Added in step 4, unless the statement moves with its whole module (step 3).
      removals.set(raw, { file, start, end, changed, inner });
      continue;
    }
    const kept = pieces.filter((piece) => !removed.includes(piece));
    const replacement =
      kept.length === 1 && kept[0] === raw
        ? renderer.render(raw)
        : kept.map((piece) => renderer.render(piece)).join("\n");
    addEdit(file, inner.start, inner.end, replacement);
  }

  // 3. New and moved statements, after the statement they follow. The order of the top-level
  // statements is the evaluation order, so a statement is placed right after its predecessor:
  //   * a large run of new statements at the end of a module goes into a new module, listed
  //     right after it in the manifest (src/upstream-new/<version>/);
  //   * a moved run that is a whole module moves in the manifest;
  //   * a new function (hoisted: its place does not matter) of a small run goes to the module
  //     that needs the fewest new imports, without creating an import cycle;
  //   * anything else is inserted after its predecessor, in the predecessor's module.
  const manifestModules = [...readManifest(root).modules];
  const newModules = new Map(); // path -> [texts]
  const goneRaw = new Set();
  for (const [raw, pieces] of groups)
    if (pieces.every((piece) => !inCurrent.has(piece) || moved.has(piece))) goneRaw.add(raw);
  const rawInfo = new Map(); // outer src statement -> raw build statement
  for (const raw of groups.keys()) {
    const info = mapping.statementOf(raw);
    if (info?.outer) rawInfo.set(info.outer, raw);
  }
  const isModuleEnd = (file, outer) => {
    const statements = mapping.modules.get(file)?.statements ?? [];
    const index = statements.findIndex((item) => item.outer === outer);
    return statements
      .slice(index + 1)
      .every((item) => !rawInfo.has(item.outer) || goneRaw.has(rawInfo.get(item.outer)));
  };
  // Import graph of src/ (before the port) and the module that declares each binding of O.
  const importsOf = new Map();
  for (const [file, { program }] of mapping.modules)
    importsOf.set(
      file,
      new Set(
        program.body
          .filter((node) => node.type === "ImportDeclaration")
          .map((node) =>
            path.posix.normalize(path.posix.join(path.posix.dirname(file), node.source.value)),
          ),
      ),
    );
  const reaches = (from, to, seen = new Set()) => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    for (const next of importsOf.get(from) ?? []) if (reaches(next, to, seen)) return true;
    return false;
  };
  const declaringModule = new Map(); // O variable -> file
  for (const [raw, pieces] of groups) {
    const info = mapping.statementOf(raw);
    if (!info?.file || info.asset) continue;
    for (const piece of pieces)
      for (const variable of declaredTopVariables(piece, O))
        declaringModule.set(variable, info.file);
  }
  const modulesNeededBy = (node) => {
    const needed = new Set();
    walk(node, (child) => {
      if (child.type !== "Identifier") return;
      const binding = T.bindings.get(child);
      if (!binding || binding === "global" || !T.topVariables.has(binding)) return;
      const base = alignT.vars.back(binding);
      const counterpart = base && alignO.vars.get(base);
      const file = counterpart && declaringModule.get(counterpart);
      if (file) needed.add(file);
    });
    return needed;
  };
  const bestModuleForFunction = (node, preferred) => {
    const needed = modulesNeededBy(node);
    const candidates = [...new Set([preferred, ...needed].filter(Boolean))];
    let best = null;
    for (const candidate of candidates) {
      if (!mapping.modules.has(candidate)) continue;
      const edges = [...needed].filter(
        (file) => file !== candidate && !importsOf.get(candidate)?.has(file),
      );
      const cycle = edges.some((file) => reaches(file, candidate));
      const score = (cycle ? 1000 : 0) + edges.length + (candidate === preferred ? 0 : 0.5);
      if (!best || score < best.score) best = { candidate, score };
    }
    return best?.candidate ?? preferred;
  };

  const insertions = new Map(); // `${file}@${offset}` -> { file, offset, texts, before }
  const insertAt = (file, offset, text, { before = false } = {}) => {
    const key = `${file}@${offset}`;
    if (!insertions.has(key)) insertions.set(key, { file, offset, texts: [], before });
    insertions.get(key).texts.push(text);
  };
  const renderInserted = (node) => {
    if (!moved.has(node)) return renderer.render(node);
    const info = mapping.statementOf(node[RAW] ?? node);
    if (!info || info.asset || (node[RAW] && node[RAW] !== node)) return renderer.render(node);
    const { text } = mapping.modules.get(info.file);
    const comments = text.slice(leadingCommentStart(text, info.outer.start), info.outer.start);
    const changed = overlay.isChanged(node) || overlay.replaced.has(node);
    const code = changed
      ? text.slice(info.outer.start, info.inner.start) + renderer.render(node)
      : text.slice(info.outer.start, info.outer.end);
    return comments + code;
  };
  const anchorable = (statement) =>
    !statement[INLINED_DECLARATION] && !moved.has(statement) && original.includes(statement);
  const stagingBase = `src/upstream-new/${releaseVersion ?? "release"}`;
  let stagingCount = 0;
  // point: where the next statement goes.
  //   { kind: "after", file, outer, moduleEnd } | { kind: "module", file } (end of a new or
  //   moved module) | { kind: "start" } (before the first statement of src/)
  let point = { kind: "start" };
  let pending = [];
  const pointFile = () => (point.kind === "start" ? manifestModules[0] : point.file);
  const atModuleEnd = () => point.kind === "module" || (point.kind === "after" && point.moduleEnd);
  const placeText = (text) => {
    if (point.kind === "after") insertAt(point.file, point.outer.end, text);
    else if (point.kind === "module") {
      if (newModules.has(point.file)) newModules.get(point.file).push(text);
      else {
        const { text: moduleText } = mapping.modules.get(point.file);
        insertAt(point.file, moduleText.trimEnd().length, text);
      }
    } else {
      const first = mapping.modules.get(manifestModules[0]);
      const start = first.statements[0]?.outer.start ?? first.text.length;
      insertAt(manifestModules[0], leadingCommentStart(first.text, start), text, { before: true });
    }
  };
  const moveModuleAfter = (file, after) => {
    manifestModules.splice(manifestModules.indexOf(file), 1);
    manifestModules.splice(manifestModules.indexOf(after) + 1, 0, file);
  };
  const wholeModuleRun = (run) => {
    const files = new Set(run.map((node) => mapping.statementOf(node[RAW] ?? node)?.file));
    if (files.size !== 1) return null;
    const [file] = files;
    if (!file || !mapping.modules.has(file)) return null;
    const statements = mapping.modules.get(file).statements;
    const outers = new Set(run.map((node) => mapping.statementOf(node[RAW] ?? node).outer));
    return statements.every((item) => outers.has(item.outer)) && outers.size === statements.length
      ? file
      : null;
  };
  const flushPending = () => {
    if (!pending.length) return;
    const runs = [];
    for (const node of pending) {
      const kind = moved.has(node) ? "moved" : "new";
      if (runs.at(-1)?.kind === kind) runs.at(-1).nodes.push(node);
      else runs.push({ kind, nodes: [node] });
    }
    pending = [];
    for (const run of runs) {
      if (run.kind === "moved") {
        const file = wholeModuleRun(run.nodes);
        if (file && atModuleEnd()) {
          moveModuleAfter(file, pointFile());
          // The module keeps its text: no removals, only the changes of its statements.
          for (const node of run.nodes) {
            const raw = node[RAW] ?? node;
            const removal = removals.get(raw);
            removals.delete(raw);
            if (removal?.changed)
              addEdit(file, removal.inner.start, removal.inner.end, renderer.render(raw));
          }
          notes.push(
            `${file} moved in src/manifest.json, after ${pointFile()} (as in the release)`,
          );
          point = { kind: "module", file };
          continue;
        }
        for (const node of run.nodes) placeText(`\n\n${renderInserted(node)}`);
        continue;
      }
      const texts = run.nodes.map((node) => renderInserted(node));
      const lines = texts.reduce((total, text) => total + text.split("\n").length, 0);
      if (atModuleEnd() && (run.nodes.length >= 4 || lines >= 60)) {
        const file = `${stagingBase}/part-${++stagingCount}.js`;
        newModules.set(file, [...texts]);
        manifestModules.splice(manifestModules.indexOf(pointFile()) + 1, 0, file);
        notes.push(`${file}: ${run.nodes.length} new statements of the release (new module)`);
        point = { kind: "module", file };
        continue;
      }
      run.nodes.forEach((node, index) => {
        if (node.type === "FunctionDeclaration" && point.kind !== "start") {
          const target = bestModuleForFunction(node, pointFile());
          if (target !== pointFile()) {
            const { text: moduleText } = mapping.modules.get(target);
            insertAt(target, moduleText.trimEnd().length, `\n\n${texts[index]}`);
            notes.push(`new function ${node.id.name} placed in ${target} (fewest new imports)`);
            return;
          }
        }
        placeText(`\n\n${texts[index]}`);
      });
    }
  };
  for (const statement of current) {
    if (anchorable(statement)) {
      flushPending();
      const info = mapping.statementOf(statement[RAW] ?? statement);
      if (info && !info.asset)
        point = {
          kind: "after",
          file: info.file,
          outer: info.outer,
          moduleEnd: isModuleEnd(info.file, info.outer),
        };
    } else if (!original.includes(statement) || moved.has(statement)) pending.push(statement);
  }
  flushPending();
  for (const { file, start, end } of removals.values()) addEdit(file, start, end, "");
  for (const { file, offset, texts, before } of insertions.values()) {
    const joined = texts.join("");
    addEdit(file, offset, offset, before ? `${joined.replace(/^\n+/, "")}\n\n` : joined);
  }

  // 4. Apply the edits.
  const files = new Map();
  for (const [file, texts] of newModules) {
    const header = `/**\n * Code added by Paletools ${releaseVersion ?? "(new release)"}, placed here by \`npm run upstream:update\`\n * in evaluation order. Move it into a proper module (see docs/UPDATING.md).\n */\n`;
    files.set(file, `${header}${texts.join("\n\n")}\n`);
  }
  for (const [file, list] of edits) {
    if (!list.length) continue;
    const { text } = mapping.modules.get(file);
    list.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    let result = text;
    let limit = Infinity;
    for (const [start, end, replacement] of list) {
      if (end > limit) {
        problems.push(`${file}: overlapping edits at ${start}-${end}; review this module`);
        continue;
      }
      result = result.slice(0, start) + replacement + result.slice(end);
      limit = start;
    }
    files.set(file, result);
  }
  // A file that does not parse would stop every later step: report it instead.
  for (const [file, content] of [...files]) {
    try {
      parseModule(content);
    } catch (error) {
      problems.push(
        `${file}: the ported text does not parse (${error.message}); it was not written`,
      );
      files.delete(file);
    }
  }
  const originalModules = readManifest(root).modules;
  const manifestChanged =
    manifestModules.length !== originalModules.length ||
    manifestModules.some((file, index) => file !== originalModules[index]);
  if (!dryRun) {
    for (const [file, content] of files) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content);
    }
    for (const [file, bytes] of assetWrites) fs.writeFileSync(path.join(root, file), bytes);
    if (manifestChanged) {
      const manifestPath = path.join(root, "src/manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.modules = manifestModules;
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }
  return {
    files,
    assets: assetWrites,
    notes,
    problems,
    missing,
    stats: renderer.stats,
    manifest: manifestChanged ? manifestModules : null,
    newModules: [...newModules.keys()],
  };
}

export { ASSET_TYPES, readManifest, walk };
