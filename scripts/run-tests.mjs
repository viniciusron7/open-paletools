#!/usr/bin/env node
// Runs the whole test suite:
//   0. builds a test copy of the userscript from src/ into a temporary file, so the tests below
//      never see a stale build (dist/ and the build number of `npm run build` are not touched);
//   1. tooling tests (scripts/);
//   2. feature tests (tests/*.test.cjs) against the source modules;
//   3. the same feature tests against the test copy of the userscript, plus the boot tests of the
//      complete userscript (tests/userscript/). PALETOOLS_USERSCRIPT holds its path.
// Extra arguments are forwarded to `node --test` (e.g. `--test-name-pattern=boot`).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCheckedUserscript } from "./build.mjs";
import { ROOT } from "./lib/modules.mjs";

const forwarded = process.argv.slice(2);
const runs = [
  { title: "tooling", target: "src", files: ["tests/tooling/*.test.mjs"] },
  { title: "features against src/ modules", target: "src", files: ["tests/*.test.cjs"] },
  {
    title: "features and boot against the generated userscript",
    target: "userscript",
    files: ["tests/*.test.cjs", "tests/userscript/*.test.mjs"],
  },
];

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "open-paletools-test-"));
const userscriptPath = path.join(directory, "paletools.user.js");
let failed = false;
try {
  fs.writeFileSync(userscriptPath, await buildCheckedUserscript(ROOT));
  console.log("# build\nbuilt a test copy of the userscript (dist/ is not changed)");
  for (const run of runs) {
    console.log(`\n# ${run.title}`);
    const result = spawnSync(process.execPath, ["--test", ...forwarded, ...run.files], {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        PALETOOLS_TEST_TARGET: run.target,
        PALETOOLS_USERSCRIPT: userscriptPath,
      },
    });
    if (result.status !== 0) failed = true;
  }
} catch (error) {
  console.error(`build failed: ${error.message}`);
  failed = true;
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
