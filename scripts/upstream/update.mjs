#!/usr/bin/env node
// Keeps src/ in sync with the official Paletools releases.
//
//   npm run upstream:check                 is there a release newer than the one src/ follows?
//   npm run upstream:update [-- options]   ports the latest release into src/
//   npm run upstream:verify [-- --finish]  checks src/ against the expected result of the port
//   npm run upstream:status                lists what this project changes in the release
//
// update options: --file <release.user.js> (a downloaded release instead of the latest one),
// --url <url>, --force (also when the release is not newer), --allow-dirty (src/ has uncommitted
// changes), --dry-run (report only, write nothing).
//
// How a port works (see docs/UPDATING.md):
//   1. upstream/base.user.js is the release src/ follows (the "base"). The new release and the
//      base are deobfuscated (deobfuscate.mjs) and src/ is built.
//   2. The three programs are aligned statement by statement (lib/align.mjs) and merged
//      (lib/merge.mjs): the changes from the base to the new release are applied to the build,
//      keeping every change this project made (its own tools, its plugins, its fixes). Where both
//      changed the same code differently there is a conflict, left for a human to resolve.
//   3. The plan is written into the module files of src/ (lib/apply-src.mjs: patches that keep
//      names, comments and layout; new code with the names of the release, `_0x...`), the
//      imports and exports are fixed (lib/fix-links.mjs) and the files are formatted.
//   4. The same merge, applied the other way round (the project's changes into the new release),
//      gives the expected program. The build of the new src/ must be structurally equivalent to
//      it (lib/equivalence.mjs); this is the proof that the port is complete and exact.
//   5. When it is, the new release becomes the base and the boot snapshot is recorded again.
// Work files go to .upstream/<version>/ (not committed): the deobfuscated releases, the expected
// program and report.md, which lists what is left to do by hand.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import prettier from "prettier";
import { bootFingerprint } from "../../tests/support/boot-fingerprint.mjs";
import { buildCheckedUserscript, buildUserscript } from "../build.mjs";
import { checkModules } from "../check-modules.mjs";
import { isMainModule, parseModule } from "../lib/ast.mjs";
import { readManifest, ROOT } from "../lib/modules.mjs";
import { SNAPSHOT_PATH } from "../update-boot-snapshot.mjs";
import { deobfuscate } from "./deobfuscate.mjs";
import { alignTopLevel, cloneAlignment, declaredTopVariables } from "./lib/align.mjs";
import { applyPlanToSources } from "./lib/apply-src.mjs";
import { verifyEquivalence } from "./lib/equivalence.mjs";
import { fixModuleLinks } from "./lib/fix-links.mjs";
import { planMerge } from "./lib/merge.mjs";
import { findMainModuleId, prepareProgram } from "./lib/program.mjs";
import { indexParents } from "./lib/render.mjs";
import { mergeIntoText } from "./lib/whole-text.mjs";
import {
  compareVersions,
  fetchRelease,
  LATEST_RELEASE_URL,
  readMetadata,
  releaseVersion,
  sha256,
} from "./release.mjs";

export const BASE_PATH = "upstream/base.user.js";
export const BASE_INFO_PATH = "upstream/base.json";
export const WORK_DIRECTORY = ".upstream";

/** Metadata keys this project sets itself; the release's values are not ported. */
const OWN_METADATA_KEYS = new Set(["name", "namespace", "version", "updateURL", "downloadURL"]);

const read = (root, file) => fs.readFileSync(path.join(root, file), "utf8");
const write = (root, file, text) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};
const workPath = (directory, file) => `${WORK_DIRECTORY}/${directory}/${file}`;
const VERSION_NAME = /^\d+(\.\d+)*$/;

/** A mistake in the command line (exit code 64). */
export class UsageError extends Error {}

/** Every file and folder an update writes (the dirty check and the undo cover them all). */
export const WRITTEN_PATHS = [
  "src",
  "upstream",
  "package.json",
  "package-lock.json",
  "README.md",
  "tests/userscript",
];

/** The release src/ follows. */
export function readBase(root = ROOT) {
  const source = read(root, BASE_PATH);
  let info = {};
  try {
    info = JSON.parse(read(root, BASE_INFO_PATH));
  } catch {
    // optional
  }
  if (info.sha256 && info.sha256 !== sha256(source))
    throw new Error(
      `${BASE_PATH} is not the release recorded in ${BASE_INFO_PATH} (its SHA-256 differs): restore it with git; never edit it by hand`,
    );
  return { source, version: releaseVersion(source), info };
}

const OPTIONS = {
  check: { url: "value", "exit-code": "flag" },
  update: { file: "value", url: "value", force: "flag", "allow-dirty": "flag", "dry-run": "flag" },
  verify: { finish: "flag", "conflicts-resolved": "flag" },
  status: {},
};

/** Reads the options of a command; unknown options and missing values are errors. */
export function parseOptions(command, args) {
  const known = OPTIONS[command];
  if (!known) throw new UsageError(`unknown command ${command ?? "(none)"}`);
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    const name = argument.startsWith("--") ? argument.slice(2) : null;
    if (!name || !known[name])
      throw new UsageError(
        `${command}: unknown option ${argument} (options: ${
          Object.keys(known)
            .map((key) => `--${key}`)
            .join(", ") || "none"
        })`,
      );
    if (known[name] === "value") {
      const value = args[++index];
      if (value === undefined || value.startsWith("--"))
        throw new UsageError(`${command}: --${name} needs a value`);
      options[name] = value;
    } else options[name] = true;
  }
  return options;
}

async function formatFiles(root, files) {
  for (const file of files) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) || !/\.(m?js|json)$/.test(file)) continue;
    const options = (await prettier.resolveConfig(absolute)) ?? {};
    const text = fs.readFileSync(absolute, "utf8");
    const formatted = await prettier.format(text, { ...options, filepath: absolute });
    if (formatted !== text) fs.writeFileSync(absolute, formatted);
  }
}

/**
 * Uncommitted changes in the files an update writes. `available` is false when git cannot tell
 * (not installed, or not a repository): then nothing protects the user's work.
 */
function uncommittedChanges(root) {
  try {
    const output = execFileSync("git", ["status", "--porcelain", "--", ...WRITTEN_PATHS], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { available: true, dirty: output.split("\n").filter(Boolean) };
  } catch {
    return { available: false, dirty: [] };
  }
}

/** Ports that were written into src/ but not finished (status "ported"). */
function unfinishedPorts(root) {
  const directory = path.join(root, WORK_DIRECTORY);
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => VERSION_NAME.test(name))
    .filter((name) => {
      try {
        return JSON.parse(read(root, workPath(name, "state.json"))).status === "ported";
      } catch {
        return false;
      }
    });
}

// ---------------------------------------------------------------------------------------------
// Metadata block and version
// ---------------------------------------------------------------------------------------------
/** Ports the metadata changes of the release (other than this project's own keys). */
export function portMetadata(headerText, baseSource, releaseSource, newVersion) {
  const lines = (source) =>
    readMetadata(source)
      .filter(({ key }) => !OWN_METADATA_KEYS.has(key))
      .map(({ key, value }) => `${key} ${value ?? ""}`.trim());
  const before = new Set(lines(baseSource));
  const after = new Set(lines(releaseSource));
  const added = [...after].filter((line) => !before.has(line));
  const removed = [...before].filter((line) => !after.has(line));
  let text = headerText.replace(
    /^(\/\/[ \t]*@version[ \t]+)\S+[ \t]*$/m,
    (_, prefix) => `${prefix}${newVersion}`,
  );
  for (const line of removed) {
    const pattern = new RegExp(
      `^//[ \\t]*@${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /, "[ \\t]+")}[ \\t]*\\n`,
      "m",
    );
    text = text.replace(pattern, "");
  }
  for (const line of added) {
    const key = line.split(" ")[0];
    const sameKey = [...text.matchAll(new RegExp(`^//[ \\t]*@${key}\\b.*$`, "gm"))].at(-1);
    const end = /^\/\/[ \t]*==\/UserScript==/m.exec(text);
    const position = sameKey ? sameKey.index + sameKey[0].length + 1 : end.index;
    text = `${text.slice(0, position)}// @${line}\n${text.slice(position)}`;
  }
  text = text.replace(/(based on Paletools )\d+(\.\d+)*/g, `$1${newVersion}`);
  return { text, added, removed };
}

/** Writes the new version everywhere this project shows it. */
function updateVersions(root, version, notes) {
  const replaceIn = (file, transform) => {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) return;
    const text = fs.readFileSync(absolute, "utf8");
    const next = transform(text);
    if (next !== text) {
      fs.writeFileSync(absolute, next);
      notes.push(`${file}: version ${version}`);
    }
  };
  replaceIn("src/config/version.js", (text) =>
    text.replace(/(paletoolsVersion = ")[^"]*(")/, `$1${version}$2`),
  );
  replaceIn("README.md", (text) =>
    text.replace(/(based on Paletools )\d+(\.\d+)*/, `$1${version}`),
  );
  for (const file of ["package.json", "package-lock.json"])
    replaceIn(file, (text) => {
      const json = JSON.parse(text);
      json.version = version;
      if (json.packages?.[""]) json.packages[""].version = version;
      return `${JSON.stringify(json, null, 2)}\n`;
    });
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------
const excerpt = (side, node, length = 400) =>
  node?.range ? side.source.slice(node.range[0], node.range[1]).slice(0, length) : "(none)";

/** A conflict's place: its top-level statement and the last steps of the path inside it. */
function shortPath(fullPath) {
  const top = fullPath.match(/^[^.[]*(\.prototype\.[\w$]+)?/)?.[0] ?? fullPath;
  const inside = fullPath.slice(top.length).split(".").filter(Boolean);
  const tail = inside.length > 3 ? `...${inside.slice(-3).join(".")}` : inside.join(".");
  return `${top.trim().slice(0, 80)}${tail ? ` (${tail})` : ""}`;
}

/** Index in side.body of the top-level statement that contains `node`. */
function topLevelIndex(side, node) {
  if (!node) return null;
  const parents = indexParents(side);
  let current = node;
  for (let up = parents.get(current); up?.parent; up = parents.get(current)) {
    if (up.parent === side.factory.body) return side.body.indexOf(current);
    current = up.parent;
  }
  return null;
}

function conflictEntries(plan, sides) {
  return plan.conflicts.map((conflict, index) => ({
    id: index + 1,
    kind: conflict.kind,
    path: shortPath(conflict.path),
    base: excerpt(sides.B, conflict.base),
    ours: excerpt(sides.O, conflict.target),
    theirs: excerpt(sides.T, conflict.other),
    region: regionOf(sides.O, conflict.target),
    releaseStatement: topLevelIndex(sides.T, conflict.other),
  }));
}

function regionOf(side, node) {
  const offset = node?.range?.[0];
  if (offset === undefined) return null;
  let region = null;
  for (const match of side.source.slice(0, offset).matchAll(/\/\/ #region (\S+)/g))
    region = match[1];
  return region;
}

/** Top-level names of the release (`_0x...`) that the port introduced in src/. */
function obfuscatedNames(root, files) {
  const names = new Map();
  for (const file of files) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) || !file.endsWith(".js")) continue;
    const text = fs.readFileSync(absolute, "utf8");
    const count = (text.match(/\b_0x[0-9a-f]{3,}\b/g) ?? []).length;
    if (count) names.set(file, count);
  }
  return names;
}

function writeReport(root, state) {
  const lines = [];
  const add = (...items) => lines.push(...items);
  add(`# Port of Paletools ${state.from} -> ${state.to}`, "");
  add(`Status: **${state.status}**`, "");
  if (state.verification)
    add(
      `Verification: the build of src/ is ${state.verification.equivalent ? "**equivalent**" : "**NOT equivalent**"} to the expected program (${state.verification.statements?.candidate ?? "?"} statements, ${state.verification.mismatchCount ?? 0} differences).`,
      "",
    );
  add(
    `Plan: ${state.summary.ops} operations (${Object.entries(state.summary.byOp)
      .map(([op, count]) => `${count} ${op}`)
      .join(
        ", ",
      )}), ${state.conflicts.length} conflicts; ${state.summary.files} files written, ${state.summary.assets} resources updated.`,
    "",
  );
  if (state.conflicts.length) {
    add("## Conflicts (resolve by hand)", "");
    add(
      "Both the release and this project changed the code below. src/ kept this project's version of that code (the release's other changes around it were applied). Merge the release's change into it by hand, keeping this project's change. `npm run upstream:verify` leaves the top-level statements with a conflict out of the comparison, so check each one yourself, then finish with `npm run upstream:verify -- --finish --conflicts-resolved`.",
      "",
    );
    for (const conflict of state.conflicts) {
      add(
        `### ${conflict.id}. ${conflict.kind} in ${conflict.region ?? "?"}: ${conflict.path}`,
        "",
      );
      for (const [label, text] of [
        ["base (old release)", conflict.base],
        ["src/ (this project)", conflict.ours],
        ["new release", conflict.theirs],
      ])
        add(`${label}:`, "```js", text, "```", "");
    }
  }
  if (state.verification && !state.verification.equivalent) {
    add("## Differences from the expected program", "");
    for (const mismatch of state.verification.mismatches ?? []) add("```", mismatch, "```");
    add("");
  }
  if (state.checkErrors?.length) {
    add("## Module rule errors (npm run check:modules)", "");
    for (const error of state.checkErrors) add(`- ${error}`);
    add("");
  }
  if (state.problems?.length) {
    add("## Problems", "");
    for (const problem of state.problems) add(`- ${problem}`);
    add("");
  }
  if (state.unresolved?.length) {
    add("## Unresolved identifiers", "");
    for (const item of state.unresolved) add(`- ${item.module}:${item.line} ${item.name}`);
    add("");
  }
  if (state.runtimeChanged?.length) {
    add("## Webpack runtime (outside the main module) changed", "");
    add("Port these changes to src/runtime/webpack-runtime.js by hand:", "");
    for (const mismatch of state.runtimeChanged) add("```", mismatch, "```");
    add("");
  }
  add("## To do by hand (readability; the build already behaves like the release)", "");
  if (state.newModules?.length) {
    add("New modules with the release's new code, in evaluation order:", "");
    for (const file of state.newModules) add(`- ${file}`);
    add(
      "",
      "Move their code into proper modules (e.g. a plugin folder), keeping the evaluation order: a module's place in src/manifest.json is when its top-level code runs.",
      "",
    );
  }
  if (state.obfuscated?.length) {
    add("Files with names of the release (`_0x...`) to rename descriptively:", "");
    for (const [file, count] of state.obfuscated) add(`- ${file} (${count})`);
    add("");
  }
  add(
    "Then run `npm run upstream:verify` (it must stay equivalent), `npm run update:boot-snapshot` if the boot changed, and `npm run verify`.",
    "",
  );
  if (state.notes?.length) {
    add("## Notes", "");
    for (const note of state.notes) add(`- ${note}`);
    add("");
  }
  const directory = state.workDirectory ?? state.to;
  write(root, workPath(directory, "report.md"), `${lines.join("\n")}\n`);
  write(root, workPath(directory, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------
export async function check({ root = ROOT, url = LATEST_RELEASE_URL } = {}) {
  const base = readBase(root);
  const latest = releaseVersion(await fetchRelease(url));
  return { current: base.version, latest, behind: compareVersions(latest, base.version) > 0 };
}

/** Compares the programs outside their main module (the webpack runtime and other modules). */
function runtimeDifferences(baseCode, releaseCode) {
  const blank = (code) => {
    const program = prepareProgram(code, { label: "runtime" });
    const { start, end } = program.factory.body;
    return { code: `${code.slice(0, start)}{}${code.slice(end)}`, id: program.moduleId };
  };
  const a = blank(baseCode);
  const b = blank(releaseCode);
  const result = verifyEquivalence(a.code, b.code, {
    referenceModuleId: a.id,
    candidateModuleId: b.id,
  });
  return result.equivalent ? [] : result.mismatches;
}

export async function update({
  root = ROOT,
  file = null,
  url = LATEST_RELEASE_URL,
  force = false,
  allowDirty = false,
  dryRun = false,
  log = console.log,
} = {}) {
  const base = readBase(root);
  const releaseSource = file ? fs.readFileSync(file, "utf8") : await fetchRelease(url);
  const version = releaseVersion(releaseSource);
  log(
    `src/ follows Paletools ${base.version}; ${file ? file : "the latest release"} is ${version}`,
  );
  if (sha256(releaseSource) === sha256(base.source)) {
    log("src/ already follows this release: nothing to do.");
    return { status: "up-to-date", version: base.version };
  }
  if (compareVersions(version, base.version) <= 0 && !force) {
    log("src/ is up to date: nothing to do.");
    return { status: "up-to-date", version: base.version };
  }
  if (!dryRun) {
    const unfinished = unfinishedPorts(root);
    if (unfinished.length && !force)
      throw new Error(
        `the port to ${unfinished.join(", ")} is not finished: resolve its report (.upstream/${unfinished[0]}/report.md) and run npm run upstream:verify -- --finish (with --conflicts-resolved if it had conflicts), or undo it with git (docs/UPDATING.md, Troubleshooting) and delete .upstream/${unfinished[0]}/ before porting again`,
      );
    if (!allowDirty) {
      const { available, dirty } = uncommittedChanges(root);
      if (!available)
        throw new Error(
          "git cannot tell whether your work is committed (git is missing, or this folder is not a repository). The update rewrites src/; pass --allow-dirty to run it anyway.",
        );
      if (dirty.length)
        throw new Error(
          `${dirty.length} files the update writes have uncommitted changes (${WRITTEN_PATHS.join(", ")}). Commit or stash them first, so that you can review and undo the port with git, or pass --allow-dirty.`,
        );
    }
  }
  // A dry run keeps its files apart, so that it never replaces the files of a real port.
  const work = dryRun ? `${version}/dry-run` : version;

  log("deobfuscating the releases...");
  const [baseDeobfuscated, releaseDeobfuscated] = await Promise.all([
    deobfuscate(base.source),
    deobfuscate(releaseSource),
  ]);
  write(root, workPath(work, "release.user.js"), releaseSource);
  write(root, workPath(work, "base.deobfuscated.js"), baseDeobfuscated.code);
  write(root, workPath(work, "release.deobfuscated.js"), releaseDeobfuscated.code);

  log("building src/ and aligning the three programs...");
  const oursSource = await buildCheckedUserscript(root);
  write(root, workPath(work, "src-before.user.js"), oursSource);
  const keep = { keepInlinedDeclarations: true };
  const B = prepareProgram(baseDeobfuscated.code, { label: "base", ...keep });
  const T = prepareProgram(releaseDeobfuscated.code, { label: "release", ...keep });
  const O = prepareProgram(oursSource, { label: "src", ...keep });
  const alignO = alignTopLevel(B, O);
  const alignT = alignTopLevel(B, T);

  log("merging...");
  // Each merge learns more binding correspondences: give each its own copy of the alignments.
  const portO = cloneAlignment(alignO);
  const portT = cloneAlignment(alignT);
  const plan = planMerge({ B, TG: O, OT: T, alignTG: portO, alignOT: portT, otIsTheirs: true });
  const expected = mergeIntoText({
    B,
    TG: T,
    OT: O,
    alignTG: cloneAlignment(alignT),
    alignOT: cloneAlignment(alignO),
    otIsTheirs: false,
  });
  write(root, workPath(work, "expected.user.js"), expected.text);
  const byOp = {};
  for (const operation of plan.ops) byOp[operation.op] = (byOp[operation.op] ?? 0) + 1;
  const conflicts = conflictEntries(plan, { B, O, T });
  const runtimeChanged = runtimeDifferences(baseDeobfuscated.code, releaseDeobfuscated.code);
  const state = {
    from: base.version,
    to: version,
    origin: file ? path.basename(file) : url,
    workDirectory: work,
    status: "planned",
    summary: { ops: plan.ops.length, byOp, files: 0, assets: 0 },
    conflicts,
    runtimeChanged,
    notes: [],
    problems: [],
  };
  if (dryRun) {
    state.status = "dry-run";
    writeReport(root, state);
    log(
      `dry run: ${plan.ops.length} operations, ${conflicts.length} conflicts; see ${workPath(work, "report.md")}`,
    );
    return state;
  }

  log("writing src/...");
  const applied = applyPlanToSources({
    root,
    O,
    T,
    alignO: portO,
    alignT: portT,
    plan,
    releaseVersion: version,
  });
  const releaseGlobals = new Set(
    T.scopeManager.globalScope.through.map((ref) => ref.identifier.name),
  );
  const links = fixModuleLinks(root, { newGlobals: releaseGlobals });
  const header = portMetadata(
    read(root, "src/userscript-header.js"),
    base.source,
    releaseSource,
    version,
  );
  write(root, "src/userscript-header.js", header.text);
  for (const line of header.added) state.notes.push(`metadata added: // @${line}`);
  for (const line of header.removed) state.notes.push(`metadata removed: // @${line}`);
  updateVersions(root, version, state.notes);
  const written = [
    ...new Set([
      ...applied.files.keys(),
      ...links.changed,
      ...(applied.manifest ? ["src/manifest.json"] : []),
      ...(links.externalChanged ? ["src/external-globals.json"] : []),
      "src/userscript-header.js",
      "src/config/version.js",
    ]),
  ];
  await formatFiles(root, written);
  state.summary.files = applied.files.size;
  state.summary.assets = applied.assets.size;
  state.notes.push(...applied.notes, ...links.notes);
  state.problems.push(...applied.problems);
  for (const item of applied.missing)
    state.problems.push(
      `the release uses ${item.name}, which src/ no longer has (${item.base} in the base)`,
    );
  state.unresolved = links.unresolved;
  state.newModules = applied.newModules;
  state.obfuscated = [...obfuscatedNames(root, written)];
  state.checkErrors = checkModules(root).errors;
  state.status = "ported";

  // state.json first: the verification reads the conflicts from it.
  writeReport(root, state);
  log("verifying...");
  const verification = await verifySources({ root, version });
  state.verification = verification;
  const clean =
    verification.equivalent &&
    !conflicts.length &&
    !state.checkErrors.length &&
    !runtimeChanged.length &&
    !state.problems.length;
  for (const modulePath of readManifest(root).modules) {
    const program = parseModule(read(root, modulePath));
    if (!program.body.some((node) => node.type !== "ImportDeclaration"))
      state.notes.push(
        `${modulePath} has no code left: delete it and remove it from src/manifest.json`,
      );
  }
  if (clean) {
    await finish({ root, version, releaseSource, origin: state.origin, log });
    state.status = "finished";
  }
  writeReport(root, state);
  log(
    `${clean ? "done" : "ported, with work left"}: ${plan.ops.length} operations, ${conflicts.length} conflicts, ${state.checkErrors.length} module errors, ${verification.equivalent ? "equivalent" : `${verification.mismatchCount} differences`}.`,
  );
  log(`report: ${workPath(work, "report.md")}`);
  return state;
}

/** Builds src/ and compares it with the expected program of the pending port. */
export async function verifySources({ root = ROOT, version = null } = {}) {
  const target = version ?? pendingVersion(root);
  if (!target) throw new Error("no port in progress (run npm run upstream:update first)");
  const expectedPath = path.join(root, workPath(target, "expected.user.js"));
  if (!fs.existsSync(expectedPath))
    throw new Error(`${workPath(target, "expected.user.js")} not found`);
  const expected = fs.readFileSync(expectedPath, "utf8");
  const built = await buildUserscript(root);
  const holes = conflictHoles(root, target, expected);
  const result = verifyEquivalence(expected, built, { holes, maxMismatches: 30 });
  let conflicts = [];
  try {
    conflicts = JSON.parse(read(root, workPath(target, "state.json"))).conflicts ?? [];
  } catch {
    // no state
  }
  return {
    version: target,
    equivalent: result.equivalent,
    mismatchCount: result.mismatchCount ?? result.mismatches.length,
    mismatches: result.mismatches,
    statements: result.statements,
    holesUsed: result.holesUsed,
    conflicts,
  };
}

/**
 * Conflicting statements are not compared: the expected program has the release's version and
 * src/ the hand-merged one. They are the top-level statements of the expected program that hold
 * a conflict (found by aligning it with the release).
 */
function conflictHoles(root, version, expected) {
  let state;
  try {
    state = JSON.parse(read(root, workPath(version, "state.json")));
  } catch {
    return [];
  }
  if (!state.conflicts?.length) return [];
  const release = prepareProgram(read(root, workPath(version, "release.deobfuscated.js")), {
    label: "release",
    keepInlinedDeclarations: true,
  });
  const target = prepareProgram(expected, { label: "expected" });
  const alignment = alignTopLevel(release, target);
  const holes = [];
  for (const conflict of state.conflicts) {
    const statement = release.body[conflict.releaseStatement ?? -1];
    const counterpart = statement && alignment.pairs.get(statement)?.y;
    if (counterpart) holes.push([counterpart.range[0], counterpart.range[1]]);
  }
  return holes;
}

function pendingVersion(root) {
  const directory = path.join(root, WORK_DIRECTORY);
  if (!fs.existsSync(directory)) return null;
  const candidates = fs
    .readdirSync(directory)
    .filter((name) => VERSION_NAME.test(name))
    .filter((name) => fs.existsSync(path.join(directory, name, "state.json")))
    .map((name) => ({
      name,
      state: JSON.parse(fs.readFileSync(path.join(directory, name, "state.json"), "utf8")),
    }))
    .filter(({ state }) => state.status !== "dry-run");
  candidates.sort((a, b) => compareVersions(b.name, a.name));
  return candidates[0]?.name ?? null;
}

/** Records the new release as the base of src/ and the new boot snapshot. */
export async function finish({
  root = ROOT,
  version,
  releaseSource = null,
  origin = null,
  log = console.log,
}) {
  const source = releaseSource ?? read(root, workPath(version, "release.user.js"));
  if (releaseVersion(source) !== version)
    throw new Error(`the saved release is not Paletools ${version}`);
  let previous = {};
  try {
    previous = JSON.parse(read(root, workPath(version, "state.json")));
  } catch {
    // no state: a port made by hand
  }
  write(root, BASE_PATH, source);
  write(
    root,
    BASE_INFO_PATH,
    `${JSON.stringify(
      {
        version,
        sha256: sha256(source),
        // Where Paletools publishes its releases; `file` when this one came from a local file.
        source: LATEST_RELEASE_URL,
        ...(/^https?:/.test(origin ?? previous.origin ?? "https:")
          ? {}
          : { file: origin ?? previous.origin }),
      },
      null,
      2,
    )}\n`,
  );
  const built = await buildCheckedUserscript(root);
  const fingerprint = await bootFingerprint(built);
  write(
    root,
    SNAPSHOT_PATH,
    `${JSON.stringify({ note: `recorded after the port of Paletools ${version}`, ...fingerprint }, null, 2)}\n`,
  );
  const statePath = workPath(version, "state.json");
  if (fs.existsSync(path.join(root, statePath))) {
    const state = JSON.parse(read(root, statePath));
    state.status = "finished";
    write(root, statePath, `${JSON.stringify(state, null, 2)}\n`);
  }
  log(
    `${BASE_PATH} is now Paletools ${version}; ${SNAPSHOT_PATH} recorded again (review its diff).`,
  );
}

/**
 * This project's changes relative to the release it follows: the merge of the build of src/
 * into the base itself, i.e. the operations that turn the base into src/, by module.
 */
export async function status({ root = ROOT } = {}) {
  const base = readBase(root);
  const { code } = await deobfuscate(base.source);
  const built = await buildUserscript(root);
  const B = prepareProgram(code, { label: "base", keepInlinedDeclarations: true });
  const O = prepareProgram(built, { label: "src", keepInlinedDeclarations: true });
  const alignO = alignTopLevel(B, O);
  const plan = planMerge({
    B,
    TG: B,
    OT: O,
    alignTG: alignTopLevel(B, B),
    alignOT: alignO,
    otIsTheirs: false,
  });
  const line = (side, node) =>
    node?.range
      ? side.source.slice(node.range[0], node.range[1]).replace(/\s+/g, " ").slice(0, 110)
      : "";
  const changes = [];
  for (const operation of plan.ops) {
    switch (operation.op) {
      case "insert":
        for (const node of operation.nodes)
          changes.push({ module: regionOf(O, node), what: "added", text: line(O, node) });
        break;
      case "remove": {
        // The module of src/ that holds the base statement around the removed node.
        const index = topLevelIndex(B, operation.node);
        const top = index === null ? null : B.body[index];
        const counterpart = top && alignO.pairs.get(top)?.y;
        changes.push({
          module: counterpart ? regionOf(O, counterpart) : "(removed statements of the release)",
          what: "removed",
          text: line(B, operation.node),
        });
        break;
      }
      case "replace":
        changes.push({
          module: regionOf(O, operation.with),
          what: "changed",
          text: `${line(B, operation.node)}  ->  ${line(O, operation.with)}`,
        });
        break;
      case "setChild":
        changes.push({
          module: regionOf(O, operation.value),
          what: "changed",
          text: `${operation.path}: ${line(O, operation.value) || "(removed)"}`,
        });
        break;
      case "move":
        changes.push({ module: null, what: "moved", text: line(B, operation.node) });
        break;
      default:
        break;
    }
  }
  return { version: base.version, changes, conflicts: plan.conflicts.length };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  let options;
  try {
    options = parseOptions(command, rest);
  } catch (error) {
    console.error(error.message);
    console.error(
      "usage: node scripts/upstream/update.mjs <check | update | verify | status> [options] (with npm: npm run upstream:update -- --dry-run)",
    );
    process.exitCode = 64;
    return;
  }
  switch (command) {
    case "check": {
      const result = await check({ url: options.url ?? LATEST_RELEASE_URL });
      console.log(
        result.behind
          ? `Paletools ${result.latest} is out; src/ follows ${result.current}. Run npm run upstream:update (or /update-paletools in Claude Code).`
          : `src/ follows Paletools ${result.current}, the latest release.`,
      );
      if (result.behind && options["exit-code"]) process.exitCode = 10;
      break;
    }
    case "update": {
      const state = await update({
        file: options.file ?? null,
        url: options.url ?? LATEST_RELEASE_URL,
        force: Boolean(options.force),
        allowDirty: Boolean(options["allow-dirty"]),
        dryRun: Boolean(options["dry-run"]),
      });
      if (state.status === "ported") process.exitCode = 2;
      break;
    }
    case "verify": {
      const version = pendingVersion(ROOT);
      const result = await verifySources({ version });
      if (result.equivalent) {
        console.log(
          `src/ is equivalent to the expected program of the port to ${version} (${result.statements.candidate} statements).`,
        );
      } else {
        console.error(`src/ is NOT equivalent to the expected program of the port to ${version}:`);
        for (const mismatch of result.mismatches) console.error(`- ${mismatch}`);
        process.exitCode = 1;
      }
      if (result.conflicts.length) {
        console.log(
          `${result.conflicts.length} conflicts are NOT verified: their top-level statements are left out of the comparison, so check by hand that each keeps this project's change and has the release's (.upstream/${version}/report.md):`,
        );
        for (const conflict of result.conflicts)
          console.log(
            `  ${conflict.id}. ${conflict.kind} in ${conflict.region ?? "?"}: ${conflict.path}`,
          );
      }
      if (options.finish && result.equivalent) {
        if (result.conflicts.length && !options["conflicts-resolved"]) {
          console.error(
            "not finished: the port has conflicts. Once you checked each of them, run npm run upstream:verify -- --finish --conflicts-resolved",
          );
          process.exitCode = 1;
        } else await finish({ version });
      }
      break;
    }
    case "status": {
      const result = await status();
      console.log(
        `src/ follows Paletools ${result.version}. This project changes it in ${result.changes.length} places:`,
      );
      const byModule = new Map();
      for (const change of result.changes) {
        const key = change.module ?? "(evaluation order)";
        if (!byModule.has(key)) byModule.set(key, []);
        byModule.get(key).push(change);
      }
      for (const [module, changes] of byModule) {
        console.log(`\n${module}`);
        const counted = new Map();
        for (const change of changes) {
          const key = `${change.what}: ${change.text}`;
          counted.set(key, (counted.get(key) ?? 0) + 1);
        }
        for (const [key, count] of counted)
          console.log(`  ${count > 1 ? key.replace(": ", ` (${count}x): `) : key}`);
      }
      break;
    }
    default:
      console.error(
        "usage: node scripts/upstream/update.mjs <check | update | verify | status> [options]",
      );
      process.exitCode = 64;
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export { findMainModuleId, declaredTopVariables };
