// Tests of scripts/upstream/update.mjs: its command line and the safety rules of a port.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseOptions, readBase, UsageError } from "../../scripts/upstream/update.mjs";
import { sha256 } from "../../scripts/upstream/release.mjs";
import { createProject, mergeBothWays, portRelease } from "../support/upstream-fixtures.mjs";

test("options are checked per command: unknown options and missing values are refused", () => {
  assert.deepEqual(parseOptions("update", ["--file", "a.user.js", "--dry-run"]), {
    file: "a.user.js",
    "dry-run": true,
  });
  assert.deepEqual(parseOptions("verify", ["--finish", "--conflicts-resolved"]), {
    finish: true,
    "conflicts-resolved": true,
  });
  assert.throws(() => parseOptions("update", ["--dryrun"]), UsageError);
  assert.throws(() => parseOptions("update", ["--file"]), UsageError);
  assert.throws(() => parseOptions("update", ["--file", "--force"]), UsageError);
  assert.throws(() => parseOptions("status", ["--finish"]), UsageError);
  assert.throws(() => parseOptions("nothing", []), UsageError);
});

test("a base that is not the recorded release is refused", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "upstream-base-"));
  try {
    const source = "// ==UserScript==\n// @version 1.2.3\n// ==/UserScript==\n";
    fs.mkdirSync(path.join(root, "upstream"));
    fs.writeFileSync(path.join(root, "upstream/base.user.js"), source);
    fs.writeFileSync(
      path.join(root, "upstream/base.json"),
      JSON.stringify({ version: "1.2.3", sha256: sha256(source) }),
    );
    assert.equal(readBase(root).version, "1.2.3");
    fs.appendFileSync(path.join(root, "upstream/base.user.js"), "// edited\n");
    assert.throws(() => readBase(root), /SHA-256 differs/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a function the release removes but this project's own code uses is kept, both ways", () => {
  const base =
    "function helper(a) { return a + 1; }\nfunction show(a) { return helper(a) * 2; }\nshow(1);";
  const target = `${base}\nfunction mine(a) { return helper(a) * 10; }\nmine(2);`;
  const other = "function show(a) { return a * 3; }\nshow(1);";
  const { plan, port, expected } = mergeBothWays({ base, target, other });
  assert.deepEqual(
    plan.conflicts.map((conflict) => conflict.kind),
    ["removed-but-used"],
  );
  for (const [label, text] of [
    ["port", port.text],
    ["expected", expected.text],
  ]) {
    assert.match(text, /function \w+\(\w+\) \{\s*return \w+ \+ 1;/, `${label} keeps the helper`);
    assert.match(text, /\* 3/, `${label} has the release's change`);
    assert.doesNotThrow(() => new Function(text)(), `${label} runs`);
  }
});

test("a ported project whose own module uses a removed function stays consistent", async () => {
  const { root } = createProject({
    modules: {
      "src/core/util.js":
        "// util\nexport function helper(value) {\n  return value + 1;\n}\n\nexport function show(value) {\n  return helper(value) * 2;\n}\n",
      "src/plugins/mine.js":
        '// own tool\nimport { helper } from "../core/util.js";\n\nexport function mine(value) {\n  return helper(value) * 10;\n}\n',
      "src/main.js":
        'import { show } from "./core/util.js";\nimport { mine } from "./plugins/mine.js";\n\nshow(1);\nmine(2);\n',
    },
  });
  try {
    const result = await portRelease(root, {
      baseBody:
        "function _0x1(_0xa){return _0xa+1;} function _0x2(_0xa){return _0x1(_0xa)*2;} _0x2(1);",
      releaseBody: "function _0x2(_0xa){return _0xa*3;} _0x2(1);",
    });
    assert.deepEqual(
      result.plan.conflicts.map((conflict) => conflict.kind),
      ["removed-but-used"],
    );
    const util = fs.readFileSync(path.join(root, "src/core/util.js"), "utf8");
    assert.match(util, /export function helper/);
    assert.match(util, /return value \* 3;/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
