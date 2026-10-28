// Repairs the import and export declarations of the modules of src/ after code moved between
// them (the upstream port inserts the release's statements into the modules of their
// neighbours). It follows the module rules of docs/MODULE-RULES.md:
//   * a module imports, by name, every top-level binding of another module it uses;
//   * imports nothing it does not use;
//   * exports exactly the bindings other modules import.
// Identifiers declared nowhere in src/ that the new release reads as globals are added to
// src/external-globals.json (Web App names under `webApp`, others under `undeclaredInOriginal`
// for the module that reads them). Anything else is reported.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { analyze } from "eslint-scope";
import { parseModule } from "../../lib/ast.mjs";
import { readManifest } from "../../lib/modules.mjs";

const EXTERNAL_GLOBALS_PATH = "src/external-globals.json";
const ECMASCRIPT_GLOBALS = new Set(vm.runInNewContext("Object.getOwnPropertyNames(globalThis)"));

/** The relative import specifier of `target` from module `from` (both repository paths). */
export function specifierFor(from, target) {
  const relative = path.posix.relative(path.posix.dirname(from), target);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

const resolveSpecifier = (from, specifier) =>
  path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));

const isWebAppName = (name) =>
  /^[A-Z]/.test(name) ||
  /^(services|repositories|gNavManager|gClickShield|gPopupClickShield|gUserModel|gFooter|gConfigurationModel|localize)$/.test(
    name,
  );

/**
 * Fixes the links of every module of the manifest. `newGlobals`: names the new release reads
 * as globals (they may be added to src/external-globals.json). Returns { changed: [paths],
 * unresolved: [{ module, name }], notes }.
 */
export function fixModuleLinks(root, { newGlobals = new Set(), dryRun = false } = {}) {
  const manifest = readManifest(root);
  const externalPath = path.join(root, EXTERNAL_GLOBALS_PATH);
  const external = JSON.parse(fs.readFileSync(externalPath, "utf8"));
  const texts = new Map(
    manifest.modules.map((modulePath) => [
      modulePath,
      fs.readFileSync(path.join(root, modulePath), "utf8").replace(/\r\n/g, "\n"),
    ]),
  );
  const changed = new Set();
  const notes = [];
  let externalChanged = false;
  let unresolved = [];

  for (let round = 0; round < 6; round++) {
    const allowed = new Set([
      ...ECMASCRIPT_GLOBALS,
      ...Object.entries(external)
        .filter(([key]) => !key.startsWith("$") && key !== "undeclaredInOriginal")
        .flatMap(([, names]) => names),
    ]);
    const undeclared = external.undeclaredInOriginal ?? {};
    const parsed = new Map();
    for (const [modulePath, text] of texts) {
      let program;
      try {
        program = parseModule(text);
      } catch (error) {
        throw new Error(`${modulePath}: ${error.message}`);
      }
      const scopeManager = analyze(program, { ecmaVersion: 2022, sourceType: "module" });
      const moduleScope = scopeManager.scopes.find((scope) => scope.type === "module");
      parsed.set(modulePath, { program, scopeManager, moduleScope });
    }
    const declaredBy = new Map();
    for (const [modulePath, { moduleScope }] of parsed)
      for (const variable of moduleScope.variables)
        if (variable.defs[0]?.type !== "ImportBinding" && !declaredBy.has(variable.name))
          declaredBy.set(variable.name, modulePath);

    const needImports = new Map(); // module -> Map(from -> Set(names))
    const dropImports = new Map(); // module -> Set(local names)
    const imported = new Set(); // "from#name" still imported after the fixes
    unresolved = [];
    for (const [modulePath, { program, moduleScope }] of parsed) {
      const importDeclarations = program.body.filter((node) => node.type === "ImportDeclaration");
      for (const declaration of importDeclarations) {
        const from = resolveSpecifier(modulePath, declaration.source.value);
        for (const specifier of declaration.specifiers) {
          const variable = moduleScope.set.get(specifier.local.name);
          const owner =
            specifier.type === "ImportSpecifier" ? declaredBy.get(specifier.imported.name) : from;
          if (variable && variable.references.length === 0) {
            if (!dropImports.has(modulePath)) dropImports.set(modulePath, new Set());
            dropImports.get(modulePath).add(specifier.local.name);
          } else if (specifier.type === "ImportSpecifier" && owner && owner !== from) {
            // The binding moved to another module: import it from there.
            if (!dropImports.has(modulePath)) dropImports.set(modulePath, new Set());
            dropImports.get(modulePath).add(specifier.local.name);
            if (owner !== modulePath) {
              if (!needImports.has(modulePath)) needImports.set(modulePath, new Map());
              const byModule = needImports.get(modulePath);
              if (!byModule.has(owner)) byModule.set(owner, new Set());
              byModule.get(owner).add(specifier.imported.name);
              imported.add(`${owner}#${specifier.imported.name}`);
            }
          } else if (specifier.type === "ImportSpecifier")
            imported.add(`${from}#${specifier.imported.name}`);
        }
      }
      const seen = new Set();
      for (const reference of moduleScope.through) {
        const name = reference.identifier.name;
        if (seen.has(name)) continue;
        seen.add(name);
        if (allowed.has(name) || undeclared[name]?.includes(modulePath)) continue;
        const owner = declaredBy.get(name);
        if (owner && owner !== modulePath) {
          if (!needImports.has(modulePath)) needImports.set(modulePath, new Map());
          const byModule = needImports.get(modulePath);
          if (!byModule.has(owner)) byModule.set(owner, new Set());
          byModule.get(owner).add(name);
          imported.add(`${owner}#${name}`);
          continue;
        }
        if (newGlobals.has(name)) {
          if (isWebAppName(name)) {
            external.webApp = [...new Set([...external.webApp, name])].sort();
            notes.push(`added ${name} to webApp in ${EXTERNAL_GLOBALS_PATH}`);
          } else {
            external.undeclaredInOriginal ??= {};
            external.undeclaredInOriginal[name] = [
              ...new Set([...(external.undeclaredInOriginal[name] ?? []), modulePath]),
            ].sort();
            notes.push(
              `added ${name} (read undeclared by the release) to undeclaredInOriginal for ${modulePath}`,
            );
          }
          externalChanged = true;
          continue;
        }
        unresolved.push({ module: modulePath, name, line: reference.identifier.loc.start.line });
      }
    }

    // Exports: exactly what is imported.
    const exportEdits = new Map(); // module -> [[start, end, text]]
    for (const [modulePath, { program }] of parsed) {
      const edits = [];
      for (const statement of program.body) {
        if (statement.type === "ImportDeclaration") continue;
        const exported = statement.type === "ExportNamedDeclaration";
        const declaration = exported ? statement.declaration : statement;
        if (!declaration) continue;
        const names =
          declaration.type === "VariableDeclaration"
            ? declaration.declarations.flatMap((item) =>
                item.id.type === "Identifier" ? [item.id.name] : [],
              )
            : declaration.id
              ? [declaration.id.name]
              : [];
        if (!names.length) continue;
        const needed = names.filter((name) => imported.has(`${modulePath}#${name}`));
        if (!exported && needed.length) edits.push([statement.start, statement.start, "export "]);
        if (exported && !needed.length) edits.push([statement.start, declaration.start, ""]);
        if (needed.length && needed.length !== names.length)
          notes.push(
            `${modulePath}: ${names.join(", ")} are declared together but only ${needed.join(", ")} are imported elsewhere; split the declaration`,
          );
      }
      if (edits.length) exportEdits.set(modulePath, edits);
    }

    if (!needImports.size && !dropImports.size && !exportEdits.size) break;
    for (const modulePath of new Set([
      ...needImports.keys(),
      ...dropImports.keys(),
      ...exportEdits.keys(),
    ])) {
      const { program } = parsed.get(modulePath);
      let text = texts.get(modulePath);
      const edits = [...(exportEdits.get(modulePath) ?? [])];
      const drop = dropImports.get(modulePath) ?? new Set();
      const add = needImports.get(modulePath) ?? new Map();
      const importDeclarations = program.body.filter((node) => node.type === "ImportDeclaration");
      const handled = new Set();
      for (const declaration of importDeclarations) {
        const from = resolveSpecifier(modulePath, declaration.source.value);
        const keep = declaration.specifiers.filter((item) => !drop.has(item.local.name));
        const extra = [...(add.get(from) ?? [])];
        handled.add(from);
        if (keep.length === declaration.specifiers.length && !extra.length) continue;
        let end = declaration.end;
        if (!keep.length && !extra.length) {
          if (text[end] === "\n") end++;
          edits.push([declaration.start, end, ""]);
          continue;
        }
        const isDefault = keep.some((item) => item.type === "ImportDefaultSpecifier");
        if (isDefault) {
          edits.push([declaration.start, end, text.slice(declaration.start, end)]);
          continue;
        }
        const names = [...new Set([...keep.map((item) => item.local.name), ...extra])].sort();
        edits.push([
          declaration.start,
          end,
          `import { ${names.join(", ")} } from ${JSON.stringify(declaration.source.value)};`,
        ]);
      }
      const fresh = [...add].filter(([from]) => !handled.has(from));
      if (fresh.length) {
        const lines = fresh
          .map(([from, names]) => ({
            specifier: specifierFor(modulePath, from),
            names: [...names].sort(),
          }))
          .sort((a, b) => (a.specifier < b.specifier ? -1 : 1));
        for (const line of lines) {
          const statement = `import { ${line.names.join(", ")} } from ${JSON.stringify(line.specifier)};\n`;
          const next = importDeclarations.find((item) => item.source.value > line.specifier);
          if (next) edits.push([next.start, next.start, statement]);
          else if (importDeclarations.length) {
            const last = importDeclarations.at(-1);
            edits.push([last.end + 1, last.end + 1, statement]);
          } else {
            const first = program.body[0];
            const position = first ? first.start : text.length;
            edits.push([position, position, `${statement}\n`]);
          }
        }
      }
      edits.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
      for (const [start, end, replacement] of edits)
        text = text.slice(0, start) + replacement + text.slice(end);
      texts.set(modulePath, text);
      changed.add(modulePath);
    }
  }
  if (!dryRun) {
    for (const modulePath of changed)
      fs.writeFileSync(path.join(root, modulePath), texts.get(modulePath));
    if (externalChanged) fs.writeFileSync(externalPath, `${JSON.stringify(external, null, 2)}\n`);
  }
  return { changed: [...changed], unresolved, notes, externalChanged };
}
