import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildUserscript } from "../../scripts/build.mjs";
import { checkModules } from "../../scripts/check-modules.mjs";
import { ROOT } from "../../scripts/lib/modules.mjs";

/** Writes a minimal project with the given modules (in manifest order) and returns its root. */
function project(modules, { globals = ["document"], runtime } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paletools-modules-"));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  write("src/userscript-header.js", "// ==UserScript==\n// ==/UserScript==\n");
  write(
    "src/runtime/webpack-runtime.js",
    '(() => {\n  var moduleFactories = {\n    723: (moduleRecord, moduleExports, importModule) => {\n      "use strict";\n      /* @modules */\n    },\n  };\n  moduleFactories[723]({}, {}, () => {});\n})();\n',
  );
  write(
    "src/external-globals.json",
    JSON.stringify({ browser: globals, ...(runtime && { runtime }) }),
  );
  for (const [file, text] of Object.entries(modules)) write(file, text);
  write(
    "src/manifest.json",
    JSON.stringify({
      output: "out.user.js",
      header: "src/userscript-header.js",
      runtime: "src/runtime/webpack-runtime.js",
      modules: Object.keys(modules).filter((file) => file.endsWith(".js")),
    }),
  );
  fs.copyFileSync(path.join(ROOT, ".prettierrc.json"), path.join(root, ".prettierrc.json"));
  return root;
}

function problems(modules, options) {
  const root = project(modules, options);
  try {
    return checkModules(root).errors;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const valid = {
  "src/a.js":
    'import css from "./a.css";\nconst greeting = "hi";\nexport function show() { document.title = greeting + css; }\n',
  "src/a.css": "body{}",
  "src/b.js": 'import { show } from "./a.js";\nshow();\n',
};

test("a consistent project has no problems and builds in manifest order", async () => {
  assert.deepEqual(problems(valid), []);
  const root = project(valid);
  try {
    const output = await buildUserscript(root);
    assert.match(output, /const css = "body\{\}";/);
    assert(output.indexOf("#region src/a.js") < output.indexOf("#region src/b.js"));
    assert.doesNotMatch(output, /\bimport\b|\bexport\b/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a binding used without importing it", () => {
  const errors = problems({ ...valid, "src/b.js": "show();\n" });
  assert(errors.some((error) => /uses show from src\/a\.js without importing it/.test(error)));
});

test("rejects import aliases, which concatenation would break", () => {
  const errors = problems({
    ...valid,
    "src/b.js": 'import { show as display } from "./a.js";\ndisplay();\n',
  });
  assert(errors.some((error) => /alias show as display/.test(error)));
});

test("rejects unknown globals, unused imports and unused exports", () => {
  assert(
    problems({ ...valid, "src/b.js": 'import { show } from "./a.js";\nshow(); windoww.x;\n' }).some(
      (e) => /unknown global windoww/.test(e),
    ),
  );
  assert(
    problems({ ...valid, "src/b.js": 'import { show, greeting } from "./a.js";\nshow();\n' }).some(
      (e) => /unused import greeting/.test(e),
    ),
  );
  assert(
    problems({ ...valid, "src/b.js": "document.title;\n" }).some((e) =>
      /export show is not imported/.test(e),
    ),
  );
});

test("allows an undeclared name of the original script only in the modules listed for it", () => {
  const root = project({ "src/a.js": "legacyName();\n", "src/b.js": "legacyName();\n" });
  try {
    const globalsPath = path.join(root, "src/external-globals.json");
    const globals = JSON.parse(fs.readFileSync(globalsPath, "utf8"));
    globals.undeclaredInOriginal = { legacyName: ["src/a.js"] };
    fs.writeFileSync(globalsPath, JSON.stringify(globals));
    assert.deepEqual(checkModules(root).errors, [
      "src/b.js:1: unknown global legacyName (add it to src/external-globals.json if intended)",
    ]);
    globals.undeclaredInOriginal = { legacyName: "src/a.js" };
    fs.writeFileSync(globalsPath, JSON.stringify(globals));
    assert(
      checkModules(root).errors.includes(
        "src/external-globals.json: undeclaredInOriginal.legacyName must be an array of module paths",
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects assignments to imported bindings unless the export is marked @mutable", () => {
  const owner = "export let count = 0;\nexport function read() { return count; }\n";
  const writer = 'import { count, read } from "./a.js";\ncount = 1;\nread();\n';
  assert(
    problems({ "src/a.js": owner, "src/b.js": writer }).some((e) =>
      /assigns imported binding count/.test(e),
    ),
  );
  const marked = "/** @mutable Reset by src/b.js. */\n" + owner;
  assert.deepEqual(problems({ "src/a.js": marked, "src/b.js": writer }), []);
});

test("rejects import cycles", () => {
  const errors = problems({
    "src/a.js": 'import { b } from "./b.js";\nexport function a() { return b(); }\n',
    "src/b.js": 'import { a } from "./a.js";\nexport function b() { return a(); }\n',
  });
  assert(errors.some((error) => /import cycle/.test(error)));
});

test("rejects top-level code reading a non-hoisted binding of a module that runs later", () => {
  const errors = problems({
    "src/a.js": 'import { late } from "./b.js";\nexport const early = late + 1;\n',
    "src/b.js":
      'export const late = 1;\nexport function useEarly() { return early; }\nimport { early } from "./a.js";\n',
  });
  assert(errors.some((error) => /reads late from src\/b\.js, which runs later/.test(error)));
});

test("rejects the same top-level name in two modules (they share one scope)", () => {
  const errors = problems({
    "src/a.js": "const shared = 1;\ndocument.a = shared;\n",
    "src/b.js": "const shared = 2;\ndocument.b = shared;\n",
  });
  assert(errors.some((error) => /shared is also declared in src\/a\.js/.test(error)));
});

test("the project itself passes every module check", () => {
  assert.deepEqual(checkModules(ROOT).errors, []);
});

test("rejects later-module reads in static class fields and in directly called functions", () => {
  const later = { "src/b.js": "export const later = 1;\n" };
  const staticField = problems({
    "src/a.js": 'import { later } from "./b.js";\nexport class K { static v = later; }\nnew K();\n',
    ...later,
    "src/c.js": 'import { K } from "./a.js";\ndocument.k = K;\n',
  });
  assert(staticField.some((e) => /reads later from src\/b\.js, which runs later/.test(e)));
  // Instance fields only run when the class is constructed.
  assert.deepEqual(
    problems({
      "src/a.js": 'import { later } from "./b.js";\nexport class K { v = later; }\n',
      ...later,
      "src/c.js": 'import { K } from "./a.js";\ndocument.k = new K();\n',
    }),
    [],
  );
  const called = problems({
    "src/a.js":
      'import { later } from "./b.js";\nfunction inner() { return later + 1; }\nfunction outer() { return inner(); }\nexport const early = outer();\n',
    ...later,
    "src/c.js": 'import { early } from "./a.js";\ndocument.e = early;\n',
  });
  assert(called.some((e) => /calls outer, which reads later from src\/b\.js/.test(e)));
  // A function that is only defined (or called later) may read anything.
  assert.deepEqual(
    problems({
      "src/a.js":
        'import { later } from "./b.js";\nexport function read() { return later; }\ndocument.f = read;\n',
      ...later,
      "src/c.js": 'import { read } from "./a.js";\ndocument.r = read();\n',
    }),
    [],
  );
});

test("rejects names and syntax that only work as ES modules", () => {
  const runtime = (source) =>
    problems(
      { "src/a.js": source },
      { globals: ["document"], runtime: ["moduleRecord", "moduleExports", "importModule"] },
    );
  assert(
    runtime("const moduleRecord = 1;\ndocument.x = moduleRecord;\n").some((e) =>
      /moduleRecord redeclares a parameter of webpack module 723/.test(e),
    ),
  );
  assert(
    runtime("document.x = import.meta.url;\n").some((e) => /import\.meta does not exist/.test(e)),
  );
  assert(runtime("document.x = this;\n").some((e) => /top-level this/.test(e)));
  assert.deepEqual(
    runtime("document.x = () => 1;\nfunction f() { return this; }\ndocument.f = f;\n"),
    [],
  );
});

test("the build inserts module code verbatim, including $ sequences", async () => {
  const modules = {
    "src/a.js": 'export const price = (n) => `$${n}`;\nexport const label = "cost $& $\' $` $$";\n',
    "src/b.js":
      'import style from "./b.css";\nimport { price, label } from "./a.js";\ndocument.title = price(5) + label + style;\n',
    "src/b.css": 'a::after { content: "$$"; }',
  };
  const root = project(modules);
  try {
    const output = await buildUserscript(root);
    assert(output.includes("`$${n}`"));
    assert(output.includes('"cost $& $\' $` $$"'));
    assert(output.includes('content: "$$";'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("follows every form of code that runs while a module is evaluated", () => {
  // Each src/a.js below runs code reading `later` (from src/b.js, which runs later) while it is
  // evaluated, so the built userscript would throw a TDZ ReferenceError.
  const runsLater = (moduleA, extra = {}) =>
    problems({
      "src/a.js": `import { later } from "./b.js";\n${moduleA}`,
      ...extra,
      "src/b.js": "export const later = 1;\n",
      "src/c.js": 'import { early } from "./a.js";\ndocument.e = early;\n',
    }).some((error) => /later from src\/b\.js/.test(error));
  assert(runsLater("export const early = (() => later + 1)();\n"), "arrow IIFE");
  assert(runsLater("export const early = (function () { return later; })();\n"), "IIFE");
  assert(
    runsLater(
      "function outer() { function inner() { return later; } return inner(); }\nexport const early = outer();\n",
    ),
    "nested function declaration",
  );
  assert(
    runsLater("let e;\n{ function g() { return later; } e = g(); }\nexport const early = e;\n"),
    "function declared in a block",
  );
  assert(runsLater("const f = () => later;\nexport const early = f();\n"), "arrow constant");
  assert(
    runsLater("class K { constructor() { this.v = later; } }\nexport const early = new K();\n"),
    "constructor",
  );
  assert(runsLater("class K { v = later; }\nexport const early = new K();\n"), "instance field");
  assert(
    runsLater(
      "class Base { constructor() { this.v = later; } }\nclass K extends Base {}\nexport const early = new K();\n",
    ),
    "base class constructor",
  );
  assert(
    runsLater("function outer() { return later; }\nexport const early = outer`x`;\n"),
    "tagged template call",
  );
  assert(
    runsLater("function outer() { return later; }\nexport const early = (0, outer)();\n"),
    "comma callee",
  );
  assert(
    runsLater("function F() { this.v = later; }\nexport const early = new F();\n"),
    "function constructor",
  );
  // A function-valued constant from another module that runs earlier.
  assert(
    problems({
      "src/u.js": 'import { later } from "./b.js";\nexport const helper = () => later;\n',
      "src/a.js": 'import { helper } from "./u.js";\nexport const early = helper();\n',
      "src/b.js": "export const later = 1;\n",
      "src/c.js": 'import { early } from "./a.js";\ndocument.e = early;\n',
    }).some((error) => /calls helper, which reads later from src\/b\.js/.test(error)),
  );
  // Module paths may contain '#'.
  assert(
    problems({
      "src/a#1.js":
        'import { later } from "./b.js";\nfunction outer() { return later; }\nexport const early = outer();\n',
      "src/b.js": "export const later = 1;\n",
      "src/c.js": 'import { early } from "./a#1.js";\ndocument.e = early;\n',
    }).some((error) => /calls outer, which reads later from src\/b\.js/.test(error)),
  );
  // Functions that are only passed around, and generators that are never resumed, run nothing.
  assert(
    !runsLater(
      "export const early = [() => later];\nfunction* gen() { yield later; }\ndocument.g = gen();\n",
    ),
  );
});

test("rejects module-only syntax anywhere it cannot work in the userscript", () => {
  const errors = (source) =>
    problems(
      { "src/a.js": source },
      { globals: ["document"], runtime: ["moduleRecord", "moduleExports", "importModule"] },
    );
  for (const source of [
    "function f() { return import.meta.url; }\ndocument.f = f;\n",
    "class K { m() { return import.meta.url; } }\ndocument.k = K;\n",
  ])
    assert(
      errors(source).some((e) => /import\.meta does not exist/.test(e)),
      source,
    );
  for (const source of [
    "document.x = () => this;\n",
    "class K { [this]() {} }\ndocument.k = K;\n",
    "class K extends (this ?? Object) {}\ndocument.k = K;\n",
  ])
    assert(
      errors(source).some((e) => /top-level this/.test(e)),
      source,
    );
  assert(errors("await document.ready;\n").some((e) => /top-level await/.test(e)));
  // `this` of functions, methods, field initializers and static blocks is their own.
  assert.deepEqual(
    errors(
      "function f() { return this; }\nclass K { v = this; static s = this; static { this.t = 1; } m() { return () => this; } }\ndocument.k = [f, K];\n",
    ),
    [],
  );
  assert(
    problems(
      {
        "src/a.js": 'import moduleRecord from "./a.css";\ndocument.x = moduleRecord;\n',
        "src/a.css": "a{}",
      },
      { globals: ["document"], runtime: ["moduleRecord"] },
    ).some((e) => /resource name moduleRecord redeclares a parameter/.test(e)),
  );
});
