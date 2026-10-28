// Prepares a userscript for structural comparison: parses it, rewrites minifier idioms into plain
// statements (the "normalization") and inlines the constants that may legitimately move. Every
// tool of scripts/upstream/ (diff, merge, port, verification) works on prepared programs, so the
// deobfuscated releases (minified style) and the build of src/ (readable style) compare equal
// whenever they behave the same.
//
// Normalization (applied identically to every program; it never changes evaluation):
//   statement-level comma sequences, `a && b;`, `a || b;`, `a ? b : c;` as statements, `!f();`,
//   `void f();`, `return (a, b)`, `return t ? (a, b) : c`, braces around single statements,
//   `else { if ... }`, one declarator per declaration, literal-first comparisons and
//   `"x" == typeof y` (as `===`).
// Inlining (see `inlineConstants`): top-level constants holding a primitive literal (CSS, images,
// data, `undefined`) and single-use object literals of the prelude of the main module (the
// translation tables).
//
// Nodes created by the normalization carry SYNTHETIC: their text is not in the source. Inlined
// copies carry ORIGIN, the node of the constant's declaration they were copied from (each node of
// the copy points to its own original). Both are symbol keys, invisible to the AST walkers.
import { analyze } from "eslint-scope";
import { fillMissingRanges, findModuleFactory, parseScript, walk } from "../../lib/ast.mjs";

export const SYNTHETIC = Symbol("synthetic");
export const ORIGIN = Symbol("origin");
/** On a statement the normalization produced from a real one: that real (raw) statement. */
export const RAW = Symbol("raw");
/** On an inlined copy (or `void 0`): the identifier it replaced (where the constant was read). */
export const USE_SITE = Symbol("use site");
/** On an inlined copy: the name of the constant it replaced. */
export const INLINED_FROM = Symbol("inlined from");
/** On the declaration of an inlined constant kept in the AST (`keepInlinedDeclarations`). */
export const INLINED_DECLARATION = Symbol("inlined declaration");

const synthetic = (node) => {
  node[SYNTHETIC] = true;
  return node;
};
const exprStmt = (expression) =>
  synthetic({ type: "ExpressionStatement", expression, loc: expression.loc });
const block = (body, loc) => synthetic({ type: "BlockStatement", body, loc });
const not = (argument) =>
  synthetic({ type: "UnaryExpression", operator: "!", prefix: true, argument, loc: argument.loc });
const asBlock = (statement) =>
  statement.type === "BlockStatement" ? statement : block([statement], statement.loc);
/** A shallow copy of a real node that no longer matches its text (the text has more). */
const derived = (node, changes) => {
  const copy = { ...node, ...changes };
  delete copy.start;
  delete copy.end;
  delete copy.range;
  return synthetic(copy);
};

export function normalizeBody(statements) {
  return statements.flatMap((statement) => {
    const results = normalizeStatement(statement);
    for (const result of results) if (result !== statement) result[RAW] ??= statement;
    return results;
  });
}

function normalizeBlock(statement) {
  const result = asBlock(statement);
  result.body = normalizeBody(result.body);
  return result;
}

function splitSequence(expression) {
  return expression.type === "SequenceExpression"
    ? { prefix: expression.expressions.slice(0, -1), last: expression.expressions.at(-1) }
    : { prefix: [], last: expression };
}

function hasBranchSequence(node) {
  return (
    node.type === "ConditionalExpression" &&
    [node.consequent, node.alternate].some(
      (branch) => branch.type === "SequenceExpression" || hasBranchSequence(branch),
    )
  );
}

function withPrefix(prefix, statement) {
  return [
    ...prefix.flatMap((expression) => normalizeStatement(exprStmt(expression))),
    ...normalizeStatement(statement),
  ];
}

function normalizeStatement(statement) {
  switch (statement.type) {
    case "ExpressionStatement": {
      if (statement.directive) return [statement];
      const expression = statement.expression;
      if (expression.type === "SequenceExpression")
        return expression.expressions.flatMap((item) => normalizeStatement(exprStmt(item)));
      if (expression.type === "LogicalExpression" && expression.operator === "&&")
        return normalizeStatement(
          synthetic({
            type: "IfStatement",
            test: expression.left,
            consequent: block([exprStmt(expression.right)], expression.loc),
            alternate: null,
            loc: expression.loc,
          }),
        );
      if (expression.type === "LogicalExpression" && expression.operator === "||")
        return normalizeStatement(
          synthetic({
            type: "IfStatement",
            test: not(expression.left),
            consequent: block([exprStmt(expression.right)], expression.loc),
            alternate: null,
            loc: expression.loc,
          }),
        );
      if (expression.type === "ConditionalExpression")
        return normalizeStatement(
          synthetic({
            type: "IfStatement",
            test: expression.test,
            consequent: block([exprStmt(expression.consequent)], expression.loc),
            alternate: block([exprStmt(expression.alternate)], expression.loc),
            loc: expression.loc,
          }),
        );
      if (
        expression.type === "UnaryExpression" &&
        (expression.operator === "!" || expression.operator === "void") &&
        expression.argument.type === "CallExpression"
      )
        return normalizeStatement(exprStmt(expression.argument));
      normalizeExpression(expression);
      return [statement];
    }
    case "ReturnStatement":
    case "ThrowStatement": {
      if (!statement.argument) return [statement];
      const { prefix, last } = splitSequence(statement.argument);
      if (prefix.length) return withPrefix(prefix, derived(statement, { argument: last }));
      // return t ? (a, b) : c  ->  if (t) { a; return b; } else { return c; }
      if (statement.type === "ReturnStatement" && hasBranchSequence(statement.argument)) {
        const { test, consequent, alternate } = statement.argument;
        const returnOf = (argument) =>
          synthetic({ type: "ReturnStatement", argument, loc: argument.loc });
        return normalizeStatement(
          synthetic({
            type: "IfStatement",
            test,
            consequent: block([returnOf(consequent)], statement.loc),
            alternate: block([returnOf(alternate)], statement.loc),
            loc: statement.loc,
          }),
        );
      }
      normalizeExpression(statement.argument);
      return [statement];
    }
    case "IfStatement": {
      const { prefix, last } = splitSequence(statement.test);
      if (prefix.length) return withPrefix(prefix, derived(statement, { test: last }));
      normalizeExpression(statement.test);
      statement.consequent = normalizeBlock(statement.consequent);
      if (statement.alternate) {
        const alternate = normalizeBlock(statement.alternate);
        statement.alternate =
          alternate.body.length === 1 && alternate.body[0].type === "IfStatement"
            ? alternate.body[0]
            : alternate;
      }
      return [statement];
    }
    case "SwitchStatement": {
      const { prefix, last } = splitSequence(statement.discriminant);
      if (prefix.length) return withPrefix(prefix, derived(statement, { discriminant: last }));
      normalizeExpression(statement.discriminant);
      for (const switchCase of statement.cases) {
        if (switchCase.test) normalizeExpression(switchCase.test);
        switchCase.consequent = normalizeBody(switchCase.consequent);
      }
      return [statement];
    }
    case "VariableDeclaration": {
      for (const declarator of statement.declarations) {
        normalizeExpression(declarator.id);
        if (declarator.init) normalizeExpression(declarator.init);
      }
      if (statement.declarations.length === 1) return [statement];
      return statement.declarations.map((declarator) =>
        derived(statement, { declarations: [declarator], loc: declarator.loc }),
      );
    }
    case "BlockStatement":
      statement.body = normalizeBody(statement.body);
      return [statement];
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
      for (const key of ["init", "test", "update", "left", "right"]) {
        if (statement[key]) {
          if (statement[key].type === "VariableDeclaration") {
            for (const declarator of statement[key].declarations) {
              normalizeExpression(declarator.id);
              if (declarator.init) normalizeExpression(declarator.init);
            }
          } else normalizeExpression(statement[key]);
        }
      }
      statement.body = normalizeBlock(statement.body);
      return [statement];
    case "LabeledStatement": {
      const body = normalizeStatement(statement.body);
      statement.body = body.length === 1 ? body[0] : block(body, statement.loc);
      return [statement];
    }
    case "TryStatement":
      statement.block = normalizeBlock(statement.block);
      if (statement.handler) {
        if (statement.handler.param) normalizeExpression(statement.handler.param);
        statement.handler.body = normalizeBlock(statement.handler.body);
      }
      if (statement.finalizer) statement.finalizer = normalizeBlock(statement.finalizer);
      return [statement];
    case "FunctionDeclaration":
    case "ClassDeclaration":
      normalizeExpression(statement);
      return [statement];
    default:
      normalizeExpression(statement);
      return [statement];
  }
}

// `undefined` is literal-like only in a program that declares no binding of that name, so that
// every `undefined` is the immutable global. Set by `prepareProgram` while it normalizes.
let undefinedIsLiteral = false;

const declaresUndefined = (program) =>
  analyze(program, { ecmaVersion: 2022, sourceType: "script" }).scopes.some((scope) =>
    scope.set.has("undefined"),
  );

const isLiteralLike = (node) =>
  node.type === "Literal" ||
  (node.type === "TemplateLiteral" && node.expressions.length === 0) ||
  (node.type === "UnaryExpression" &&
    node.operator === "void" &&
    node.argument.type === "Literal") ||
  (undefinedIsLiteral && node.type === "Identifier" && node.name === "undefined");

const EQUALITY = new Set(["==", "!=", "===", "!=="]);

/** Normalizes nested function bodies and comparison operands inside an expression tree. */
function normalizeExpression(root) {
  walk(root, (node) => {
    switch (node.type) {
      case "FunctionDeclaration":
      case "FunctionExpression":
        node.body = normalizeBlock(node.body);
        for (const param of node.params) normalizeExpression(param);
        return false;
      case "ArrowFunctionExpression":
        for (const param of node.params) normalizeExpression(param);
        if (node.body.type === "BlockStatement") node.body = normalizeBlock(node.body);
        else if (node.body.type === "SequenceExpression") {
          const { prefix, last } = splitSequence(node.body);
          node.body = normalizeBlock(
            block(
              [
                ...prefix.map(exprStmt),
                synthetic({ type: "ReturnStatement", argument: last, loc: last.loc }),
              ],
              node.body.loc,
            ),
          );
          node.expression = false;
          node[SYNTHETIC] = true; // its text has an expression body, its node a block
        } else normalizeExpression(node.body);
        return false;
      case "StaticBlock":
        node.body = normalizeBody(node.body);
        return false;
      case "BinaryExpression":
        if (EQUALITY.has(node.operator) && isLiteralLike(node.left) && !isLiteralLike(node.right))
          [node.left, node.right] = [node.right, node.left];
        if (
          (node.operator === "==" || node.operator === "!=") &&
          ((node.left.type === "UnaryExpression" &&
            node.left.operator === "typeof" &&
            node.right.type === "Literal" &&
            typeof node.right.value === "string") ||
            (node.right.type === "UnaryExpression" &&
              node.right.operator === "typeof" &&
              node.left.type === "Literal" &&
              typeof node.left.value === "string"))
        )
          node.operator += "=";
        return true;
      default:
        return true;
    }
  });
}

// ---------------------------------------------------------------------------
// Inlining of constants
// ---------------------------------------------------------------------------
export function isPureLiteral(node) {
  switch (node.type) {
    case "Literal":
      return !node.regex;
    case "TemplateLiteral":
      return node.expressions.length === 0;
    case "ArrayExpression":
      return node.elements.every((element) => element && isPureLiteral(element));
    case "ObjectExpression":
      return node.properties.every(
        (property) =>
          property.type === "Property" &&
          property.kind === "init" &&
          !property.computed &&
          !property.method &&
          isPureLiteral(property.value),
      );
    case "UnaryExpression":
      return node.operator === "-" && node.argument.type === "Literal";
    default:
      return false;
  }
}

const SAFE_UNARY = new Set(["-", "+", "!", "~", "typeof", "void"]);

/** A primitive literal: evaluating it has no effect and always gives the same value. */
export const isScalar = (node) =>
  (node.type === "Literal" && !node.regex) ||
  (node.type === "TemplateLiteral" && node.expressions.length === 0) ||
  (node.type === "UnaryExpression" &&
    SAFE_UNARY.has(node.operator) &&
    node.argument.type === "Literal" &&
    !node.argument.regex &&
    // `+1n` throws a TypeError.
    !(node.operator === "+" && node.argument.bigint !== undefined));

const LOOPS = new Set([
  "WhileStatement",
  "DoWhileStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
]);

function insideLoop(node, parents, root) {
  for (let up = parents.get(node)?.parent; up && up !== root; up = parents.get(up)?.parent)
    if (LOOPS.has(up.type)) return true;
  return false;
}

/** A deep copy whose nodes point (ORIGIN) to the nodes they were copied from. */
function cloneWithOrigin(node) {
  const copy = structuredClone(node);
  const pair = (original, duplicate) => {
    if (!original || typeof original !== "object") return;
    if (typeof original.type === "string") duplicate[ORIGIN] = original[ORIGIN] ?? original;
    for (const key of Object.keys(original)) {
      const value = original[key];
      if (value && typeof value === "object") pair(value, duplicate[key]);
    }
  };
  pair(node, copy);
  return copy;
}

function parentMap(root) {
  const parents = new Map();
  walk(root, (node, parent, key, index) => {
    parents.set(node, { parent, key, index });
  });
  return parents;
}

/**
 * Inlines constants of the main module so that moving them is not a difference:
 *   * `const NAME = <primitive literal>` (string, number, template without expressions or the
 *     global `undefined`) declared anywhere at the top level: every read is equivalent to the
 *     literal (only a read before the declaration, a TDZ ReferenceError, could tell);
 *   * `const NAME = <object/array literal of literals>` in the prelude of the main module (its
 *     leading run of directives, function declarations and such constants) when it is read
 *     exactly once, by code that runs once at the top level: it is then the same single object
 *     as the inline literal (the translation tables).
 * Removes the declarations and returns them by name.
 */
export function inlineConstants(program, factory, { keepDeclarations = false } = {}) {
  const inlined = new Map(); // name -> { declaration, init, scalar, references }
  for (let changed = true; changed; ) {
    changed = false;
    const scopeManager = analyze(program, { ecmaVersion: 2022, sourceType: "script" });
    const factoryScope = scopeManager.acquire(factory);
    const globalReferences = new Set(
      scopeManager.globalScope.through.map((reference) => reference.identifier),
    );
    const isScalarConstant = (node) =>
      isScalar(node) ||
      (node.type === "Identifier" && node.name === "undefined" && globalReferences.has(node));
    const body = factory.body.body;
    const preludeEnd = body.findIndex(
      (statement) =>
        !(
          (statement.type === "ExpressionStatement" && statement.directive) ||
          statement.type === "FunctionDeclaration" ||
          (statement.type === "VariableDeclaration" &&
            statement.kind === "const" &&
            statement.declarations.every(
              (declarator) =>
                declarator.id.type === "Identifier" &&
                declarator.init &&
                (isPureLiteral(declarator.init) || isScalarConstant(declarator.init)),
            ))
        ),
    );
    const prelude = new Set(body.slice(0, preludeEnd < 0 ? body.length : preludeEnd));
    const parents = parentMap(program);
    const removable = new Set();
    for (const declaration of body) {
      if (declaration.type !== "VariableDeclaration" || declaration.kind !== "const") continue;
      if (declaration[INLINED_DECLARATION]) continue;
      if (declaration.declarations.length !== 1) continue;
      const [declarator] = declaration.declarations;
      if (declarator.id.type !== "Identifier" || !declarator.init) continue;
      const scalar = isScalarConstant(declarator.init);
      if (!scalar && !(prelude.has(declaration) && isPureLiteral(declarator.init))) continue;
      const variable = factoryScope.set.get(declarator.id.name);
      const references = variable.references.filter(
        (reference) => reference.identifier !== declarator.id,
      );
      if (references.some((reference) => !reference.isReadOnly())) continue;
      if (!scalar) {
        if (references.length !== 1) continue;
        if (references[0].from !== factoryScope) continue;
        if (insideLoop(references[0].identifier, parents, factory)) continue;
      }
      // `{ __proto__ }` defines an own property; `{ __proto__: value }` sets the prototype.
      const protoShorthand = (reference) => {
        const { parent } = parents.get(reference.identifier);
        return parent.type === "Property" && parent.shorthand && parent.key.name === "__proto__";
      };
      if (references.some(protoShorthand)) continue;
      for (const reference of references) {
        const location = parents.get(reference.identifier);
        // The global `undefined` becomes `void 0`: an inlined identifier could be captured by a
        // parameter or variable named `undefined` around the read.
        const replacement =
          declarator.init.type === "Identifier"
            ? synthetic({
                type: "UnaryExpression",
                operator: "void",
                prefix: true,
                argument: synthetic({
                  type: "Literal",
                  value: 0,
                  raw: "0",
                  range: reference.identifier.range,
                }),
                range: reference.identifier.range,
                loc: reference.identifier.loc,
              })
            : cloneWithOrigin(declarator.init);
        replacement[USE_SITE] = reference.identifier;
        replacement[INLINED_FROM] = declarator.id.name;
        if (location.index === null) location.parent[location.key] = replacement;
        else location.parent[location.key][location.index] = replacement;
        if (location.parent.type === "Property" && location.parent.shorthand)
          location.parent.shorthand = false;
      }
      inlined.set(declarator.id.name, {
        declaration,
        init: declarator.init,
        scalar,
        references: references.length,
      });
      removable.add(declaration);
      changed = true;
    }
    if (keepDeclarations)
      for (const declaration of removable) declaration[INLINED_DECLARATION] = true;
    else factory.body.body = body.filter((statement) => !removable.has(statement));
  }
  return inlined;
}

// ---------------------------------------------------------------------------
// Prepared programs
// ---------------------------------------------------------------------------
/** Finds the id of the webpack module that holds the Paletools code (the largest factory). */
export function findMainModuleId(program) {
  let best = null;
  walk(program, (node) => {
    if (
      node.type === "Property" &&
      !node.computed &&
      ((node.key.type === "Literal" && typeof node.key.value === "number") ||
        (node.key.type === "Identifier" && /^\d+$/.test(node.key.name))) &&
      (node.value.type === "ArrowFunctionExpression" || node.value.type === "FunctionExpression") &&
      node.value.body.type === "BlockStatement"
    ) {
      const size = node.value.end - node.value.start;
      if (!best || size > best.size) best = { id: Number(node.key.value ?? node.key.name), size };
    }
    return true;
  });
  return best?.id ?? null;
}

function bindingsOf(program) {
  const scopeManager = analyze(program, { ecmaVersion: 2022, sourceType: "script" });
  const bindings = new Map(); // Identifier node -> eslint-scope Variable | "global"
  const innerBindings = new Map(); // declaration name -> the binding of its own (class) scope
  for (const scope of scopeManager.scopes) {
    // Scopes come outer first. A class declaration's name is declared twice (in the enclosing
    // scope and, for the class body, in its own class scope): its identifier names the outer
    // binding, the one the rest of the program uses; the inner one, which the class body reads,
    // is kept in innerBindings.
    for (const variable of scope.variables)
      for (const identifier of variable.identifiers)
        if (!bindings.has(identifier)) bindings.set(identifier, variable);
        else if (bindings.get(identifier) !== variable) innerBindings.set(identifier, variable);
    for (const reference of scope.references)
      bindings.set(reference.identifier, reference.resolved ?? "global");
  }
  return { scopeManager, bindings, innerBindings };
}

/**
 * Parses, normalizes and inlines a userscript. Returns the "side" every upstream tool works on:
 *   source, program, factory (main module function), moduleId, body (its top-level statements,
 *   normalized, without the declarations of inlined constants), inlined (those constants: name ->
 *   { declaration, init, scalar, references }), scopeManager, bindings (Identifier -> Variable |
 *   "global") and topVariables (the main module's top-level bindings).
 * `moduleId` defaults to the largest module of the webpack table.
 */
export function prepareProgram(
  source,
  { moduleId = null, label = "program", keepInlinedDeclarations = false } = {},
) {
  const program = parseScript(source);
  const id = moduleId ?? findMainModuleId(program);
  const factory = id === null ? null : findModuleFactory(program, id);
  if (!factory) throw new Error(`${label}: webpack module ${id} was not found`);
  undefinedIsLiteral = !declaresUndefined(program);
  try {
    program.body = normalizeBody(program.body);
  } finally {
    undefinedIsLiteral = false;
  }
  fillMissingRanges(program);
  const inlined = inlineConstants(program, factory, { keepDeclarations: keepInlinedDeclarations });
  const { scopeManager, bindings, innerBindings } = bindingsOf(program);
  const topVariables = new Set(scopeManager.acquire(factory).variables);
  return {
    label,
    source,
    program,
    factory,
    moduleId: id,
    // The declarations of inlined constants are not part of the comparison; with
    // `keepInlinedDeclarations` they stay in factory.body.body (marked INLINED_DECLARATION), so
    // that a merged program can be written with them.
    body: factory.body.body.filter((statement) => !statement[INLINED_DECLARATION]),
    inlined,
    scopeManager,
    bindings,
    innerBindings,
    topVariables,
  };
}
