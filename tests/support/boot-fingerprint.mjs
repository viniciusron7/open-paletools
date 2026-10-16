// Compact, deterministic fingerprint of how a userscript boots in the simulated Web App.
import crypto from "node:crypto";
import { bootUserscript, normalizeErrorMessage } from "./webapp-harness.mjs";

export const SCENARIOS = Object.freeze({
  desktop: { isPhone: false },
  phone: { isPhone: true },
});

const digest = (lines) =>
  crypto.createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);

/**
 * A hook that recurses until the stack overflows (the fakes cannot end the recursion, e.g.
 * `UTControl.prototype.init`) leaves a trace whose length depends on the stack size, so on the
 * Node version and the machine. Its distinct lines, in order, are the same everywhere.
 */
const stableLines = (lines) =>
  /RangeError: Maximum call stack size exceeded/.test(lines.at(-1) ?? "")
    ? [...new Set(lines)]
    : lines;

/**
 * Boots `source` in every scenario. For each one returns the complete boot trace (until all
 * plugins ran) and one digest per exercised prototype override.
 */
export async function bootFingerprint(source) {
  const result = {};
  for (const [name, options] of Object.entries(SCENARIOS)) {
    const { trace, errors } = await bootUserscript(source, { ...options, exerciseHooks: true });
    const firstExercise = trace.findIndex((line) => line.startsWith("exercise "));
    const boot = firstExercise < 0 ? trace : trace.slice(0, firstExercise);
    const hooks = [];
    let current = null;
    for (const line of firstExercise < 0 ? [] : trace.slice(firstExercise)) {
      if (line.startsWith("exercise ")) {
        current = { name: line.slice("exercise ".length), lines: [] };
        hooks.push(current);
      } else current.lines.push(line);
    }
    result[name] = {
      boot,
      hooks: hooks.map((hook) => `${hook.name} ${digest(stableLines(hook.lines))}`),
      errors: errors.map((error) => `${error?.name}: ${normalizeErrorMessage(error?.message)}`),
    };
  }
  return result;
}
