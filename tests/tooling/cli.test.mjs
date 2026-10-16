import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { buildUserscript } from "../../scripts/build.mjs";
import { ROOT } from "../../scripts/lib/modules.mjs";

const require = createRequire(import.meta.url);
const SNAPSHOT = path.join(ROOT, "tests/userscript/boot-fingerprint.snapshot.json");

/** A copy of the project in a directory whose path contains a space. */
function copyWithSpace() {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "paletools copy "));
  for (const entry of ["scripts", "src", ".prettierrc.json"])
    fs.cpSync(path.join(ROOT, entry), path.join(copy, entry), { recursive: true });
  // Junctions need no special rights on Windows; other systems ignore the type.
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(copy, "node_modules"), "junction");
  return copy;
}

const run = (script, args = [], nodeOptions = []) =>
  spawnSync(process.execPath, [...nodeOptions, script, ...args], {
    encoding: "utf8",
    cwd: os.tmpdir(),
  });

const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

test("the command-line scripts run from paths with spaces and through symbolic links", async () => {
  const expected = await buildUserscript(ROOT);
  const copy = copyWithSpace();
  const link = `${copy}-link`;
  try {
    fs.symlinkSync(copy, link, "junction");
    for (const [root, nodeOptions] of [
      [copy, []],
      [link, []],
      [link, ["--preserve-symlinks-main"]],
    ]) {
      const modules = run(path.join(root, "scripts/check-modules.mjs"), [], nodeOptions);
      assert.equal(modules.status, 0, modules.stderr);
      assert.match(modules.stdout, /\d+ modules: dependencies are explicit/);
      fs.rmSync(path.join(copy, "dist"), { recursive: true, force: true });
      const build = run(path.join(root, "scripts/build.mjs"), [], nodeOptions);
      assert.equal(build.status, 0, build.stderr);
      assert.match(build.stdout, /^wrote dist\/paletools\.user\.js \(\d+ lines\)$/m);
      assert.equal(fs.readFileSync(path.join(copy, "dist/paletools.user.js"), "utf8"), expected);
    }
    // A failing check must fail there too (it used to exit 0 without running), and the build
    // must refuse to write a script from modules that break the rules.
    fs.appendFileSync(path.join(copy, "src/bootstrap/boot.js"), "\nundeclaredName;\n");
    fs.rmSync(path.join(copy, "dist"), { recursive: true, force: true });
    for (const nodeOptions of [[], ["--preserve-symlinks-main"]]) {
      const broken = run(path.join(link, "scripts/check-modules.mjs"), [], nodeOptions);
      assert.equal(broken.status, 1);
      assert.match(broken.stderr, /unknown global undeclaredName/);
      const refused = run(path.join(link, "scripts/build.mjs"), [], nodeOptions);
      assert.equal(refused.status, 1);
      assert.match(
        refused.stderr,
        /problem\(s\) in the modules[\s\S]*unknown global undeclaredName/,
      );
      assert(!fs.existsSync(path.join(copy, "dist")), "nothing is written");
    }
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(copy, { recursive: true, force: true });
  }
});

test("update-boot-snapshot only writes when run, and reads its --note", async () => {
  const before = hash(SNAPSHOT);
  const { parseSnapshotArgs } = await import("../../scripts/update-boot-snapshot.mjs");
  assert.equal(hash(SNAPSHOT), before, "importing the script must not rewrite the snapshot");
  assert.deepEqual(parseSnapshotArgs([]), { note: "recorded from the current sources" });
  assert.deepEqual(parseSnapshotArgs(["--note", "why"]), { note: "why" });
});

test("the test loader evaluates sources as strict code, like module 723", () => {
  const { loadSources } = require("../support/load-sources.cjs");
  const context = vm.createContext({});
  loadSources(context, {
    epilogue: "globalThis.thisInPlainCall = (function () { return this; })();",
  });
  assert.equal(context.thisInPlainCall, undefined);
});
