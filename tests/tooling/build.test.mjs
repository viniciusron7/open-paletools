import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse, tokTypes, tokenizer } from "acorn";
import {
  BUILD_NUMBER_PATH,
  buildUserscript,
  headerVersion,
  nextBuildNumber,
} from "../../scripts/build.mjs";
import { ROOT } from "../../scripts/lib/modules.mjs";

const built = await buildUserscript(ROOT);
const header = fs.readFileSync(path.join(ROOT, "src/userscript-header.js"), "utf8");

test("the build is reproducible from a copy of the sources in another directory", async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "paletools-build-"));
  try {
    for (const entry of ["src", ".prettierrc.json"])
      fs.cpSync(path.join(ROOT, entry), path.join(copy, entry), { recursive: true });
    assert.equal(await buildUserscript(copy), built);
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
});

test("the userscript starts with the metadata block of src/userscript-header.js", () => {
  const metadata = header.slice(
    0,
    header.indexOf("// ==/UserScript==") + "// ==/UserScript==".length,
  );
  assert(metadata.startsWith("// ==UserScript==\n"), "the header starts the metadata block");
  assert(built.startsWith(`${metadata}\n`));
  assert.match(metadata, /^\/\/ @match https:\/\/www\.ea\.com\/.*\/web-app\/$/m);
});

test("the userscript manager cannot replace a custom build with the official script", () => {
  const metadata = built.slice(0, built.indexOf("// ==/UserScript=="));
  assert.doesNotMatch(metadata, /@(updateURL|downloadURL)\s+\S*pale\.tools/);
});

test("a build number is appended to @version, and nothing else changes", async () => {
  const version = headerVersion(header);
  const numbered = await buildUserscript(ROOT, { buildNumber: 7 });
  assert(numbered.includes(`\n// @version ${version}.7\n`), "@version gets .7");
  assert.equal(numbered.replace(`// @version ${version}.7\n`, `// @version ${version}\n`), built);
  assert.equal(headerVersion(header.replace(/\n/g, "\r\n")), version, "CRLF headers work too");
  assert.throws(() => headerVersion("// ==UserScript==\n// ==/UserScript=="), /no `\/\/ @version`/);
});

test("the build number counts the builds of each version, from 1", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "paletools-build-number-"));
  const save = (text) => fs.writeFileSync(path.join(directory, BUILD_NUMBER_PATH), text);
  try {
    assert.equal(nextBuildNumber("27.1.5", directory), 1, "the first build is number 1");
    save(JSON.stringify({ version: "27.1.5", builds: 9 }));
    assert.equal(nextBuildNumber("27.1.5", directory), 10);
    assert.equal(nextBuildNumber("27.1.6", directory), 1, "a new version counts from 1 again");
    for (const broken of ["not json", "{}", '{"version":"27.1.5","builds":0}']) {
      save(broken);
      assert.throws(() => nextBuildNumber("27.1.5", directory), /is not valid/, broken);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("@version matches paletoolsVersion of src/config/version.js", () => {
  const versionModule = fs.readFileSync(path.join(ROOT, "src/config/version.js"), "utf8");
  const configured = versionModule.match(/export const paletoolsVersion = "([^"]*)";/)?.[1];
  assert.equal(configured, headerVersion(header), "change the version in both files");
});

test("the userscript is a self-contained, readable script", () => {
  const program = parse(built, { ecmaVersion: 2024, sourceType: "script" });
  assert.equal(program.body.length, 1, "a single top-level IIFE");
  assert.doesNotMatch(built, /^\s*(import|export)\s/m, "no module syntax is left");
  assert.doesNotMatch(built, /\/(home|tmp|Users|root)\/|[A-Z]:\\\\|file:\/\//, "no local paths");
  assert.doesNotMatch(built, /@require|@resource/, "nothing is downloaded at runtime");
  // Long lines may only be long because of string literals (translations, CSS, data URIs).
  const codeCharactersPerLine = new Map();
  for (const token of tokenizer(built, { ecmaVersion: 2024, locations: true })) {
    if (token.type === tokTypes.string || token.type === tokTypes.template) continue;
    const line = token.loc.start.line;
    codeCharactersPerLine.set(
      line,
      (codeCharactersPerLine.get(line) ?? 0) + token.end - token.start,
    );
  }
  const denseLines = [...codeCharactersPerLine].filter(([, characters]) => characters > 100);
  assert.deepEqual(denseLines, [], "code is formatted (printWidth 100), not minified");
});

test("every module of the manifest has a region in the userscript, in manifest order", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "src/manifest.json"), "utf8"));
  const regions = [...built.matchAll(/^\s*\/\/ #region (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(regions, ["embedded resources", ...manifest.modules]);
});
