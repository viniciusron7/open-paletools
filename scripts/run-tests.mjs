#!/usr/bin/env node
// Runs the whole test suite:
//   0. builds dist/paletools.user.js from src/, so the tests below never see a stale build;
//   1. tooling tests (scripts/);
//   2. feature tests (tests/*.test.cjs) against the source modules;
//   3. the same feature tests against the generated userscript, plus the boot tests of the
//      complete userscript (tests/userscript/).
// Extra arguments are forwarded to `node --test` (e.g. `--test-name-pattern=boot`).
import { spawnSync } from "node:child_process";
import { writeUserscript } from "./build.mjs";
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

try {
  const { outputPath } = await writeUserscript(ROOT);
  console.log(`# build\nwrote ${outputPath}`);
} catch (error) {
  console.error(`build failed: ${error.message}`);
  process.exit(1);
}

let failed = false;
for (const run of runs) {
  console.log(`\n# ${run.title}`);
  const result = spawnSync(process.execPath, ["--test", ...forwarded, ...run.files], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, PALETOOLS_TEST_TARGET: run.target },
  });
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
