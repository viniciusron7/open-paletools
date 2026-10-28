import assert from "node:assert/strict";
import test from "node:test";
import { createComparator, verifyEquivalence } from "../../scripts/upstream/lib/equivalence.mjs";
import { prepareProgram } from "../../scripts/upstream/lib/program.mjs";

// A userscript shaped like the real one: a webpack module table whose largest factory (`id`) is
// the main module, an empty module, and the runtime that requires the main module.
const bundle = (body, { id = 723, outer = "", required = id } = {}) =>
  `${outer}(() => {
  var moduleFactories = {
    ${id}: (moduleRecord, moduleExports, importModule) => {
      "use strict";
${body}
    },
    491: () => {},
  };
  var moduleCache = {};
  function requireModule(moduleId) {
    var cachedModule = moduleCache[moduleId];
    if (cachedModule !== undefined) return cachedModule.exports;
    var loadedModule = (moduleCache[moduleId] = { exports: {} });
    moduleFactories[moduleId](loadedModule, loadedModule.exports, requireModule);
    return loadedModule.exports;
  }
  requireModule(${required});
})();`;

const verify = (reference, candidate, options) =>
  verifyEquivalence(bundle(reference), bundle(candidate), options);
const equivalent = (reference, candidate, renames) =>
  verify(reference, candidate, renames ? { renames } : {}).equivalent;

/** "line:column" (1-based) of the first `text` of a main module body wrapped by `bundle`. */
function position(body, text) {
  const source = bundle(body);
  const offset = source.indexOf(text);
  assert(offset >= 0, `${text} occurs in the source`);
  const before = source.slice(0, offset).split("\n");
  return `${before.length}:${before.at(-1).length + 1}`;
}

/** The source range of the `occurrence`-th `text` in `source`. */
function rangeOf(source, text, occurrence = 0) {
  let start = -1;
  for (let index = 0; index <= occurrence; index++) start = source.indexOf(text, start + 1);
  assert(start >= 0, `${text} occurs in the source`);
  return [start, start + text.length];
}

// ---------------------------------------------------------------------------
// Comparison semantics (those of the previous verifier)
// ---------------------------------------------------------------------------
test("accepts formatting, comments and consistent local renaming", () => {
  assert(
    equivalent("function f(a){return a+1}", "// doc\nfunction f(value) {\n  return value + 1;\n}"),
  );
});

test("rejects inconsistent renaming, swapped variables and changed literals", () => {
  assert(!equivalent("function f(a,b){return a-b}", "function f(a,b){return b-a}"));
  assert(!equivalent("function f(a,b){return a-b}", "function f(x,y){return y-x}"));
  assert(!equivalent("function f(a){return a+1}", "function f(a){return a+2}"));
  assert(!equivalent("function f(a){return a.x}", "function f(a){return a.y}"));
  assert(!equivalent('function f(){return "a"}', 'function f(){return "b"}'));
  assert(
    !equivalent(
      "let x = 1; function f(a){ return a + x }",
      "let x = 1; function f(x){ return x + x }",
    ),
  );
});

test("top-level bindings follow the rename map and functions may move", () => {
  const reference = "function a(){return b()} function b(){return 1} a();";
  const renames = { a: "first", b: "second" };
  assert(
    equivalent(
      reference,
      "function second(){return 1} function first(){return second()} first();",
      renames,
    ),
  );
  assert(
    !equivalent(
      reference,
      "function first(){return 1} function second(){return first()} second();",
      renames,
    ),
  );
  assert(!equivalent(reference, reference, renames), "a given map is not learned over");
});

test("non-function top-level statements keep their order", () => {
  assert(!equivalent("f(); g();", "g(); f();"));
  assert(!equivalent("let a = f(); let b = g();", "let b = g(); let a = f();"));
});

test("normalizes statement-level minifier idioms", () => {
  assert(equivalent("(a(), b(), c());", "a(); b(); c();"));
  assert(equivalent("x && y();", "if (x) { y(); }"));
  assert(equivalent("x || y();", "if (!x) y();"));
  assert(equivalent("x ? y() : z ? w() : v();", "if (x) y(); else if (z) w(); else v();"));
  assert(equivalent("!function(){ a(); }();", "(function(){ a(); })();"));
  assert(equivalent("function f(){ return (a(), b) }", "function f(){ a(); return b; }"));
  assert(equivalent("if ((a(), b)) c();", "a(); if (b) { c(); }"));
  assert(equivalent("f(); let a = g(), b = a;", "f(); let a = g(); let b = a;"));
  assert(equivalent('if ("function" == typeof x) y();', 'if (typeof x === "function") y();'));
  assert(equivalent("if (void 0 !== x) y();", "if (x !== undefined) y();"));
  assert(equivalent("const f = (a) => (g(a), h(a));", "const f = (a) => { g(a); return h(a); };"));
});

test("does not accept rewrites that change evaluation", () => {
  assert(!equivalent("x && y();", "if (!x) y();"));
  assert(!equivalent("x ? y() : z();", "if (x) z(); else y();"));
  assert(!equivalent("if (a == 1) b();", "if (a === 1) b();"));
  assert(!equivalent("function f(){ return (a(), b) }", "function f(){ return b; }"));
  assert(
    !equivalent(
      "let undefined = 1; if (x !== void 0) y();",
      "let undefined = 1; if (x !== undefined) y();",
    ),
  );
});

test("primitive constants may move and are inlined; other declarations keep their place", () => {
  const reference = 'f(); const A = "x"; const B = undefined; g([B]); function h(){ return A }';
  assert(
    equivalent(
      reference,
      'const A = "x"; const B = undefined; f(); g([B]); function h(){ return A }',
    ),
  );
  assert(
    !equivalent(
      reference,
      'const A = "y"; const B = undefined; f(); g([B]); function h(){ return A }',
    ),
  );
  assert(
    !equivalent(
      "f(); const A = k(); function h(){ return A }",
      "const A = k(); f(); function h(){ return A }",
    ),
  );
  assert(
    equivalent('function f(){ return "css" }', 'const STYLE = "css"; function f(){ return STYLE }'),
  );
  assert(
    !equivalent("function f(){ return { a: 1 } }", "const O = { a: 1 }; function f(){ return O }"),
  );
  assert(
    equivalent("function f(){ return `a\nb` }", 'const S = "a\\nb"; function f(){ return S }'),
  );
});

test("an uninitialized let may move only when nothing evaluated earlier can read it", () => {
  const reference = "let P; f(); P = { run() { return P; } }; function g(){ return P }";
  assert(
    equivalent(reference, "f(); let P; P = { run() { return P; } }; function g(){ return P }"),
  );
  assert(
    !equivalent(
      "let P; g(); P = 1; function g(){ return P }",
      "g(); let P; P = 1; function g(){ return P }",
    ),
  );
  assert(!equivalent("let P; h(() => P); P = 1;", "h(() => P); let P; P = 1;"));
  assert(equivalent("f(); let P; P = 1;", "let P; f(); P = 1;"));
  assert(equivalent("let P = false; f(); P = true;", "f(); let P = false; P = true;"));
  assert(!equivalent("let P = false; f(); P = true;", "f(); let P = 0; P = true;"));
  assert(
    equivalent(
      "let P; class C { m(){ return P } } P = 1;",
      "class C { m(){ return P } } let P; P = 1;",
    ),
  );
  assert(
    !equivalent(
      "let P; class C { static s = P; } P = 1;",
      "class C { static s = P; } let P; P = 1;",
    ),
  );
  const moved = verify(
    "let P; g(); P = 1; function g(){ return P }",
    "g(); let P; P = 1; function g(){ return P }",
  );
  assert.match(moved.mismatches.join("\n"), /let P moved later, after code that may read it/);
});

test("directives, raw template text, __proto__ shorthands and delete operands are compared", () => {
  assert(
    !equivalent('function f(){ "use strict"; x = 1 }', 'function f(){ "use\\x20strict"; x = 1 }'),
  );
  assert(!equivalent("f(String.raw`a\\nb`);", "f(String.raw`a\nb`);"));
  assert(
    !equivalent(
      "let __proto__ = { a: 1 }; f({ __proto__: __proto__ });",
      "let __proto__ = { a: 1 }; f({ __proto__ });",
    ),
  );
  const script = (outer) =>
    `${outer}\n(() => { var moduleFactories = { 723: (moduleRecord, moduleExports, importModule) => { "use strict"; log("x"); } }; })();`;
  assert(
    !verifyEquivalence(script("var r = delete void 0;"), script("var r = delete undefined;"))
      .equivalent,
  );
  assert(verifyEquivalence(script("var r = void 0;"), script("var r = undefined;")).equivalent);
});

// ---------------------------------------------------------------------------
// Main module ids
// ---------------------------------------------------------------------------
test("the main module id may differ between the two userscripts", () => {
  const body = "const a = f(); g(a);";
  const result = verifyEquivalence(bundle(body), bundle(body, { id: 909 }));
  assert(result.equivalent, result.mismatches.join("\n"));
  assert.deepEqual(result.moduleIds, { reference: 723, candidate: 909 });
  // Explicit ids work too.
  assert(
    verifyEquivalence(bundle(body), bundle(body, { id: 909 }), {
      referenceModuleId: 723,
      candidateModuleId: 909,
    }).equivalent,
  );
  assert.throws(
    () => verifyEquivalence(bundle(body), bundle(body), { candidateModuleId: 909 }),
    /candidate: webpack module 909 was not found/,
  );
});

test("outside the main module only each side's own main module id stands for it", () => {
  const body = "const a = f(); g(a);";
  // The candidate's runtime requires module 723, which is not its main module (909).
  const wrong = verifyEquivalence(bundle(body), bundle(body, { id: 909, required: 723 }));
  assert(!wrong.equivalent);
  assert.match(wrong.mismatches[0], /^literal 723 vs 723 \(main module id\)/);
  // Inside the main module numbers are plain numbers: importModule(723) is not importModule(909).
  assert(
    !verifyEquivalence(bundle("importModule(723);"), bundle("importModule(909);", { id: 909 }))
      .equivalent,
  );
  assert(
    verifyEquivalence(bundle("importModule(491);"), bundle("importModule(491);", { id: 909 }))
      .equivalent,
  );
});

// ---------------------------------------------------------------------------
// Private class members
// ---------------------------------------------------------------------------
test("private names may be renamed consistently, per class", () => {
  assert(
    equivalent(
      "class A { #x = 1; #y = 2; sum(){ return this.#x + this.#y } } f(A);",
      "class A { #first = 1; #second = 2; sum(){ return this.#first + this.#second } } f(A);",
    ),
  );
  // Swapping two names consistently (declarations and uses) is a renaming too.
  assert(
    equivalent(
      "class A { #x = 1; #y = 2; sub(){ return this.#x - this.#y } } f(A);",
      "class A { #y = 1; #x = 2; sub(){ return this.#y - this.#x } } f(A);",
    ),
  );
  // Each class has its own mapping: #x becomes #p in one class and #q in the other.
  assert(
    equivalent(
      "class A { #x = 1; get(){ return this.#x } } class B { #x = 2; get(){ return this.#x } } f(A, B);",
      "class A { #p = 1; get(){ return this.#p } } class B { #q = 2; get(){ return this.#q } } f(A, B);",
    ),
  );
  // Methods, accessor pairs, static members and brand checks.
  assert(
    equivalent(
      "class A { static #n = 0; #m(){ return 1 } get #v(){ return 2 } set #v(x){} has(o){ return #m in o && this.#m() + this.#v + A.#n } } f(A);",
      "class A { static #c = 0; #k(){ return 1 } get #w(){ return 2 } set #w(x){} has(o){ return #k in o && this.#k() + this.#w + A.#c } } f(A);",
    ),
  );
});

test("private names swapped inconsistently, merged or made public are differences", () => {
  const swapped = verify(
    "class A { #x = 1; #y = 2; sub(){ return this.#x - this.#y } } f(A);",
    "class A { #a = 1; #b = 2; sub(){ return this.#b - this.#a } } f(A);",
  );
  assert(!swapped.equivalent);
  assert.match(swapped.mismatches[0], /^inconsistent private renaming: #x -> #b/);
  // Two private names cannot become one.
  assert(
    !equivalent(
      "class A { #x = 1; #y = 2; get(){ return this.#x + this.#y } } f(A);",
      "class A { #x = 1; #y = 2; get(){ return this.#x + this.#x } } f(A);",
    ),
  );
  assert(
    !equivalent(
      "class A { #x = 1; m(){ return this.x } } f(A);",
      "class A { #x = 1; m(){ return this.#x } } f(A);",
    ),
  );
});

test("a private name resolves to the nearest enclosing class that declares it", () => {
  // The inner class reads the outer class's #x: renaming both classes' names is fine.
  assert(
    equivalent(
      "class O { #x = 1; m(){ return class I { #y = 2; f(o){ return o.#x + this.#y } } } } g(O);",
      "class O { #a = 1; m(){ return class I { #b = 2; f(o){ return o.#a + this.#b } } } } g(O);",
    ),
  );
  // In the reference o.#x is the inner class's #x; in the candidate o.#a is the outer one's.
  const shadowed = verify(
    "class O { #x = 1; m(){ return class I { #x = 2; f(o){ return o.#x } } } } g(O);",
    "class O { #a = 1; m(){ return class I { #b = 2; f(o){ return o.#a } } } } g(O);",
  );
  assert(!shadowed.equivalent);
  assert.match(shadowed.mismatches[0], /declared by different classes/);
});

// ---------------------------------------------------------------------------
// Rename learning
// ---------------------------------------------------------------------------
test("without a rename map the renames are learned, one to one", () => {
  const reference =
    "let _0x1; const _0x2 = Math.max(1, 0); function _0x3(){ return _0x4() + _0x2 } function _0x4(){ return 2 } _0x1 = _0x3();";
  const candidate =
    "let total; const base = Math.max(1, 0); function two(){ return 2 } function sum(){ return two() + base } total = sum();";
  const learned = verify(reference, candidate);
  assert(learned.equivalent, learned.mismatches.join("\n"));
  assert.deepEqual(learned.renames, { _0x1: "total", _0x2: "base", _0x3: "sum", _0x4: "two" });
  // The learned map passes the strict comparison, and a given map is completed when asked.
  assert(verify(reference, candidate, { renames: learned.renames }).equivalent);
  assert(verify(reference, candidate, { renames: { _0x3: "sum" }, learn: true }).equivalent);
  assert(!verify(reference, candidate, { renames: { _0x3: "sum" } }).equivalent);
  // Two reference bindings cannot both become the same candidate binding.
  assert(
    !equivalent("const a = g(); const b = g(); f(a, b);", "const a = g(); const c = g(); f(a, a);"),
  );
});

test("declarations that nothing references are paired by fingerprint", () => {
  const result = verify(
    "function _0x1(a){ return a * 2 } function _0x2(){ return 3 } let _0x3;",
    "function three(){ return 3 } function double(value){ return value * 2 } let unused;",
  );
  assert(result.equivalent, result.mismatches.join("\n"));
  assert.deepEqual(result.renames, { _0x1: "double", _0x2: "three", _0x3: "unused" });
});

test("createComparator compares statement pairs and learns renames on them", () => {
  const sideA = prepareProgram(bundle("const _0xa = make(); use(_0xa); function _0xf(){}"));
  const sideB = prepareProgram(bundle("const store = make(); use(store); function helper(){}"));
  const renames = new Map();
  const comparator = createComparator(sideA, sideB, { renames, learned: new Set() });
  assert.deepEqual(comparator.compareOutside(), []);
  // body[0] is the "use strict" directive.
  assert.deepEqual(comparator.compare(sideA.body[1], sideB.body[1]), []);
  assert.deepEqual(comparator.compare(sideA.body[2], sideB.body[2]), []);
  assert.equal(renames.get("_0xa"), "store");
  const [message] = comparator.compare(sideA.body[2], sideB.body[1]);
  assert.match(message, /^node type ExpressionStatement vs VariableDeclaration/);
  // Without learning, names must be equal.
  const strict = createComparator(sideA, sideB);
  assert.match(strict.compare(sideA.body[1], sideB.body[1])[0], /should be _0xa, found store/);
});

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------
const MODULES = `
// #region src/core/a.js
function helper(x) {
  const y = x + 1;
  return y * 2;
}
const settings = { a: 1, b: 2 };
// #endregion src/core/a.js
// #region src/core/b.js
register("one", helper(1));
register("two", helper(2));
register("three", combine(1, 2));
// #endregion src/core/b.js`;

test("a changed literal in a function gives one precise message", () => {
  const result = verify(MODULES, MODULES.replace("x + 1", "x + 2"));
  assert.equal(result.mismatchCount, 1);
  const [message] = result.mismatches;
  const at = position(MODULES, "1;\n  return y");
  assert.equal(
    message,
    `literal 1 vs 2\n    reference ${at} [src/core/a.js] \`const y = x + 1;\`` +
      `\n    candidate ${at} [src/core/a.js] \`const y = x + 2;\``,
  );
});

test("swapped arguments are reported at the call", () => {
  const result = verify(MODULES, MODULES.replace("combine(1, 2)", "combine(2, 1)"));
  assert.equal(result.mismatchCount, 1);
  assert.match(result.mismatches[0], /^CallExpression\.arguments: 1 moved\n/);
  assert.match(
    result.mismatches[0],
    /\[src\/core\/b\.js\] `register\("three", combine\(1, 2\)\);`/,
  );
  // Local bindings have the same fingerprint, so the swap shows as a renaming conflict.
  const locals = verify(
    "function f(a, b){ return g(a, b) } f(1, 2);",
    "function f(a, b){ return g(b, a) } f(1, 2);",
  );
  assert(!locals.equivalent);
  assert.match(locals.mismatches[0], /^inconsistent renaming: a -> b/);
});

test("a deleted or added top-level statement is reported alone, with its region", () => {
  const deleted = verify(MODULES, MODULES.replace('register("two", helper(2));\n', ""));
  assert.equal(deleted.mismatchCount, 1, deleted.mismatches.join("\n"));
  const two = position(MODULES, 'register("two"');
  assert.equal(
    deleted.mismatches[0],
    `statement missing in the candidate\n    reference ${two} [src/core/b.js] \`register("two", helper(2));\``,
  );
  assert.deepEqual(
    deleted.unmatched.reference.map(({ kind, line, region, excerpt }) => ({
      kind,
      line,
      region,
      excerpt,
    })),
    [
      {
        kind: "statement",
        line: Number(two.split(":")[0]),
        region: "src/core/b.js",
        excerpt: 'register("two", helper(2));',
      },
    ],
  );
  const added = verify(MODULES, MODULES.replace("// #endregion src/core/b.js", "audit();\n$&"));
  assert.equal(added.mismatchCount, 1, added.mismatches.join("\n"));
  const audit = position(MODULES.replace("// #endregion src/core/b.js", "audit();\n$&"), "audit");
  assert.equal(
    added.mismatches[0],
    `statement extra in the candidate\n    candidate ${audit} [src/core/b.js] \`audit();\``,
  );
  assert.equal(added.unmatched.candidate[0].excerpt, "audit();");
  // A statement that moved is reported as moved.
  const moved = verify(
    MODULES,
    MODULES.replace('register("one", helper(1));\n', "").replace(
      "// #endregion src/core/b.js",
      'register("one", helper(1));\n$&',
    ),
  );
  assert.equal(moved.mismatchCount, 1);
  assert.match(moved.mismatches[0], /^statement moved\n/);
});

test("differences inside a statement are aligned too: no cascade", () => {
  const logged = MODULES.replace("  const y = x + 1;\n", "  log(x);\n$&");
  const inner = verify(MODULES, logged);
  assert.equal(inner.mismatchCount, 1, inner.mismatches.join("\n"));
  assert.match(inner.mismatches[0], /^BlockStatement\.body: 1 extra in the candidate\n/);
  assert(inner.mismatches[0].endsWith(`extra: ${position(logged, "log(x)")} \`log(x);\``));
  const elements = verify(
    "const list = [a, b, void 0, c, void 0, d]; run(list);",
    "const list = [a, b, c, d]; run(list);",
  );
  assert.equal(elements.mismatchCount, 1);
  assert.match(elements.mismatches[0], /^ArrayExpression\.elements: 2 missing in the candidate\n/);
  // A changed property and an added one in the same object: two messages, nothing else.
  const object = verify(MODULES, MODULES.replace("{ a: 1, b: 2 }", "{ a: 3, b: 2, c: 4 }"));
  assert.equal(object.mismatchCount, 2, object.mismatches.join("\n"));
  assert.match(object.mismatches.join("\n"), /literal 1 vs 3/);
  assert.match(
    object.mismatches.join("\n"),
    /ObjectExpression\.properties: 1 extra in the candidate/,
  );
});

test("function declarations are reported by name", () => {
  const missing = verify(MODULES, MODULES.replace(/function helper[^]*?\n}\n/, ""));
  assert(!missing.equivalent);
  const functions = missing.unmatched.reference.filter((entry) => entry.kind === "function");
  assert.deepEqual(
    functions.map(({ name, region }) => ({ name, region })),
    [{ name: "helper", region: "src/core/a.js" }],
  );
  assert.match(missing.mismatches.join("\n"), /function helper is missing in the candidate/);
  const spare = MODULES.replace("// #endregion src/core/a.js", "function spare(){ return 0 }\n$&");
  const extra = verify(MODULES, spare);
  assert.equal(extra.mismatchCount, 1);
  assert.equal(
    extra.mismatches[0],
    `function spare exists only in the candidate\n    candidate ${position(spare, "function spare")} ` +
      "[src/core/a.js] `function spare(){ return 0 }`",
  );
});

test("the messages are capped but every difference is counted", () => {
  const reference = Array.from({ length: 30 }, (_, index) => `f(${index});`).join("\n");
  const candidate = Array.from({ length: 30 }, (_, index) => `f(${index + 100});`).join("\n");
  const result = verify(reference, candidate, { maxMismatches: 5 });
  assert.equal(result.mismatches.length, 5);
  assert.equal(result.mismatchCount, 30);
  assert.match(result.mismatches[0], /^literal 0 vs 100/);
});

// ---------------------------------------------------------------------------
// Holes
// ---------------------------------------------------------------------------
test("a hole matches whatever the candidate has at its place", () => {
  const reference = bundle("function f(){ return compute(1) } f();");
  const candidate = bundle("function f(){ return other(2, 3) } f();");
  const holes = [rangeOf(reference, "compute(1)")];
  assert(!verifyEquivalence(reference, candidate).equivalent);
  const result = verifyEquivalence(reference, candidate, { holes });
  assert(result.equivalent, result.mismatches.join("\n"));
  assert.equal(result.holesUsed, 1);
  assert.deepEqual(result.unusedHoles, []);
  // Only the node of exactly that range: the rest is still compared.
  const changed = bundle("function f(){ return other(2, 3) } g();");
  assert(!verifyEquivalence(reference, changed, { holes }).equivalent);
  // A range that is not a node's matches nothing and is reported unused.
  const off = verifyEquivalence(reference, candidate, { holes: [rangeOf(reference, "compute(")] });
  assert(!off.equivalent);
  assert.deepEqual(off.unusedHoles, [rangeOf(reference, "compute(")]);
});

test("each top-level statement inside a hole matches one candidate statement", () => {
  const reference = bundle("a();\nb(1);\nconst c = make(2);\nd(c);");
  const [start] = rangeOf(reference, "b(1);");
  const [, end] = rangeOf(reference, "const c = make(2);");
  const holes = [[start, end]];
  const resolved = verifyEquivalence(reference, bundle("a(); x(); const c = y(); d(c);"), {
    holes,
  });
  assert(resolved.equivalent, resolved.mismatches.join("\n"));
  assert.equal(resolved.holesUsed, 1);
  const fewer = verifyEquivalence(reference, bundle("a(); const c = y(); d(c);"), { holes });
  assert(!fewer.equivalent);
  assert.equal(fewer.unmatched.reference.length, 1);
  // A function declaration inside a hole pairs by name and is not compared.
  const functionHole = bundle("function f(){ return 1 } f();");
  assert(
    verifyEquivalence(functionHole, bundle("function f(){ return 2 } f();"), {
      holes: [rangeOf(functionHole, "function f(){ return 1 }")],
    }).equivalent,
  );
});

test("a hole inside a statement still lets the statement align", () => {
  const reference = bundle('const v = { a: 1, b: compute() };\nuse(v);\nlog("end");');
  const holes = [rangeOf(reference, "compute()")];
  const candidate = bundle('start();\nconst v = { a: 1, b: other(2) };\nuse(v);\nlog("end");');
  const result = verifyEquivalence(reference, candidate, { holes });
  assert.equal(result.mismatchCount, 1, result.mismatches.join("\n"));
  assert.match(result.mismatches[0], /^statement extra in the candidate/);
  assert.equal(result.holesUsed, 1);
});
