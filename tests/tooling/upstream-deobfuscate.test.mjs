// Tests of scripts/upstream/deobfuscate.mjs: the base release and a small synthetic release in
// the same obfuscator layout. Only the tests run the fixture (in node:vm, to compare its behaviour
// before and after); the deobfuscator itself never executes its input.
//
// The base release (upstream/base.user.js) is replaced by every port, so its tests check what
// holds for any release; its version comes from upstream/base.json (else from the file), and
// UPSTREAM_BASE_PATH runs them on another release (see tests/support/upstream-fixtures.mjs). The
// exact counts of one release are checked on the saved copy of 27.1.5 (versoes_paletools/).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import vm from "node:vm";
import { generate } from "astring";
import { analyze } from "eslint-scope";
import { findModuleFactory, parseScript, walk } from "../../scripts/lib/ast.mjs";
import { ROOT } from "../../scripts/lib/modules.mjs";
import { applyEdits, deobfuscate, formatCode } from "../../scripts/upstream/deobfuscate.mjs";
import { findMainModuleId, prepareProgram } from "../../scripts/upstream/lib/program.mjs";
import { findMetadataBlock } from "../../scripts/upstream/release.mjs";
import { readBaseRelease, savedRelease } from "../support/upstream-fixtures.mjs";

const run = promisify(execFile);

// ---------------------------------------------------------------------------
// The base release
// ---------------------------------------------------------------------------
const baseRelease = readBaseRelease();
const baseSource = baseRelease.source;
const base = await deobfuscate(baseSource);
const baseOutput = parseScript(base.code, { locations: false });
const mainModuleId = findMainModuleId(baseOutput);
const globalsUsed = (program) =>
  new Set(
    analyze(program, { ecmaVersion: 2022, sourceType: "script" }).globalScope.through.map(
      (reference) => reference.identifier.name,
    ),
  );

test(`the base release (${baseRelease.label}) is Paletools ${baseRelease.version}`, () => {
  assert.equal(base.version, baseRelease.version);
});

test(`Paletools is webpack module ${mainModuleId} of the base release, the largest one`, () => {
  assert(Number.isInteger(mainModuleId), "the module table has numeric keys");
  assert.equal(base.mainModuleId, mainModuleId);
  const factory = findModuleFactory(baseOutput, mainModuleId);
  assert(factory, `module ${mainModuleId} exists`);
  assert.equal(factory.body.type, "BlockStatement");
  assert(factory.end - factory.start > base.code.length / 2, "it holds most of the code");
  assert.equal(prepareProgram(base.code).moduleId, mainModuleId);
  // The obfuscated release has the same main module (its keys are hexadecimal numbers).
  assert.equal(findMainModuleId(parseScript(baseSource, { locations: false })), mainModuleId);
});

test("the deobfuscated base release keeps the metadata block at the top", () => {
  const block = findMetadataBlock(baseSource);
  assert.equal(block.start, 0);
  assert(base.code.startsWith(`${block.text}\n\n(() => {\n`));
});

test("the string array machinery of the base release is gone", () => {
  const input = parseScript(baseSource, { locations: false });
  const machinery = input.body.filter((statement) => statement.type === "FunctionDeclaration");
  assert.equal(machinery.length, 2, "the string table and its decoder");
  // The table holds every string of the release in one array literal.
  const tables = machinery.filter((statement) => {
    let found = false;
    walk(statement, (node) => {
      if (
        node.type === "ArrayExpression" &&
        node.elements.length === base.stats.strings &&
        node.elements.every((element) => element?.type === "Literal")
      )
        found = true;
      return !found;
    });
    return found;
  });
  assert.equal(tables.length, 1, `one function holds the ${base.stats.strings} strings`);
  // One statement remains: the webpack bootstrap, without the rotation IIFE before it.
  assert.equal(input.body.length, 3);
  assert.equal(baseOutput.body.length, 1);
  assert.equal(baseOutput.body[0].expression.type, "CallExpression");
  for (const { id } of machinery)
    assert(!new RegExp(`\\b${id.name}\\b`).test(base.code), `${id.name} is not referenced`);
  // Removing the decoder and its aliases left no dangling reference: no new global is used.
  const before = globalsUsed(input);
  assert.deepEqual(
    [...globalsUsed(baseOutput)].filter((name) => !before.has(name)),
    [],
  );
});

test("the base release has no hexadecimal number, !0/!1 or obj['name'] left", () => {
  let hex = 0;
  let booleans = 0;
  let members = 0;
  walk(baseOutput, (node) => {
    if (node.type === "Literal" && /^0x/i.test(node.raw ?? "")) hex++;
    if (
      node.type === "UnaryExpression" &&
      node.operator === "!" &&
      node.argument.type === "Literal"
    )
      booleans += typeof node.argument.value === "number" ? 1 : 0;
    if (
      node.type === "MemberExpression" &&
      node.computed &&
      node.property.type === "Literal" &&
      /^[A-Za-z_$][\w$]*$/.test(String(node.property.value)) &&
      typeof node.property.value === "string" &&
      !(node.object.type === "Literal" && typeof node.object.value === "number")
    )
      members++;
    return true;
  });
  assert.deepEqual({ hex, booleans, members }, { hex: 0, booleans: 0, members: 0 });
});

test("the counts of the base release are consistent", () => {
  const { stats } = base;
  assert.equal(stats.verified, true, "the self-check ran and passed");
  for (const key of ["strings", "offset", "rotations", "decoderCalls", "aliases", "removals"])
    assert(Number.isInteger(stats[key]) && stats[key] >= 0, `${key}: ${stats[key]}`);
  assert(stats.strings > 0 && stats.decoderCalls > 0 && stats.aliases > 0);
  assert(stats.rotations < stats.strings, "a rotation count is below the table size");
  // The table, the decoder and the rotation, plus the alias declarations (several aliases may
  // share one declaration, removed whole).
  assert(stats.removals > 3 && stats.removals <= stats.aliases + 3, `${stats.removals} removals`);
  const kinds = stats.rewriteKinds;
  assert.deepEqual(Object.keys(kinds).sort(), ["booleans", "members", "numbers", "strings"]);
  assert.equal(stats.rewrites, kinds.booleans + kinds.members + kinds.numbers + kinds.strings);
});

// The counts of the earlier deobfuscator (paletools repository) for the release this project was
// first written from.
const release2715 = savedRelease("27.1.5");

test(
  "the counts of 27.1.5 match those of the earlier deobfuscator (paletools repository)",
  { skip: !release2715 && "versoes_paletools/Paletools-27.1.5.js is not present" },
  async () => {
    const source = fs.readFileSync(release2715, "utf8");
    const result = source === baseSource ? base : await deobfuscate(source);
    assert.equal(result.version, "27.1.5");
    assert.equal(result.mainModuleId, 723);
    assert.deepEqual(result.stats, {
      strings: 2306,
      offset: 116,
      rotations: 264,
      decoderCalls: 12635,
      aliases: 1879,
      removals: 1882,
      rewrites: 19459,
      rewriteKinds: { booleans: 785, numbers: 1733, strings: 231, members: 16710 },
      verified: true,
    });
  },
);

// ---------------------------------------------------------------------------
// A synthetic release
// ---------------------------------------------------------------------------
const OFFSET = 0x64;
// The table as the decoder sees it once rotated; indices OFFSET + i.
const TABLE = [
  "1009", // 0x64  checksum
  "2004", // 0x65  checksum
  "3003", // 0x66  checksum
  "isArray", // 0x67
  "length", // 0x68
  "toString", // 0x69
  "push", // 0x6a
  "items", // 0x6b
  "hello world", // 0x6c
  "value", // 0x6d
  "a-b", // 0x6e
  "4008", // 0x6f  checksum
  "alpha",
  "beta",
  "gamma",
  "delta",
];
const ROTATION = 5;
const checksumOf = (table) =>
  -parseInt(table[0]) / 1 +
  (parseInt(table[1]) / 2) * (parseInt(table[2]) / 3) +
  parseInt(table[11]) / 4;
const TARGET = checksumOf(TABLE);
// Stored rotated right, so that the loop has to rotate it left ROTATION times.
const STORED = [...TABLE.slice(-ROTATION), ...TABLE.slice(0, -ROTATION)];

const fixture = [
  "// ==UserScript==",
  "// @name Fixture",
  "// @version 1.2.3",
  "// ==/UserScript==",
  "",
  `function a0_dec(_0xi,_0xk){const _0xt=a0_tab();return a0_dec=function(_0xj,_0xu){_0xj=_0xj-0x${OFFSET.toString(16)};let _0xs=_0xt[_0xj];return _0xs;},a0_dec(_0xi,_0xk);}`,
  // The rotation, then the webpack bootstrap in parentheses, as in the minified releases.
  `(function(_0xa,_0xb){const _0xd=a0_dec,_0xr=_0xa();while(!![]){try{const _0xv=-parseInt(_0xd(0x64))/0x1+parseInt(_0xd(0x65))/0x2*(parseInt(_0xd(0x66))/0x3)+parseInt(_0xd(0x6f))/0x4;if(_0xv===_0xb)break;else _0xr['push'](_0xr['shift']());}catch(_0xe){_0xr['push'](_0xr['shift']());}}}(a0_tab,0x${TARGET.toString(16)}),((()=>{var _0xm={0x2a:(_0x1,_0x2,_0x3)=>{'use strict';const _0xa=a0_dec;` +
    // alias first in its declaration, then an alias of an alias at the end; `[(call)]`; `return!0x1`
    `function _0xf(_0xp){const _0xb=_0xa,_0xq=0x1,_0xc=_0xb;if(Array[_0xc(0x67)](_0xp))return _0xp[(_0xb(0x68))]+_0xq;return!0x1;}` +
    // `?.[call]instanceof`, `?!0x0:`, `"value"in`
    `function _0xg(_0xo){const _0xd=_0xa;return _0xo?.[_0xd(0x6b)]instanceof Object?!0x0:_0xd(0x6d)in _0xo;}` +
    // a number object (`0xff["toString"]`), quoted keys, `\\x` escapes, an alias at the end
    `const _0xr=0xff[_0xa(0x69)](0x10),_0xs={'enumerable':!0x0,'label':_0xa(0x6c),'x':'\\x41\\x42','value':0x7,'a-b':0x8},_0xh=_0xa;` +
    `globalThis.result=[_0xf([0x1,0x2]),_0xf(0x5),_0xg({[_0xh(0x6b)]:{}}),_0xg({}),_0xr,_0xs,_0xs[_0xh(0x6d)],_0xs[_0xa(0x6e)],typeof _0xs[_0xa(0x6a)]];}};_0xm[0x2a]();})()));`,
  `function a0_tab(){const _0xl=${JSON.stringify(STORED).replace(/"/g, "'")};a0_tab=function(){return _0xl;};return a0_tab();}`,
  "",
].join("\n");

/** Runs a userscript in a fresh context and returns its `result` as JSON. */
const behaviour = (code) => {
  const context = vm.createContext({});
  vm.runInContext(code, context);
  return JSON.stringify(context.result);
};

test("the synthetic fixture needs exactly ROTATION rotations to match its checksum", () => {
  const matches = [];
  for (let r = 0; r < STORED.length; r++)
    if (checksumOf([...STORED.slice(r), ...STORED.slice(0, r)]) === TARGET) matches.push(r);
  assert.deepEqual(matches, [ROTATION]);
  assert(Number.isInteger(TARGET) && TARGET > 0);
});

test("a minified release is deobfuscated with the same behaviour, token-safe edits included", async () => {
  const result = await deobfuscate(fixture);
  assert.equal(behaviour(result.code), behaviour(fixture));
  assert.equal(
    behaviour(fixture),
    JSON.stringify([
      3,
      false,
      true,
      false,
      "ff",
      { enumerable: true, label: "hello world", x: "AB", value: 7, "a-b": 8 },
      7,
      8,
      "undefined",
    ]),
  );
  assert.equal(result.version, "1.2.3");
  assert.equal(result.mainModuleId, 42);
  assert.deepEqual(
    {
      strings: result.stats.strings,
      offset: result.stats.offset,
      rotations: result.stats.rotations,
      decoderCalls: result.stats.decoderCalls,
      aliases: result.stats.aliases,
    },
    { strings: 16, offset: OFFSET, rotations: ROTATION, decoderCalls: 10, aliases: 5 },
  );
  assert(result.code.startsWith("// ==UserScript==\n// @name Fixture\n"));
  for (const expected of [
    "return false;",
    "_0xo?.items instanceof Object ? true :",
    '"value" in _0xo',
    '(255)["toString"](16)',
    "_0xp.length + _0xq",
    'x: "AB"',
    '_0xs["a-b"]',
    "typeof _0xs.push",
  ])
    assert(result.code.includes(expected), `${expected}\n${result.code}`);
  for (const gone of ["a0_dec", "a0_tab", "parseInt", "_0xa", "_0xb", "_0xc", "_0xh"])
    assert(!result.code.includes(gone), `${gone} is gone`);
  assert.doesNotMatch(result.code, /\b0x[0-9a-f]/i, "no hexadecimal number");
});

test("a formatted copy of a release gives the same program", async () => {
  // astring drops the layout (Prettier keeps an object expanded when its input was).
  const program = (code) => generate(parseScript(code, { locations: false }));
  const minified = await deobfuscate(fixture);
  const formatted = await deobfuscate(await formatCode(fixture));
  assert.equal(program(formatted.code), program(minified.code));
  assert.deepEqual(formatted.stats, minified.stats);
  assert.equal(behaviour(formatted.code), behaviour(fixture));
});

test("the self-check rejects an output that differs from the decoded input", async () => {
  const corrupt = async (code) => (await formatCode(code)).replace('"hello world"', '"hello"');
  await assert.rejects(deobfuscate(fixture, { format: corrupt }), /self-check failed.*hello/);
  const skipped = await deobfuscate(fixture, { format: corrupt, verify: false });
  assert.equal(skipped.stats.verified, false);
});

test("unsupported layouts are refused with a clear error", async () => {
  await assert.rejects(deobfuscate("const a = 1;"), /string array decoder not found/);
  // The decoder passed around as a value cannot be removed.
  const escaped = fixture.replace(
    "globalThis.result=[",
    "globalThis.decoder=_0xa;globalThis.result=[",
  );
  await assert.rejects(deobfuscate(escaped), /_0xa is used at offset \d+ in a way/);
  // A decoder call with a computed index cannot be resolved statically.
  const computed = fixture.replace("_0xf(0x5)", "_0xa(0x64+_0x1.length)");
  await assert.rejects(deobfuscate(computed), /unsupported decoder call/);
  // A base64-encoded string array.
  const encoded = fixture.replace("let _0xs=_0xt[_0xj];", "let _0xs=atob(_0xt[_0xj]);");
  await assert.rejects(deobfuscate(encoded), /encoded \(base64\/rc4\)/);
  const broken = fixture.replace("0x4;if(", "0x4;while(");
  await assert.rejects(deobfuscate(broken), /the input is not valid JavaScript/);
});

test("applyEdits keeps tokens apart and refuses overlapping edits", () => {
  assert.equal(applyEdits("return!0x0;", [{ start: 6, end: 10, text: "true" }]), "return true;");
  assert.equal(applyEdits("a['b']in c", [{ start: 1, end: 6, text: ".b" }]), "a.b in c");
  assert.equal(applyEdits("a/*x*/b", [{ start: 1, end: 6, text: "" }]), "a b", "removal");
  assert.equal(applyEdits("a+ x +b", [{ start: 2, end: 5, text: "" }]), "a+ +b", "no ++");
  assert.equal(applyEdits("x=(f(),g)", [{ start: 3, end: 7, text: "" }]), "x=(g)");
  // Adjacent edits: each one sees the final text on its right.
  assert.equal(
    applyEdits("in(q)of", [
      { start: 2, end: 5, text: "y" },
      { start: 0, end: 2, text: "x" },
    ]),
    "x y of",
  );
  assert.throws(
    () =>
      applyEdits("abcdef", [
        { start: 1, end: 4, text: "" },
        { start: 3, end: 5, text: "" },
      ]),
    /overlapping edits/,
  );
});

test("the CLI writes the deobfuscated release", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "open-paletools-deobfuscate-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, "fixture.user.js");
  const output = path.join(directory, "fixture.deobfuscated.js");
  fs.writeFileSync(input, fixture);
  const script = path.join(ROOT, "scripts/upstream/deobfuscate.mjs");
  const { stderr } = await run(process.execPath, [script, input, output]);
  assert.match(stderr, /Paletools 1\.2\.3, main module 42: 16 strings.*self-check passed/);
  assert.equal(fs.readFileSync(output, "utf8"), (await deobfuscate(fixture)).code);
  await assert.rejects(run(process.execPath, [script, input]), (error) => error.code === 2);
});
