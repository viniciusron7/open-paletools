/**
 * Object utilities: `extendObject` (port of jQuery.extend: shallow or deep merge into the first
 * argument), the dotted-path accessors `getValueAtPath`/`setValueAtPath` (settings forms of the
 * snipe, my packs and player picks plugins) and `copyWithOverrides` (used by
 * src/sbc/smart-builder-solver.js).
 *
 * Invariants:
 * - `extendObject(true, target, ...sources)` merges plain objects and arrays in place: arrays
 *   are merged index by index into the target's array (extra target elements survive),
 *   `undefined` source values are skipped, `null` overwrites, `__proto__` is ignored and other
 *   objects are copied by reference. src/config/configuration.js and src/core/http.js rely on it.
 * - `getValueAtPath` throws on a missing intermediate segment; `setValueAtPath` creates missing
 *   intermediate objects.
 * - `copyWithOverrides(source, target, overrides)` copies own properties (arrays sliced, other
 *   values shared), then applies only the overrides whose key exists on `target`.
 */
const getPrototypeOf = Object.getPrototypeOf;

const objectPrototypeSample = {};

const hasOwnProperty = objectPrototypeSample.hasOwnProperty;

const objectToString = objectPrototypeSample.toString;

const functionToString = hasOwnProperty.toString;

const objectConstructorSource = functionToString.call(Object);

function isPlainObject(candidate) {
  var candidatePrototype;
  var candidateConstructor;
  return !(
    !candidate ||
    objectToString.call(candidate) !== "[object Object]" ||
    ((candidatePrototype = getPrototypeOf(candidate)) &&
      (typeof (candidateConstructor =
        hasOwnProperty.call(candidatePrototype, "constructor") &&
        candidatePrototype.constructor) !== "function" ||
        functionToString.call(candidateConstructor) !== objectConstructorSource))
  );
}

export function extendObject() {
  var source;
  var propertyName;
  var targetValue;
  var sourceValue;
  var isSourceArray;
  var clone;
  var target = arguments[0] || {};
  var argumentIndex = 1;
  var argumentCount = arguments.length;
  var isDeep = false;
  for (
    typeof target === "boolean" &&
      ((isDeep = target), (target = arguments[argumentIndex] || {}), argumentIndex++),
      typeof target !== "object" && typeof target !== "function" && (target = {}),
      argumentIndex === argumentCount && ((target = this), argumentIndex--);
    argumentIndex < argumentCount;
    argumentIndex++
  ) {
    if ((source = arguments[argumentIndex]) != null) {
      for (propertyName in source) {
        sourceValue = source[propertyName];
        if (propertyName !== "__proto__" && target !== sourceValue) {
          if (
            isDeep &&
            sourceValue &&
            (isPlainObject(sourceValue) || (isSourceArray = Array.isArray(sourceValue)))
          ) {
            targetValue = target[propertyName];
            clone =
              isSourceArray && !Array.isArray(targetValue)
                ? []
                : isSourceArray || isPlainObject(targetValue)
                  ? targetValue
                  : {};
            isSourceArray = false;
            target[propertyName] = extendObject(isDeep, clone, sourceValue);
          } else if (sourceValue !== undefined) {
            target[propertyName] = sourceValue;
          }
        }
      }
    }
  }
  return target;
}

export function getValueAtPath(object, path) {
  let value = object;
  for (let segment of path.split(".")) {
    value = value[segment];
  }
  return value;
}

export function setValueAtPath(object, path, value) {
  for (
    var target = object,
      segments = path.split("."),
      segmentCount = segments.length,
      segmentIndex = 0;
    segmentIndex < segmentCount - 1;
    segmentIndex++
  ) {
    var segment = segments[segmentIndex];
    if (!target[segment]) {
      target[segment] = {};
    }
    target = target[segment];
  }
  target[segments[segmentCount - 1]] = value;
}

export function copyWithOverrides(source, target, overrides) {
  (function (copyFrom, copyTo) {
    for (const key in copyFrom) {
      if (Object.prototype.hasOwnProperty.call(copyFrom, key)) {
        const value = copyFrom[key];
        copyTo[key] = Array.isArray(value) ? value.slice() : value;
      }
    }
  })(source, target);
  for (const key in overrides) {
    if (Object.prototype.hasOwnProperty.call(target, key)) {
      target[key] = overrides[key];
    }
  }
  return target;
}
