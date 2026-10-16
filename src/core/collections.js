/**
 * Collection helpers (iterability test, array conversion, flattening, grouping, de-duplication)
 * used by the DOM/event helpers and by SBC, club and plugin modules.
 *
 * Invariants:
 * - `toArray` returns arrays as-is (no copy); `EAIterator` instances and other iterables are
 *   converted with `Array.prototype.slice.call`, which only works for array-likes with a
 *   `length` (a Set or Map gives []); any other value becomes a one-element array.
 * - `groupBy` returns a plain object keyed by the selected key (`valueSelector` defaults to
 *   identity); `uniqueBy` keeps the first item per key, in first-seen order, unless
 *   `mergeDuplicate(kept, item)` is given; `flattenArray` flattens one level.
 */
export function isIterable(iterableCandidate) {
  return !!iterableCandidate && typeof iterableCandidate[Symbol.iterator] === "function";
}

export function toArray(inputValue) {
  return inputValue instanceof Array || Array.isArray(inputValue)
    ? inputValue
    : inputValue instanceof EAIterator || isIterable(inputValue)
      ? Array.prototype.slice.call(inputValue)
      : flattenArray([inputValue]);
}

export function flattenArray(arrayValues) {
  return [].concat(...arrayValues);
}

export function groupBy(itemsToGroup, keySelector, valueSelector = null) {
  if (!valueSelector) {
    valueSelector = (identityValue) => identityValue;
  }
  return itemsToGroup.reduce((groups, groupItem) => {
    let groupKey = keySelector(groupItem);
    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }
    groups[groupKey].push(valueSelector(groupItem));
    return groups;
  }, {});
}

export function uniqueBy(itemsToDeduplicate, uniqueKeySelector, mergeDuplicate) {
  const valuesByKey = new Map();
  for (let uniqueItem of itemsToDeduplicate) {
    const uniqueKey = uniqueKeySelector(uniqueItem);
    if (valuesByKey.has(uniqueKey)) {
      if (mergeDuplicate) {
        valuesByKey.set(uniqueKey, mergeDuplicate(valuesByKey.get(uniqueKey), uniqueItem));
      }
    } else {
      valuesByKey.set(uniqueKey, uniqueItem);
    }
  }
  return Array.from(valuesByKey.values());
}
