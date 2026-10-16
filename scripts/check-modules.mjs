#!/usr/bin/env node
// Static checks for the modules listed in src/manifest.json.
//
// The build concatenates all modules into one scope (webpack module 723), so the import and
// export declarations are the only place where dependencies are visible. This script makes
// sure they are complete and truthful:
//   * every identifier a module uses is declared in it, imported, provided by the webpack
//     runtime, or listed in src/external-globals.json (Web App, browser and userscript APIs;
//     the names the original script uses undeclared only in the modules listed for them);
//   * every import names an export of a module in the manifest, under the same name (aliases
//     would not survive concatenation), and is used; imported bindings are never assigned,
//     except `export let` bindings marked `@mutable`;
//   * top-level names are unique across the project and never redeclare a parameter of webpack
//     module 723; modules use no ES-module-only syntax or semantics (`import.meta`, top-level
//     `await` or `this`);
//   * there are no import cycles and no unused exports;
//   * a module's top-level code never reads a non-hoisted binding of a module that runs later:
//     directly (also in static class fields and immediately invoked functions) or in code it
//     calls directly (functions, function-valued constants, constructors and instance fields
//     of classes, followed transitively). The analysis is flow-insensitive (a read in a branch
//     that never runs counts) and does not follow calls through objects, methods, callbacks
//     or `.call`/`.apply`/`.bind`; the declaration order inside one module is not checked.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { analyze } from "eslint-scope";
import { childKeys, isMainModule, isNode, walk } from "./lib/ast.mjs";
import { analyzeProject, ROOT } from "./lib/modules.mjs";

export const EXTERNAL_GLOBALS_PATH = "src/external-globals.json";

/** Globals every JavaScript realm provides (Object, Promise, JSON, parseInt, ...). */
const ECMASCRIPT_GLOBALS = new Set(vm.runInNewContext("Object.getOwnPropertyNames(globalThis)"));

function moduleScopeOf(scopeManager) {
  return scopeManager.scopes.find((scope) => scope.type === "module");
}

/**
 * True when a reference made from `scope` executes as soon as code in `boundary` (the module
 * scope, or a function scope) runs: not inside a nested function or an instance field
 * initializer. Static field initializers run when the class is defined.
 */
function runsWith(scope, boundary, staticInitializers, parents) {
  for (let current = scope; current; current = current.upper) {
    if (current === boundary) return true;
    if (current.type === "function") {
      const parent = parents.get(current.block);
      const invoked =
        parent &&
        /^(Call|New)Expression$/.test(parent.type) &&
        parent.callee === current.block &&
        !current.block.generator;
      if (!invoked) return false;
      continue;
    }
    if (current.type === "class-field-initializer" && !staticInitializers.has(current.block))
      return false;
  }
  return false;
}

/** Facts about one module's syntax that scope analysis does not give. */
function syntaxFacts(program) {
  const parents = new Map();
  const staticInitializers = new Set();
  walk(program, (node, parent) => {
    parents.set(node, parent);
    if (node.type === "PropertyDefinition" && node.static && node.value)
      staticInitializers.add(node.value);
  });
  // `this` outside any non-arrow function or class element body; import.meta and top-level
  // await anywhere they cannot exist in a classic script.
  const topLevelThis = [];
  const importMeta = [];
  const topLevelAwait = [];
  const visit = (node, thisScoped, inFunction) => {
    if (node.type === "MetaProperty" && node.meta.name === "import") importMeta.push(node);
    if (node.type === "ThisExpression" && !thisScoped) topLevelThis.push(node);
    if (node.type === "AwaitExpression" && !inFunction) topLevelAwait.push(node);
    if (node.type === "ForOfStatement" && node.await && !inFunction) topLevelAwait.push(node);
    for (const key of childKeys(node)) {
      for (const child of [].concat(node[key])) {
        if (!isNode(child)) continue;
        const isFn = /^(FunctionDeclaration|FunctionExpression)$/.test(child.type);
        const isArrow = child.type === "ArrowFunctionExpression";
        // Class element bodies (field initializers, static blocks) have their own `this`;
        // computed keys and the heritage clause do not.
        const classValue =
          (node.type === "PropertyDefinition" && key === "value") || node.type === "StaticBlock";
        visit(
          child,
          thisScoped || isFn || classValue,
          inFunction || isFn || isArrow || node.type === "StaticBlock",
        );
      }
    }
  };
  visit(program, false, false);
  // `f()`, `new f()`, `` f`x` `` and `(0, f)()` call f.
  const isCallee = (identifier) => {
    let node = identifier;
    let parent = parents.get(node);
    if (parent?.type === "SequenceExpression" && parent.expressions.at(-1) === node) {
      node = parent;
      parent = parents.get(node);
    }
    if (parent?.type === "TaggedTemplateExpression") return parent.tag === node;
    return (
      (parent?.type === "CallExpression" || parent?.type === "NewExpression") &&
      parent.callee === node
    );
  };
  return { staticInitializers, topLevelThis, importMeta, topLevelAwait, isCallee, parents };
}

export function checkModules(root = ROOT) {
  const errors = [];
  const { manifest, modules } = analyzeProject(root);
  const external = JSON.parse(fs.readFileSync(path.join(root, EXTERNAL_GLOBALS_PATH), "utf8"));
  const allowedGlobals = new Set([
    ...ECMASCRIPT_GLOBALS,
    ...Object.entries(external)
      .filter(([key]) => !key.startsWith("$") && key !== "undeclaredInOriginal")
      .flatMap(([, names]) => names),
  ]);
  // Names the original script uses without declaring them, each allowed only in its modules.
  const undeclaredInOriginal = new Map(Object.entries(external.undeclaredInOriginal ?? {}));
  for (const [name, modulePaths] of undeclaredInOriginal) {
    if (!Array.isArray(modulePaths) || !modulePaths.every((item) => typeof item === "string")) {
      errors.push(
        `${EXTERNAL_GLOBALS_PATH}: undeclaredInOriginal.${name} must be an array of module paths`,
      );
      undeclaredInOriginal.delete(name);
    }
  }
  const isUndeclaredInOriginal = (name, modulePath) =>
    undeclaredInOriginal.get(name)?.includes(modulePath) ?? false;
  const order = new Map(manifest.modules.map((modulePath, index) => [modulePath, index]));
  // The parameters of module 723: a top-level declaration with one of these names would be a
  // redeclaration (a SyntaxError) or would shadow the runtime for every module.
  const runtimeNames = new Set(external.runtime ?? []);

  const declaredBy = new Map(); // top-level name -> module path
  const info = new Map();
  for (const module of modules) {
    const scopeManager = analyze(module.program, { ecmaVersion: 2022, sourceType: "module" });
    const moduleScope = moduleScopeOf(scopeManager);
    const facts = syntaxFacts(module.program);
    const declarations = new Map();
    for (const variable of moduleScope.variables) {
      if (variable.defs[0]?.type === "ImportBinding") continue;
      declarations.set(variable.name, variable);
      if (runtimeNames.has(variable.name))
        errors.push(
          `${module.modulePath}: top-level name ${variable.name} redeclares a parameter of webpack module 723`,
        );
      const previous = declaredBy.get(variable.name);
      if (previous)
        errors.push(
          `${module.modulePath}: top-level name ${variable.name} is also declared in ${previous}`,
        );
      else declaredBy.set(variable.name, module.modulePath);
    }
    for (const node of facts.importMeta)
      errors.push(
        `${module.modulePath}:${node.loc.start.line}: import.meta does not exist in the userscript`,
      );
    for (const node of facts.topLevelAwait)
      errors.push(
        `${module.modulePath}:${node.loc.start.line}: top-level await does not exist in the userscript`,
      );
    for (const node of facts.topLevelThis)
      errors.push(
        `${module.modulePath}:${node.loc.start.line}: top-level this is undefined in a module but not in the userscript`,
      );
    const importsByLocal = new Map(module.imports.map((entry) => [entry.local, entry]));
    info.set(module.modulePath, {
      module,
      scopeManager,
      moduleScope,
      declarations,
      facts,
      importsByLocal,
    });
  }
  for (const module of modules) {
    for (const entry of module.imports.filter((item) => item.asset)) {
      if (runtimeNames.has(entry.local))
        errors.push(
          `${module.modulePath}: resource name ${entry.local} redeclares a parameter of webpack module 723`,
        );
      const previous = declaredBy.get(entry.local);
      if (previous && previous !== `resource:${entry.from}`)
        errors.push(
          `${module.modulePath}: resource name ${entry.local} clashes with a declaration in ${previous}`,
        );
      declaredBy.set(entry.local, `resource:${entry.from}`);
    }
  }

  const exportsOf = new Map(
    modules.map((module) => [module.modulePath, new Set(module.exports.map((item) => item.name))]),
  );
  const mutableExports = new Set(
    modules.flatMap((module) =>
      module.exports
        .filter((item) => item.mutable)
        .map((item) => `${module.modulePath}#${item.name}`),
    ),
  );
  const usedExports = new Set();
  const edges = new Map(modules.map((module) => [module.modulePath, new Set()]));

  for (const module of modules) {
    const { scopeManager, moduleScope, declarations, facts, importsByLocal } = info.get(
      module.modulePath,
    );
    for (const exported of module.exports) {
      if (!declarations.has(exported.name))
        errors.push(`${module.modulePath}: exports undeclared ${exported.name}`);
    }
    for (const entry of module.imports) {
      if (entry.asset) {
        if (!fs.existsSync(path.join(root, entry.from)))
          errors.push(`${module.modulePath}: missing resource ${entry.from}`);
        continue;
      }
      if (!order.has(entry.from)) {
        errors.push(`${module.modulePath}: imports ${entry.from}, which is not in the manifest`);
        continue;
      }
      if (entry.local !== entry.imported)
        errors.push(
          `${module.modulePath}: import alias ${entry.imported} as ${entry.local} is not allowed`,
        );
      if (!exportsOf.get(entry.from).has(entry.imported))
        errors.push(`${module.modulePath}: ${entry.from} does not export ${entry.imported}`);
      usedExports.add(`${entry.from}#${entry.imported}`);
      if (entry.from === module.modulePath) errors.push(`${module.modulePath}: imports itself`);
      edges.get(module.modulePath).add(entry.from);
    }
    for (const variable of moduleScope.variables) {
      if (variable.defs[0]?.type !== "ImportBinding") continue;
      const entry = importsByLocal.get(variable.name);
      if (variable.references.length === 0)
        errors.push(`${module.modulePath}: unused import ${variable.name}`);
      for (const reference of variable.references) {
        const mutable = !entry.asset && mutableExports.has(`${entry.from}#${entry.imported}`);
        if (reference.isWrite() && !mutable)
          errors.push(
            `${module.modulePath}:${reference.identifier.loc.start.line}: assigns imported binding ${variable.name} (move the declaration here, or mark the export @mutable)`,
          );
        if (
          !entry.asset &&
          order.get(entry.from) > order.get(module.modulePath) &&
          runsWith(reference.from, moduleScope, facts.staticInitializers, facts.parents)
        ) {
          const target = info.get(entry.from)?.declarations.get(entry.imported);
          if (target && target.defs[0]?.type !== "FunctionName")
            errors.push(
              `${module.modulePath}:${reference.identifier.loc.start.line}: reads ${variable.name} from ${entry.from}, which runs later`,
            );
        }
      }
    }
    for (const reference of scopeManager.globalScope.through) {
      const name = reference.identifier.name;
      const owner = declaredBy.get(name);
      if (owner && owner !== module.modulePath)
        errors.push(
          `${module.modulePath}:${reference.identifier.loc.start.line}: uses ${name} from ${owner} without importing it`,
        );
      else if (
        !owner &&
        !allowedGlobals.has(name) &&
        !isUndeclaredInOriginal(name, module.modulePath)
      )
        errors.push(
          `${module.modulePath}:${reference.identifier.loc.start.line}: unknown global ${name} (add it to ${EXTERNAL_GLOBALS_PATH} if intended)`,
        );
    }
  }
  // Code that runs when a function is called directly while a module is evaluated: functions
  // declared at any depth, functions bound to a const/let/var, and classes (constructor,
  // instance field initializers and, through `extends`, the base class). Its reads, also
  // through further direct calls, must not belong to a module that runs later.
  const resolveVariable = (modulePath, variable) => {
    if (variable.defs[0]?.type !== "ImportBinding") return variable;
    const entry = info.get(modulePath).importsByLocal.get(variable.name);
    return entry && !entry.asset
      ? (info.get(entry.from)?.declarations.get(entry.imported) ?? null)
      : null;
  };
  const ownerOf = new Map(); // module-scope Variable -> modulePath
  for (const [modulePath, { declarations }] of info)
    for (const v of declarations.values()) ownerOf.set(v, modulePath);
  const functionNodeOf = (v) => {
    const def = v.defs[0];
    if (!def || v.defs.length !== 1) return null;
    let node = null;
    if (def.type === "FunctionName" || def.type === "ClassName") node = def.node;
    if (def.type === "Variable" && /^(Arrow)?FunctionExpression$/.test(def.node.init?.type ?? ""))
      node = def.node.init;
    // Calling a generator function only creates the iterator; its body runs on next().
    return node?.generator ? null : node;
  };
  const summaries = new Map(); // Variable -> { reads: Map<Variable,name>, calls: Set<Variable> }
  for (const { module, scopeManager, facts } of info.values()) {
    for (const scope of scopeManager.scopes)
      for (const v of scope.variables) {
        const node = functionNodeOf(v);
        if (!node) continue;
        const isClass = node.type === "ClassDeclaration" || node.type === "ClassExpression";
        const roots = isClass
          ? scopeManager.scopes.filter(
              (sc) =>
                sc.upper?.block === node &&
                ((sc.type === "function" && facts.parents.get(sc.block)?.kind === "constructor") ||
                  (sc.type === "class-field-initializer" &&
                    !facts.staticInitializers.has(sc.block))),
            )
          : [scopeManager.acquire(node)];
        const reads = new Map();
        const calls = new Set();
        for (const inner of scopeManager.scopes) {
          if (!roots.some((root) => runsWith(inner, root, facts.staticInitializers, facts.parents)))
            continue;
          for (const reference of inner.references) {
            const target =
              reference.resolved && resolveVariable(module.modulePath, reference.resolved);
            if (!target) continue;
            if (ownerOf.has(target) && target.defs[0]?.type !== "FunctionName")
              reads.set(target, reference.identifier.name);
            if (facts.isCallee(reference.identifier)) calls.add(target);
          }
        }
        // Constructing a subclass runs the base class constructor.
        if (isClass && node.superClass?.type === "Identifier") {
          const heritage = scopeManager.scopes
            .flatMap((scope) => scope.references)
            .find((reference) => reference.identifier === node.superClass);
          const base = heritage?.resolved && resolveVariable(module.modulePath, heritage.resolved);
          if (base) calls.add(base);
        }
        summaries.set(v, { reads, calls });
      }
  }
  const readsWhenCalled = (variable) => {
    const reads = new Map();
    const seen = new Set();
    const pending = [variable];
    while (pending.length) {
      const current = pending.pop();
      if (seen.has(current) || !summaries.has(current)) continue;
      seen.add(current);
      for (const [read, name] of summaries.get(current).reads) reads.set(read, name);
      pending.push(...summaries.get(current).calls);
    }
    return reads;
  };
  for (const { module, scopeManager, facts } of info.values()) {
    for (const scope of scopeManager.scopes) {
      if (
        !runsWith(
          scope,
          info.get(module.modulePath).moduleScope,
          facts.staticInitializers,
          facts.parents,
        )
      )
        continue;
      for (const reference of scope.references) {
        if (!reference.resolved || !facts.isCallee(reference.identifier)) continue;
        const target = resolveVariable(module.modulePath, reference.resolved);
        if (!target || !summaries.has(target)) continue;
        for (const [read, name] of readsWhenCalled(target)) {
          const owner = ownerOf.get(read);
          if (order.get(owner) > order.get(module.modulePath))
            errors.push(
              `${module.modulePath}:${reference.identifier.loc.start.line}: calls ${reference.identifier.name}, which reads ${name} from ${owner}, which runs later`,
            );
        }
      }
    }
  }

  for (const module of modules) {
    for (const exported of module.exports) {
      if (!usedExports.has(`${module.modulePath}#${exported.name}`))
        errors.push(`${module.modulePath}: export ${exported.name} is not imported by any module`);
    }
  }

  // Import cycles (Tarjan's strongly connected components).
  let index = 0;
  const stack = [];
  const indices = new Map();
  const lowLinks = new Map();
  const onStack = new Set();
  const cycles = [];
  const visit = (node) => {
    indices.set(node, index);
    lowLinks.set(node, index);
    index++;
    stack.push(node);
    onStack.add(node);
    for (const next of edges.get(node) ?? []) {
      if (!indices.has(next)) {
        visit(next);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(next)));
      } else if (onStack.has(next))
        lowLinks.set(node, Math.min(lowLinks.get(node), indices.get(next)));
    }
    if (lowLinks.get(node) === indices.get(node)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      if (component.length > 1) cycles.push(component);
    }
  };
  for (const node of edges.keys()) if (!indices.has(node)) visit(node);
  for (const cycle of cycles) errors.push(`import cycle: ${cycle.join(" -> ")}`);

  return { errors, modules: modules.length, edges };
}

if (isMainModule(import.meta.url)) {
  const { errors, modules } = checkModules(ROOT);
  if (errors.length) {
    console.error(`${errors.length} problem(s) in ${modules} modules:`);
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
  }
  console.log(`${modules} modules: dependencies are explicit, acyclic and consistent.`);
}
