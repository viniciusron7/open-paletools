// Unit tests of the three-way merge of scripts/upstream/ (lib/align.mjs, lib/merge.mjs,
// lib/render.mjs, lib/whole-text.mjs, lib/apply-src.mjs, lib/fix-links.mjs) on small synthetic
// userscripts shaped like a release.
//
// Each test has a base release B (minified style, `_0x` names), the project TG (B with this
// project's changes: readable names, plain statements, its own code, moved functions) and a new
// release OT (B with the release's changes, every top-level name renamed again by the obfuscator,
// another main module id). The core property of a port: merging OT's changes into TG (the port)
// and TG's changes into OT (the expected program) give the same program when nothing conflicts,
// and that program is the one written by hand in the test.
import assert from "node:assert/strict";
import test from "node:test";
import { verifyEquivalence } from "../../scripts/upstream/lib/equivalence.mjs";
import {
  assertConflicts,
  assertEquivalent,
  bundle,
  createProject,
  mainModuleText,
  mergeBothWays,
  operations,
  portRelease,
  readFile,
} from "../support/upstream-fixtures.mjs";

/** Merges both ways and checks port ≡ expected ≡ `want` (a main module body) and no conflict. */
function assertMerge({ base, target, other, want }) {
  const merged = mergeBothWays({ base, target, other });
  assertConflicts(merged.plan, []);
  assertConflicts(merged.expected.plan, []);
  assertEquivalent(merged.expected.text, merged.port.text, "port vs expected program");
  assertEquivalent(bundle(want), merged.port.text, "hand-written program vs port");
  assertEquivalent(bundle(want), merged.expected.text, "hand-written program vs expected program");
  assert.deepEqual(merged.port.missing, [], "every name of the release has a counterpart");
  return { ...merged, text: mainModuleText(merged.port.text) };
}

const includes = (text, ...parts) => {
  for (const part of parts) assert(text.includes(part), `${part}\n--- in\n${text}`);
};
const excludes = (text, ...parts) => {
  for (const part of parts) assert(!text.includes(part), `no ${part}\n--- in\n${text}`);
};

// ---------------------------------------------------------------------------------------------
// Changes inside functions
// ---------------------------------------------------------------------------------------------
test("a literal changed inside a function the project renamed keeps the project's names", () => {
  const { text, plan } = assertMerge({
    base: `
      const _0xa = "1.0.0";
      function _0x1(_0xp) { return _0xp + 1; }
      function _0x2(_0xq) { _0xq && _0x1(_0xq); return "old"; }
      _0x2(1);
      log(_0xa);`,
    target: `
      const _0xa = "1.0.0";
      /** Adds one. */
      function increment(value) {
        return value + 1;
      }
      function run(input) {
        if (input) {
          increment(input);
        }
        return "old";
      }
      run(1);
      log(_0xa);`,
    other: `
      const _0xb = "1.0.0";
      function _0x7(_0xr) { return _0xr + 1; }
      function _0x8(_0xs) { _0xs && _0x7(_0xs); return "new"; }
      _0x8(1);
      log(_0xb);`,
    want: `
      function increment(value) { return value + 1; }
      function run(input) { if (input) { increment(input); } return "new"; }
      run(1);
      log("1.0.0");`,
  });
  assert.deepEqual(operations(plan), ["replace"], "only the literal");
  includes(text, "/** Adds one. */", "function run(input) {", "increment(input);", 'return "new";');
  excludes(text, "_0x7", "_0x8", "_0xr", "_0xs", '"old"');
});

test("statements added and removed inside a function body", () => {
  const base = `
    function _0x1(_0xp) {
      start(_0xp);
      middle(_0xp);
      finish(_0xp);
      return _0xp;
    }
    _0x1(2);`;
  const target = `
    function process(value) {
      start(value);
      // the middle step
      middle(value);
      finish(value);
      return value;
    }
    process(2);`;
  const added = assertMerge({
    base,
    target,
    other: `
      function _0x5(_0xz) {
        start(_0xz);
        middle(_0xz);
        audit(_0xz, "after middle");
        finish(_0xz);
        return _0xz;
      }
      _0x5(2);`,
    want: `
      function process(value) {
        start(value); middle(value); audit(value, "after middle"); finish(value); return value;
      }
      process(2);`,
  });
  assert.deepEqual(operations(added.plan), ["insert"]);
  includes(added.text, "// the middle step", 'audit(value, "after middle");');
  const removed = assertMerge({
    base,
    target,
    other: `
      function _0x5(_0xz) {
        start(_0xz);
        finish(_0xz);
        return _0xz;
      }
      _0x5(2);`,
    want: `function process(value) { start(value); finish(value); return value; } process(2);`,
  });
  assert.deepEqual(operations(removed.plan), ["remove"]);
  excludes(removed.text, "middle");
});

test("an argument added to a call and an else branch added (setChild)", () => {
  const { text, plan } = assertMerge({
    base: `
      function _0x1(_0xp) {
        finish(_0xp, 1);
        if (_0xp > 1) { big(); }
        return _0xp;
      }
      _0x1(2);`,
    target: `
      function process(value) {
        finish(value, 1);
        if (value > 1) {
          big();
        }
        return value;
      }
      process(2);`,
    other: `
      function _0x5(_0xz) {
        finish(_0xz, 1, true);
        if (_0xz > 1) big(); else small(_0xz);
        return _0xz;
      }
      _0x5(2);`,
    want: `
      function process(value) {
        finish(value, 1, true);
        if (value > 1) { big(); } else { small(value); }
        return value;
      }
      process(2);`,
  });
  assert.deepEqual(operations(plan).sort(), ["insert", "setChild"]);
  assert.equal(plan.ops.find((operation) => operation.op === "setChild").key, "alternate");
  includes(text, "finish(value, 1, true);", "small(value)");
});

// ---------------------------------------------------------------------------------------------
// Top-level statements
// ---------------------------------------------------------------------------------------------
test("a new top-level function and statement follow their predecessor in the release", () => {
  const { text, port } = assertMerge({
    base: `
      function _0x1(_0xp) { return _0xp * 2; }
      function _0x2(_0xp) { return _0xp + 3; }
      register("one", _0x1);
      register("two", _0x2);
      register("three", combine);`,
    // The project grouped its functions at the end (as its modules do) and added its own tool.
    target: `
      register("one", double);
      register("two", addThree);
      register("three", combine);
      registerOwnTool("mine");
      function addThree(value) { return value + 3; }
      function double(value) { return value * 2; }`,
    other: `
      function _0x7(_0xa) { return _0xa * 2; }
      function _0x8(_0xa) { return _0xa + 3; }
      function _0x9(_0xa) { return _0x7(_0x8(_0xa)); }
      register("one", _0x7);
      register("two", _0x8);
      register("combo", _0x9);
      register("three", combine);`,
    want: `
      register("one", double);
      register("two", addThree);
      register("combo", combo);
      register("three", combine);
      registerOwnTool("mine");
      function addThree(value) { return value + 3; }
      function double(value) { return value * 2; }
      function combo(value) { return double(addThree(value)); }`,
  });
  // New code keeps the release's own names, and calls the project's names.
  includes(text, "double(addThree(");
  const order = ['register("two"', 'register("combo"', 'register("three"', "registerOwnTool"];
  const positions = order.map((part) => text.indexOf(part));
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
    "evaluation order",
  );
  assert(positions.every((position) => position >= 0));
  // The text is the project's, with the release's statements inserted.
  assert(port.text.includes('registerOwnTool("mine");\n      function addThree'));
});

test("a top-level statement the release moved: the order follows the release", () => {
  const { text, plan } = assertMerge({
    base: `setup(); configure(1); load("a"); load("b"); start();`,
    target: `
      setup();
      // configure it
      configure(1);
      load("a");
      load("b");
      start();`,
    other: `setup(); load("a"); load("b"); configure(1); start();`,
    want: `setup(); load("a"); load("b"); configure(1); start();`,
  });
  assert.deepEqual(operations(plan), ["move"]);
  includes(text, "// configure it\n      configure(1);\n      start();");
});

test("at the top level the release's new statements come before the project's (same place)", () => {
  assertMerge({
    base: `first(); last();`,
    target: `first(); myTool(); last();`,
    other: `first(); theirTool(); last();`,
    want: `first(); theirTool(); myTool(); last();`,
  });
  // Also at the start of the module.
  assertMerge({
    base: `a(); b();`,
    target: `mine(); a(); b();`,
    other: `theirs(); a(); b();`,
    want: `theirs(); mine(); a(); b();`,
  });
});

test("in nested lists the project's new elements come first, then the release's", () => {
  const { text } = assertMerge({
    base: `
      const _0xl = [alpha, beta];
      first(_0xl);`,
    target: `
      const plugins = [alpha, mine, beta];
      first(plugins);`,
    other: `
      const _0xm = [alpha, theirs, beta];
      first(_0xm);`,
    want: `const plugins = [alpha, mine, theirs, beta]; first(plugins);`,
  });
  includes(text, "const plugins = [alpha, mine, theirs, beta];");
  assertMerge({
    base: `f([a]);`,
    target: `f([mine, a]);`,
    other: `f([theirs, a]);`,
    want: `f([mine, theirs, a]);`,
  });
});

// Both sides append at the END of a list (no element of the base after them). The port inserts
// the release's elements with placement "beforeRight" (nested) or "afterLeft" (top level); the
// expected program inserts the project's with the other placement. Overlay.insertInto (render.mjs)
// ignores "beforeRight" when `before` is null: it inserts right after `after` (before the target's
// own new elements) instead of at the end, so the two directions give different orders.
test("both sides append to the end of a nested list: the project's elements come first", {}, () => {
  assertMerge({
    base: `f([a]);`,
    target: `f([a, mine]);`,
    other: `f([a, theirs]);`,
    want: `f([a, mine, theirs]);`,
  });
});

test(
  "both sides append to the end of a function body: the project's statements come first",
  {},
  () => {
    assertMerge({
      base: `function _0xf() { a(); } _0xf();`,
      target: `function run() { a(); mine(); } run();`,
      other: `function _0xg() { a(); theirs(); } _0xg();`,
      want: `function run() { a(); mine(); theirs(); } run();`,
    });
  },
);

test(
  "both sides append to the end of the main module: the release's statements come first",
  {},
  () => {
    assertMerge({
      base: `a(); b();`,
      target: `a(); b(); mine();`,
      other: `a(); b(); theirs();`,
      want: `a(); b(); theirs(); mine();`,
    });
  },
);

// ---------------------------------------------------------------------------------------------
// Objects and classes
// ---------------------------------------------------------------------------------------------
test("object properties added, removed and changed are aligned by key", () => {
  const { text } = assertMerge({
    base: `
      const _0xs = { color: "red", size: 10, legacy: true, label: "x" };
      apply(_0xs);`,
    target: `
      const settings = {
        color: "red",
        size: 10,
        myOption: 1,
        legacy: true,
        label: "x",
      };
      apply(settings);`,
    other: `
      const _0xt = { color: "red", size: 12, shape: "round", label: "x" };
      apply(_0xt);`,
    want: `apply({ color: "red", size: 12, myOption: 1, shape: "round", label: "x" });`,
  });
  includes(text, "const settings = {", "size: 12", "myOption: 1", 'shape: "round"');
  excludes(text, "legacy");
  // Properties the release reordered.
  assertMerge({
    base: `f({ a: 1, b: 2, c: 3 });`,
    target: `f({ a: 1, b: 2, c: 30 });`,
    other: `f({ b: 2, a: 1, c: 3 });`,
    want: `f({ b: 2, a: 1, c: 30 });`,
  });
});

test("class members added and changed; #private names renamed by the obfuscator are no change", () => {
  const base = `
    class _0xC {
      #a = 0;
      #b = 1;
      constructor(_0xn) { this.#a = _0xn; }
      get value() { return this.#a + this.#b; }
      reset() { this.#a = 0; }
    }
    use(new _0xC(1));`;
  const target = `
    class Counter {
      #a = 0;
      #b = 1;
      constructor(start) {
        this.#a = start;
      }
      get value() {
        return this.#a + this.#b;
      }
      // (no private name: see the next test)
      myMethod() {
        return this.value * 2;
      }
      reset() {
        this.#a = 0;
      }
    }
    use(new Counter(1));`;
  // Only the private names: nothing to do.
  const renamed = mergeBothWays({
    base,
    target,
    other: base.replaceAll("#a", "#x").replaceAll("#b", "#y").replaceAll("_0xC", "_0xD"),
  });
  assert.deepEqual(renamed.plan.ops, []);
  assert.equal(renamed.port.text, bundle(target));
  // A literal changed and a method added (both without private names, see the next test).
  const { text } = assertMerge({
    base,
    target,
    other: `
      class _0xD {
        #x = 0;
        #y = 1;
        constructor(_0xn) { this.#x = _0xn; }
        get value() { return this.#x + this.#y; }
        static create() { return new _0xD(0); }
        reset() { this.#x = 10; }
      }
      use(new _0xD(1));`,
    want: `
      class Counter {
        #a = 0;
        #b = 1;
        constructor(start) { this.#a = start; }
        get value() { return this.#a + this.#b; }
        myMethod() { return this.value * 2; }
        static create() { return new Counter(0); }
        reset() { this.#a = 10; }
      }
      use(new Counter(1));`,
  });
  includes(text, "this.#a = 10;", "new Counter(0)");
  excludes(text, "#x", "_0xD");
});

// The private names learned inside a modified class are recorded without their class: pairVariables
// (align.mjs) prefixes a private name with the start of the nearest ClassBody on its own walk
// stack, which is empty when learnTolerant/planMerge call it on a member below the ClassBody. The
// map then holds "#a" -> "#x", while createRenamers (whole-text.mjs) looks up "<class start>#x":
// release code that uses a renamed private name is printed with the release's name, a
// SyntaxError in the target's class; likewise the expected program prints a method the project
// added (using "#a") into the release's class, which declares "#x".
test(
  "release code using renamed #private members is printed with the target's private names",
  {},
  () => {
    assertMerge({
      base: `
        class _0xC { #a = 0; #b = 1; reset() { this.#a = 0; } }
        use(new _0xC());`,
      target: `
        class Counter { #a = 0; #b = 1; mine() { return this.#a; } reset() { this.#a = 0; } }
        use(new Counter());`,
      other: `
        class _0xD { #x = 0; #y = 1; reset() { this.#x = this.#y; } }
        use(new _0xD());`,
      want: `
        class Counter { #a = 0; #b = 1; mine() { return this.#a; } reset() { this.#a = this.#b; } }
        use(new Counter());`,
    });
  },
);

// ---------------------------------------------------------------------------------------------
// Inlined constants
// ---------------------------------------------------------------------------------------------
test("a CSS constant read once is changed at its declaration", () => {
  const { text, port } = assertMerge({
    base: `
      const _0xcss = ".a { color: red; }";
      function _0xi() { addStyle(_0xcss); }
      _0xi();`,
    target: `
      // styles of the market tools
      const marketCss = ".a { color: red; }";
      function installStyles() {
        addStyle(marketCss);
      }
      installStyles();`,
    other: `
      const _0xk = ".a { color: blue; }";
      function _0xj() { addStyle(_0xk); }
      _0xj();`,
    want: `function installStyles() { addStyle(".a { color: blue; }"); } installStyles();`,
  });
  assert.deepEqual(
    port.remote.map((edit) => edit.text),
    ['".a { color: blue; }"'],
  );
  includes(text, '// styles of the market tools\n      const marketCss = ".a { color: blue; }";');
  includes(text, "addStyle(marketCss);");
});

test("a constant read several times, changed identically at every read, changes at its declaration", () => {
  const { text, port } = assertMerge({
    base: `
      const _0xv = "27.1.5";
      function _0xh() { return header("Paletools", _0xv, document.title); }
      function _0xf() { return footer("version", _0xv, location.href); }
      render(_0xh(), _0xf());`,
    target: `
      // the release this project follows
      const paletoolsVersion = "27.1.5";
      function renderHeader() {
        return header("Paletools", paletoolsVersion, document.title);
      }
      function renderFooter() {
        return footer("version", paletoolsVersion, location.href);
      }
      render(renderHeader(), renderFooter());`,
    other: `
      const _0xw = "27.2.1";
      function _0xa() { return header("Paletools", _0xw, document.title); }
      function _0xb() { return footer("version", _0xw, location.href); }
      render(_0xa(), _0xb());`,
    want: `
      function renderHeader() { return header("Paletools", "27.2.1", document.title); }
      function renderFooter() { return footer("version", "27.2.1", location.href); }
      render(renderHeader(), renderFooter());`,
  });
  assert.equal(port.remote.length, 1);
  includes(text, 'const paletoolsVersion = "27.2.1";');
  assert.equal(text.match(/paletoolsVersion/g).length, 3, "the reads are kept");
  excludes(text, "27.1.5");
});

test("a translation table (an object read once) is changed where it is declared", () => {
  const { text } = assertMerge({
    base: `
      const _0xt = { en: { hello: "Hello" }, fr: { hello: "Bonjour" } };
      setup(_0xt);`,
    target: `
      const translations = {
        en: { hello: "Hello" },
        fr: { hello: "Bonjour" },
      };
      setup(translations);`,
    other: `
      const _0xu = { en: { hello: "Hello" }, fr: { hello: "Salut" } };
      setup(_0xu);`,
    want: `setup({ en: { hello: "Hello" }, fr: { hello: "Salut" } });`,
  });
  includes(text, 'fr: { hello: "Salut" },', "setup(translations);");
});

// ---------------------------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------------------------
test("both sides change the same literal: one conflict, this project's version is kept on both sides", () => {
  const merged = mergeBothWays({
    base: `function _0xd(_0xp) { return wait(_0xp, 500); } _0xd(1);`,
    target: `function delay(ms) { return wait(ms, 750); } delay(1);`,
    other: `function _0xe(_0xq) { return wait(_0xq, 1000); } _0xe(1);`,
  });
  assertConflicts(merged.plan, ["both-changed"]);
  assertConflicts(merged.expected.plan, ["both-changed"]);
  const [conflict] = merged.plan.conflicts;
  const source = (side, node) => side.source.slice(node.range[0], node.range[1]);
  assert.deepEqual(
    [
      source(merged.B, conflict.base),
      source(merged.TG, conflict.target),
      source(merged.OT, conflict.other),
    ],
    ["500", "750", "1000"],
  );
  assert.deepEqual(merged.plan.ops, []);
  assert.equal(merged.port.text, bundle(`function delay(ms) { return wait(ms, 750); } delay(1);`));
  // At a conflict the expected program follows this project too, so both agree without holes.
  assertEquivalent(bundle(`function f(x) { return wait(x, 750); } f(1);`), merged.expected.text);
  assertEquivalent(merged.expected.text, merged.port.text, "port and expected program agree");
});

test("the release removes a statement the project changed: removed-but-changed", () => {
  const top = mergeBothWays({
    base: `setup(); legacy("old", 1); start();`,
    target: `setup(); legacy("old", 2); start();`,
    other: `setup(); start();`,
  });
  assertConflicts(top.plan, ["removed-but-changed"]);
  assertConflicts(top.expected.plan, ["changed-but-removed"]);
  assert.equal(top.port.text, bundle(`setup(); legacy("old", 2); start();`));
  const nested = mergeBothWays({
    base: `function _0xs() { setup(); legacy("old", 1); start(); } _0xs();`,
    target: `function boot() { setup(); legacy("old", 2); start(); } boot();`,
    other: `function _0xt() { setup(); start(); } _0xt();`,
  });
  assertConflicts(nested.plan, ["removed-but-changed"]);
  assert.equal(
    nested.port.text,
    bundle(`function boot() { setup(); legacy("old", 2); start(); } boot();`),
  );
});

// ---------------------------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------------------------
const IDENTITY_BASE = `
const _0xcss = ".x { margin: 0 }";
const _0xv = "1.0";
const _0xt = { en: { hello: "Hello" }, fr: { hello: "Bonjour" } };
function _0x1(_0xp) { _0xp && _0x2(_0xp); return _0xp ? 1 : 2; }
function _0x2(_0xq) { return (_0xq.a = 1, _0xq.b = 2, _0xq); }
class _0xK { #a = 1; get v() { return this.#a; } }
let _0xs;
setup(_0xt);
_0xs = new _0xK();
addStyle(_0xcss);
log(_0xv, _0x1({}), _0xs.v);
`;
// The project: readable names and statements, regions, functions grouped, its own tool.
const IDENTITY_TARGET = `
// #region src/a.js
const styles = ".x { margin: 0 }";
const version = "1.0";
const translations = {
  en: { hello: "Hello" },
  fr: { hello: "Bonjour" },
};
class Store {
  #value = 1;
  get v() {
    return this.#value;
  }
}
setup(translations);
let store;
store = new Store();
// #endregion src/a.js
// #region src/b.js
addStyle(styles);
myTool();
log(version, check({}), store.v);
function check(item) {
  if (item) {
    assign(item);
  }
  return item ? 1 : 2;
}
function assign(target) {
  target.a = 1;
  target.b = 2;
  return target;
}
// #endregion src/b.js
`;

test("identity: a release without changes leaves the project as it is", () => {
  for (const other of [IDENTITY_BASE, IDENTITY_BASE.replace(/_0x/g, "_0y")]) {
    const merged = mergeBothWays({ base: IDENTITY_BASE, target: IDENTITY_TARGET, other });
    assertConflicts(merged.plan, []);
    assert.deepEqual(merged.plan.ops, []);
    assert.equal(merged.port.text, bundle(IDENTITY_TARGET), "the project's text, unchanged");
    assertEquivalent(merged.port.text, merged.expected.text);
  }
});

test("identity: a project without changes becomes the new release", () => {
  const other = IDENTITY_BASE.replace(/_0x/g, "_0y")
    .replace('"Bonjour"', '"Salut"')
    .replace("return _0yp ? 1 : 2", "return _0yp ? 1 : 3")
    .replace("log(_0yv", "extra(); log(_0yv");
  const merged = mergeBothWays({ base: IDENTITY_BASE, target: IDENTITY_BASE, other });
  assertConflicts(merged.plan, []);
  assertEquivalent(bundle(other), merged.port.text);
  assert.equal(merged.expected.text, bundle(other, { id: 909 }), "the release's text, unchanged");
  // And the project's changes with the release's.
  assertMerge({
    base: IDENTITY_BASE,
    target: IDENTITY_TARGET,
    other,
    want: IDENTITY_TARGET.replace('"Bonjour"', '"Salut"')
      .replace("return item ? 1 : 2", "return item ? 1 : 3")
      .replace("myTool();", "extra();\nmyTool();"),
  });
});

// ---------------------------------------------------------------------------------------------
// A port written into the module files of a tiny project
// ---------------------------------------------------------------------------------------------
const PROJECT_MODULES = {
  "src/core/util.js": `// Number helpers shared by the tools.

/** Formats a price with two decimals. */
export function formatPrice(value) {
  // EA shows coins without decimals, the tools with two.
  return value.toFixed(2);
}

/** Keeps a value between min and max. */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
`,
  "src/plugins/tool.js": `import { formatPrice } from "../core/util.js";
import toolCss from "./tool.css";

/** The price tool of the release. */
export function showPrice(price) {
  addStyle(toolCss);
  return formatPrice(price);
}
`,
  // A tool of this project, not in the release: it must survive the port untouched.
  "src/plugins/mine.js": `import { clamp } from "../core/util.js";

// A tool of this project (not in the release).
export function myDiscount(price) {
  return clamp(price * 0.9, 0, 1000);
}
`,
  "src/main.js": `import { myDiscount } from "./plugins/mine.js";
import { showPrice } from "./plugins/tool.js";

// Boot: show the first price.
showPrice(10);
myDiscount(5);
addStyle(".ready {}");
`,
};

test("a port is written into the module files minimally, with imports and resources", async (t) => {
  const project = createProject({
    modules: PROJECT_MODULES,
    assets: { "src/plugins/tool.css": ".tool { color: red; }\n" },
  });
  t.after(project.cleanup);
  const { root } = project;
  const result = await portRelease(root, {
    // The base release: the project's program in the minified style of a release.
    baseBody: `
      const _0xc = ".tool { color: red; }\\n";
      function _0x1(_0xa) { return _0xa.toFixed(2); }
      function _0x2(_0xa, _0xb, _0xd) { return Math.min(Math.max(_0xa, _0xb), _0xd); }
      function _0x3(_0xa) { return addStyle(_0xc), _0x1(_0xa); }
      _0x3(10);
      addStyle(".ready {}");`,
    // The new release: new CSS, a literal changed, showPrice uses clamp, a new function and a
    // new statement.
    releaseBody: `
      const _0xk = ".tool { color: blue; }\\n";
      function _0x7(_0xa) { return _0xa.toFixed(3); }
      function _0x8(_0xa, _0xb, _0xd) { return Math.min(Math.max(_0xa, _0xb), _0xd); }
      function _0x9(_0xa) { return addStyle(_0xk), _0x7(_0x8(_0xa, 0, 999)); }
      function _0xA(_0xa) { return _0x7(_0xa) + " coins"; }
      _0x9(10);
      document.title = _0xA(20);
      addStyle(".ready {}");`,
  });
  assertConflicts(result.plan, []);
  assert.deepEqual(result.applied.problems, []);
  assert.deepEqual(result.applied.missing, []);
  assert.deepEqual(result.links.unresolved, []);
  assert.deepEqual(result.checkErrors, [], "npm run check:modules passes");
  assert(result.verification.equivalent, result.verification.mismatches.join("\n"));
  // The modules changed minimally: comments, names and layout kept.
  assert.equal(
    readFile(root, "src/core/util.js"),
    PROJECT_MODULES["src/core/util.js"].replace("toFixed(2)", "toFixed(3)"),
  );
  assert.equal(
    readFile(root, "src/plugins/tool.js"),
    PROJECT_MODULES["src/plugins/tool.js"]
      .replace("import { formatPrice }", "import { clamp, formatPrice }")
      .replace("formatPrice(price);", "formatPrice(clamp(price, 0, 999));") +
      `\nexport function _0xA(_0xa) {\n  return formatPrice(_0xa) + " coins";\n}\n`,
    "a new import (clamp), and the new function next to its predecessor, exported",
  );
  assert.equal(
    readFile(root, "src/main.js"),
    PROJECT_MODULES["src/main.js"]
      .replace("import { showPrice }", "import { _0xA, showPrice }")
      .replace("showPrice(10);\n", "showPrice(10);\n\ndocument.title = _0xA(20);\n"),
    "the release's statement right after its predecessor, before the project's",
  );
  assert.equal(readFile(root, "src/plugins/mine.js"), PROJECT_MODULES["src/plugins/mine.js"]);
  assert(!result.applied.files.has("src/plugins/mine.js"));
  // The embedded resource is rewritten.
  assert.equal(readFile(root, "src/plugins/tool.css"), ".tool { color: blue; }\n");
  assert.deepEqual([...result.applied.assets.keys()], ["src/plugins/tool.css"]);
  assert.equal(readFile(root, "src/manifest.json").includes("upstream-new"), false);
});
