#!/usr/bin/env node
// Regenerates tests/userscript/boot-fingerprint.snapshot.json from a fresh build of src/.
//
//   npm run update:boot-snapshot [-- --note "why"]
//
// The snapshot is what the boot test compares against: every Web App call, hook, listener,
// stylesheet and event of the initialization, in order, plus the effect of each installed hook.
// Regenerate it only when a change is meant to alter what the script does while booting (a new
// or changed plugin, hook or stylesheet), and review the diff before committing it.
import fs from "node:fs";
import path from "node:path";
import { bootFingerprint } from "../tests/support/boot-fingerprint.mjs";
import { buildCheckedUserscript } from "./build.mjs";
import { isMainModule } from "./lib/ast.mjs";
import { ROOT } from "./lib/modules.mjs";

export const SNAPSHOT_PATH = "tests/userscript/boot-fingerprint.snapshot.json";

/** Reads `[--note "why"]`. */
export function parseSnapshotArgs(args) {
  const noteIndex = args.indexOf("--note");
  return { note: noteIndex >= 0 ? args[noteIndex + 1] : "recorded from the current sources" };
}

if (isMainModule(import.meta.url)) {
  const { note } = parseSnapshotArgs(process.argv.slice(2));
  let source;
  try {
    source = await buildCheckedUserscript(ROOT);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const fingerprint = await bootFingerprint(source);
  fs.mkdirSync(path.join(ROOT, path.dirname(SNAPSHOT_PATH)), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, SNAPSHOT_PATH),
    `${JSON.stringify({ note, ...fingerprint }, null, 2)}\n`,
  );
  console.log(`wrote ${SNAPSHOT_PATH}`);
}
