/**
 * Hook engine for EA prototype methods. `prototypeOverride.overridePrototypeMethod(Ctor,
 * method, before, after)` installs, once per prototype and method, a wrapper that runs the
 * registered before hooks, the original method and the after hooks, and returns a function that
 * removes the hooks it added. `hookPrototypeMethod` (used by src/webapp/patches.js and plugins)
 * is the same call but also accepts an array of constructors; `setHookResult` is
 * `prototypeOverride.setResult`.
 *
 * Invariants:
 * - State lives in a WeakMap keyed by `Ctor.prototype`. The first hook captures the current
 *   function (own or inherited) as `original` and sets the wrapper as an own property; later
 *   hooks reuse that state and never re-wrap, even if the method was replaced directly since.
 *   A direct override installed later runs the hooks only if it calls the previous function.
 * - Order: `fn.priority` (number, default 0, higher first), then registration order. The same
 *   function registered twice on one phase returns the existing id; `fn.once` hooks are removed
 *   after their first call. `priority`/`once` are read at registration.
 * - Before hooks get `this` and the current args. `cancel(value)` skips the remaining before
 *   hooks and the original and makes `value` the result; `setArgs(array)` replaces the args of
 *   later hooks, the original and the after hooks (a non-array throws). Other return values
 *   are ignored.
 * - After hooks run also after a cancel, but not when a before hook or the original throws (or
 *   rejects), with `(...args, result)`; `setResult(value)` replaces the result for later hooks
 *   and the caller.
 * - A thenable from a before hook or the original makes the call return a Promise (later before
 *   hooks are awaited one by one); with only synchronous code the call stays synchronous.
 * - Exceptions from hooks reach the caller; a throwing before hook prevents the original.
 * - Removing hooks leaves the wrapper installed; `restoreOriginal(Ctor, method)` reinstalls the
 *   captured original and drops all hooks of that method (and any direct override made later).
 *
 * Known issues (kept as-is):
 * - When an after hook returns a thenable, the continuation passes the undeclared `i`
 *   (`i + 1`): the call's promise rejects with ReferenceError and later after hooks never run.
 */
export const prototypeOverride = (() => {
  const cancelDirective = Symbol("PrototypeOverride.CANCEL");
  const setArgsDirective = Symbol("PrototypeOverride.SET_ARGS");
  const setResultDirective = Symbol("PrototypeOverride.SET_RESULT");
  const hookStatesByPrototype = new WeakMap();
  function sortHooksByPriority(hooks, unusedArgument2) {
    return [...hooks].sort((left, right) =>
      right.priority !== left.priority ? right.priority - left.priority : left.order - right.order,
    );
  }
  function removeHookById(hooks, hookId) {
    const matchingIndex = hooks.findIndex((hook) => hook.id === hookId);
    if (matchingIndex >= 0) {
      hooks.splice(matchingIndex, 1);
    }
  }
  function isThenable(candidate) {
    return (
      !!candidate &&
      (typeof candidate === "object" || typeof candidate === "function") &&
      typeof candidate.then === "function"
    );
  }
  function isDirective(candidate, directiveSymbol) {
    return Array.isArray(candidate) && candidate.length >= 1 && candidate[0] === directiveSymbol;
  }
  function addHook(hookState, phase, hookFunction) {
    if (typeof hookFunction !== "function") {
      throw new Error(phase + " must be a function");
    }
    const existingHook = hookState[phase].find(
      (registeredHook) => registeredHook.fn === hookFunction,
    );
    if (existingHook) {
      return existingHook.id;
    }
    const newHook = {
      id: hookState.nextId++,
      fn: hookFunction,
      priority: typeof hookFunction.priority === "number" ? hookFunction.priority : 0,
      once: !!hookFunction.once,
      order: hookState.orderCounter++,
    };
    hookState[phase].push(newHook);
    return newHook.id;
  }
  return {
    overridePrototypeMethod: function (classConstructor, methodName, beforeHook, afterHook) {
      if (!classConstructor?.prototype) {
        throw new Error("ClassCtor must be a class/constructor");
      }
      const methodHookState = (function (targetPrototype, methodName) {
        let hookStatesByMethod = hookStatesByPrototype.get(targetPrototype);
        if (!hookStatesByMethod) {
          hookStatesByMethod = new Map();
          hookStatesByPrototype.set(targetPrototype, hookStatesByMethod);
        }
        let hookState = hookStatesByMethod.get(methodName);
        if (hookState) {
          return hookState;
        }
        const original = targetPrototype[methodName];
        if (typeof original !== "function") {
          throw new Error(String(methodName) + " is not a function");
        }
        hookState = {
          methodName: methodName,
          original: original,
          wrapped: null,
          nextId: 1,
          before: [],
          after: [],
          orderCounter: 1,
        };
        hookState.wrapped = function (...args) {
          const thisArg = this;
          let cancelReturnValue;
          let currentArgs = args;
          let isCancelled = false;
          const runRemainingBeforeHooksAsync = async (hooks, startIndex) => {
            for (let index = startIndex; index < hooks.length; index++) {
              const hook = hooks[index];
              const hookResult = hook.fn.call(thisArg, ...currentArgs);
              if (hook.once) {
                removeHookById(hookState.before, hook.id);
                hookState.beforeSorted = null;
              }
              const resolvedHookResult = isThenable(hookResult) ? await hookResult : hookResult;
              if (applyBeforeHookDirective(resolvedHookResult) === "CANCELLED") {
                break;
              }
            }
          };
          const applyBeforeHookDirective = (directive) => {
            if (isDirective(directive, setArgsDirective)) {
              const newArgs = directive[1];
              if (!Array.isArray(newArgs)) {
                throw new Error("SET_ARGS requires an array");
              }
              currentArgs = newArgs;
            } else if (isDirective(directive, cancelDirective)) {
              isCancelled = true;
              cancelReturnValue = directive[1];
              return "CANCELLED";
            }
          };
          const runAfterHooks = (returnedValue) => {
            let currentResult = returnedValue;
            const sortedAfterHooks =
              hookState.afterSorted ??
              (hookState.afterSorted = sortHooksByPriority(hookState.after));
            for (const hook of sortedAfterHooks) {
              const hookResult = hook.fn.call(thisArg, ...currentArgs, currentResult);
              if (hook.once) {
                removeHookById(hookState.after, hook.id);
              }
              if (hook.once) {
                hookState.afterSorted = null;
              }
              const applyAfterHookDirective = (directive) => {
                if (isDirective(directive, setResultDirective)) {
                  currentResult = directive[1];
                }
              };
              if (isThenable(hookResult)) {
                return hookResult.then((resolvedHookResult) => {
                  applyAfterHookDirective(resolvedHookResult);
                  return runRemainingAfterHooksAsync(
                    sortedAfterHooks,
                    i + 1,
                    currentArgs,
                    currentResult,
                    thisArg,
                  );
                });
              }
              applyAfterHookDirective(hookResult);
            }
            return currentResult;
          };
          const runRemainingAfterHooksAsync = async (
            hooks,
            startIndex,
            hookArgs,
            initialResult,
            receiver,
          ) => {
            let currentResult = initialResult;
            for (let index = startIndex; index < hooks.length; index++) {
              const hook = hooks[index];
              const hookResult = hook.fn.call(receiver, ...hookArgs, currentResult);
              if (hook.once) {
                removeHookById(hookState.after, hook.id);
                hookState.afterSorted = null;
              }
              const resolvedHookResult = isThenable(hookResult) ? await hookResult : hookResult;
              if (isDirective(resolvedHookResult, setResultDirective)) {
                currentResult = resolvedHookResult[1];
              }
            }
            return currentResult;
          };
          const beforeHooksResult = (() => {
            const sortedBeforeHooks =
              hookState.beforeSorted ??
              (hookState.beforeSorted = sortHooksByPriority(hookState.before));
            for (let index = 0; index < sortedBeforeHooks.length; index++) {
              const hook = sortedBeforeHooks[index];
              const hookResult = hook.fn.call(thisArg, ...currentArgs);
              if (hook.once) {
                removeHookById(hookState.before, hook.id);
              }
              if (hook.once) {
                hookState.beforeSorted = null;
              }
              if (isThenable(hookResult)) {
                return hookResult.then((resolvedHookResult) => {
                  if (applyBeforeHookDirective(resolvedHookResult) !== "CANCELLED") {
                    return runRemainingBeforeHooksAsync(sortedBeforeHooks, index + 1);
                  }
                });
              }
              if (applyBeforeHookDirective(hookResult) === "CANCELLED") {
                break;
              }
            }
          })();
          if (isThenable(beforeHooksResult)) {
            return (async () => {
              await beforeHooksResult;
              const rawResult = isCancelled
                ? cancelReturnValue
                : hookState.original.call(thisArg, ...currentArgs);
              const resolvedResult = isThenable(rawResult) ? await rawResult : rawResult;
              const finalResult = runAfterHooks(resolvedResult);
              return isThenable(finalResult) ? await finalResult : finalResult;
            })();
          }
          const originalResult = isCancelled
            ? cancelReturnValue
            : hookState.original.call(thisArg, ...currentArgs);
          return isThenable(originalResult)
            ? originalResult.then((resolvedOriginalResult) => {
                const finalResult = runAfterHooks(resolvedOriginalResult);
                isThenable(finalResult);
                return finalResult;
              })
            : runAfterHooks(originalResult);
        };
        targetPrototype[methodName] = hookState.wrapped;
        hookStatesByMethod.set(methodName, hookState);
        return hookState;
      })(classConstructor.prototype, methodName);
      const beforeHookId = beforeHook ? addHook(methodHookState, "before", beforeHook) : null;
      const afterHookId = afterHook ? addHook(methodHookState, "after", afterHook) : null;
      if (beforeHookId != null) {
        methodHookState.beforeSorted = null;
      }
      if (afterHookId != null) {
        methodHookState.afterSorted = null;
      }
      return function () {
        if (beforeHookId != null) {
          removeHookById(methodHookState.before, beforeHookId);
          methodHookState.beforeSorted = null;
        }
        if (afterHookId != null) {
          removeHookById(methodHookState.after, afterHookId);
          methodHookState.afterSorted = null;
        }
      };
    },
    restoreOriginal: function (classConstructor, methodName) {
      if (!classConstructor?.prototype) {
        throw new Error("ClassCtor must be a class/constructor");
      }
      const prototype = classConstructor.prototype;
      const hookStatesByMethod = hookStatesByPrototype.get(prototype);
      const hookState = hookStatesByMethod?.get(methodName);
      return (
        !!hookState &&
        ((prototype[methodName] = hookState.original),
        hookStatesByMethod.delete(methodName),
        hookStatesByMethod.size === 0 && hookStatesByPrototype.delete(prototype),
        true)
      );
    },
    cancel: (returnValue) => [cancelDirective, returnValue],
    setArgs: (newArgs) => [setArgsDirective, newArgs],
    setResult: (newResult) => [setResultDirective, newResult],
    CANCEL: cancelDirective,
    SET_ARGS: setArgsDirective,
    SET_RESULT: setResultDirective,
  };
})();

export const hookPrototypeMethod = (...hookArgs) => {
  if (Array.isArray(hookArgs[0])) {
    const unhookFunctions = hookArgs[0].map((classConstructor) =>
      prototypeOverride.overridePrototypeMethod(classConstructor, ...hookArgs.slice(1)),
    );
    return function () {
      for (const unhook of unhookFunctions) {
        unhook();
      }
    };
  }
  return prototypeOverride.overridePrototypeMethod(...hookArgs);
};

export const setHookResult = (...args) => prototypeOverride.setResult(...args);
