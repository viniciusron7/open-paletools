// Boots the complete generated userscript in the simulated Web App (see
// tests/support/webapp-harness.mjs) and compares its behavior with the recorded snapshot
// (boot-fingerprint.snapshot.json): every Web App call, prototype override, listener,
// stylesheet, timer and dispatched event during the boot, in order, plus the effect of calling
// each installed prototype override once. When a change is meant to alter the boot (for example
// a new plugin), run `npm run update:boot-snapshot` and review the diff of the snapshot.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { bootFingerprint } from "../support/boot-fingerprint.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const { output } = JSON.parse(fs.readFileSync(path.join(root, "src/manifest.json"), "utf8"));
const userscript = fs.readFileSync(path.join(root, output), "utf8");
const snapshot = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "boot-fingerprint.snapshot.json"), "utf8"),
);
const fingerprint = await bootFingerprint(userscript);

/** `assert.deepEqual` that keeps Node's diff and says how to accept an intended change. */
function assertMatchesSnapshot(actual, expected) {
  try {
    assert.deepEqual(actual, expected);
  } catch (error) {
    const original = error.message;
    error.message =
      "The boot differs from tests/userscript/boot-fingerprint.snapshot.json. If you changed " +
      "it on purpose, run `npm run update:boot-snapshot` and review the diff of the snapshot." +
      `\n\n${original}`;
    // The default test reporter prints the stack, which still holds the original message.
    error.stack = error.stack.replace(original, () => error.message);
    throw error;
  }
}

const externalRequests = (boot) =>
  boot.filter((line) => /^(fetch|GM_xmlhttpRequest|GM_download)\b/.test(line));

for (const scenario of ["desktop", "phone"]) {
  test(`${scenario}: the boot reaches APP_STARTED and marks the Web App as booted`, () => {
    const boot = fingerprint[scenario].boot;
    const started = boot.indexOf("dispatch window:paletools:appStarted");
    assert(started > 0, "paletools:appStarted must be dispatched");
    assert(boot.indexOf("dispatch window:paletools:appLoaded") < started);
    assert(boot.includes("set getAppMain()._ptBooted = true"));
    assert(
      boot.filter((line) => line.startsWith("override ")).length > 300,
      "plugins install their hooks",
    );
  });

  test(`${scenario}: initialization calls, hooks, listeners and styles match the snapshot in order`, () => {
    assertMatchesSnapshot(fingerprint[scenario].boot, snapshot[scenario].boot);
  });

  test(`${scenario}: every installed prototype override behaves as recorded in the snapshot`, () => {
    assertMatchesSnapshot(fingerprint[scenario].hooks, snapshot[scenario].hooks);
    assertMatchesSnapshot(fingerprint[scenario].errors, snapshot[scenario].errors);
  });
}

test("the boot only makes the requests recorded in the snapshot, all answered by the harness", () => {
  for (const scenario of ["desktop", "phone"]) {
    // The harness has no network access: it fails every request without any connection. Today
    // the only request at boot is the update check of src/plugins/check-for-updates.
    assertMatchesSnapshot(
      externalRequests(fingerprint[scenario].boot),
      externalRequests(snapshot[scenario].boot),
    );
  }
});
