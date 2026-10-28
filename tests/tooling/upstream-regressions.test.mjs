// Regression tests of the upstream merge engine: shapes found by running it on every pair of the
// 16 saved Paletools releases (each once crashed, lost code or wrote a different program). Each
// test merges a synthetic release both ways and checks that the port is the release's program.
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertConflicts,
  assertEquivalent,
  bundle,
  mergeBothWays,
} from "../support/upstream-fixtures.mjs";

/** The project did not change the base: the port must be the release itself. */
function portUnchangedProject(base, release) {
  const result = mergeBothWays({ base, target: base, other: release });
  assertConflicts(result.plan, []);
  assertEquivalent(bundle(release, { id: 909 }), result.port.text, "port");
  assertEquivalent(result.expected.text, result.port.text, "both directions");
  return result;
}

test("a switch case with a normalized statement changed by the release (astring has no SwitchCase printer)", () => {
  const base = `function f(x) {
  switch (x.k) {
    case 1:
      let y = "";
      (y = x.a ? "p" : "q"), g(y);
      break;
    default:
      h();
  }
}
f({});`;
  portUnchangedProject(base, base.replace(`x.a ? "p" : "q"`, `"p"`));
});

test("a statement added to a case and a catch that gains a parameter", () => {
  const base = `function f(x) {
  switch ((t(), x)) {
    case 1:
      a();
  }
  try { b(); } catch { c(); }
}
f(1);`;
  const release = base
    .replace("a();", "a(); z();")
    .replace("catch {", "catch (error) { log(error);");
  portUnchangedProject(base, release);
});

test("a statement the release both moved and changed moves to the release's place", () => {
  portUnchangedProject(
    "a();\nb();\nc();\nconst Q = mk(1);\nd(Q);",
    "a();\nconst Q = mk(2);\nb();\nc();\nd(Q);",
  );
});

test("a function the release made async keeps its callers' name (astring prints ids itself)", () => {
  portUnchangedProject(
    "function f(a) { return a + 1; }\nf(1);",
    "async function g(b) { return b + 1; }\ng(1);",
  );
});

test("an arrow made async keeps the name of its lone parameter in its body", () => {
  portUnchangedProject(
    "function f(xs) { return xs.map((v) => v.a); }\nf([]);",
    "function f(xs) { return xs.map(async (w) => w.a); }\nf([]);",
  );
});

test("a callee replaced by a function expression is parenthesized", () => {
  const result = portUnchangedProject(
    'function f() {\n  a();\n  hook(A, "m", function () { return 1; });\n  c();\n}\nf();',
    "function f() {\n  a();\n  (function () { return 1; })();\n  c();\n}\nf();",
  );
  assert.doesNotThrow(() => new Function(result.port.text), "the port parses");
});

test("removing the only argument of a multi-line call drops its trailing comma", () => {
  const result = portUnchangedProject(
    "function f(a) {\n  return a.sort(\n    (x, y) => x - y,\n  );\n}\nf([]);",
    "function f(a) {\n  return a.sort();\n}\nf([]);",
  );
  assert.doesNotThrow(() => new Function(result.port.text), "the port parses");
});

test("a constant whose reads all become an expression is not moved to its declaration", () => {
  const result = portUnchangedProject(
    'const LOGO = "data:a";\nfunction f() { return LOGO; }\nfunction g() { return "<img src=" + LOGO; }\nf();\ng();',
    'function f() { return IMG.logo; }\nfunction g() { return "<img src=" + IMG.logo; }\nf();\nconst IMG = { logo: "data:a", other: 1 };\ng();',
  );
  // Equivalent to the release (checked above), and not by moving the new reads to the old
  // declaration, which would evaluate IMG.logo before IMG exists.
  assert.doesNotMatch(result.port.text, /LOGO\s*=\s*IMG/);
});

// Cases found by porting a heavily customized copy of this project (its own plugins, removed
// and rewritten built-in modules).

test("a class used only by a statement the project rewrote keeps its correspondence", () => {
  const base =
    "class _0xS { m() { return 1; } }\nconst _0xdb = { s: new _0xS(), open() { return 1; } };\nuse(_0xdb);";
  const target =
    "class Store { m() { return 1; } }\nconst db = { s: new Store(), ready: false, async open() { this.ready = true; return 2; }, close() {} };\nuse(db);";
  const other = base.replace("m() { return 1; }", "m() { return 3; }");
  const result = mergeBothWays({ base, target, other });
  assertConflicts(result.plan, []);
  assertEquivalent(result.expected.text, result.port.text, "both directions");
  assert.match(result.port.text, /class Store \{\s*m\(\) \{\s*return 3;/);
});

test("where the project removed code the release changed, both sides keep the removal", () => {
  const base = "function _0xa() { return 1; }\nfunction _0xb() { return 2; }\n_0xa();\n_0xb();";
  const target = "function keep() { return 1; }\nkeep();";
  const other = base.replace("return 2;", "return 20;");
  const result = mergeBothWays({ base, target, other });
  assertConflicts(result.plan, ["changed-but-removed"]);
  assertEquivalent(result.expected.text, result.port.text, "port and expected program agree");
  assert.doesNotMatch(result.expected.text, /return 20/);
});

test("a constant the release changes is also read with its new value by the project's own code", () => {
  const base =
    'const _0xv = "1.0";\nfunction _0xa() { return _0xv; }\nfunction _0xb() { return "v" + _0xv; }\n_0xa();\n_0xb();';
  const target =
    'const VERSION = "1.0";\nfunction a() { return VERSION; }\nfunction b() { return "v" + VERSION; }\nfunction mine() { return VERSION.split("."); }\na();\nb();\nmine();';
  const other = base.replace('"1.0"', '"2.0"');
  const result = mergeBothWays({ base, target, other });
  assertConflicts(result.plan, []);
  assertEquivalent(result.expected.text, result.port.text, "port and expected program agree");
  assert.match(result.port.text, /const VERSION = "2.0"/);
  assert.match(result.port.text, /return VERSION;/);
});
