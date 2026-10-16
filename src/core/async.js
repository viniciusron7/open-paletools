/**
 * `waitForDelay` (abortable, optionally randomised delay used throughout to pace Web App, UTAS
 * and market requests) and `isPromise` (native-Promise test used by the plugin runner in
 * src/bootstrap/boot.js and by src/webapp/patches.js).
 *
 * Invariants:
 * - `waitForDelay(min, max)` waits a uniform random time between `min` and `max` ms (exactly
 *   `min` when `max` is falsy); callers rely on it to space their requests.
 * - It never rejects: an already aborted signal resolves at once, a later abort resolves early
 *   and clears the timer.
 * - `isPromise` is true only for objects whose constructor is named 'Promise'; other thenables
 *   are not awaited by its callers.
 *
 * Known issues (kept as-is):
 * - The `Math.floor(Math.random())` term is always 0, so it adds no extra jitter.
 */
export function waitForDelay(delay, maxDelay, abortSignal) {
  delay =
    1000 *
    ((delay = maxDelay ? Math.random() * (maxDelay - delay) + delay : delay) / 1000 +
      Math.floor(Math.random()));
  return new Promise((resolve) => {
    if (abortSignal?.aborted) {
      return void resolve();
    }
    const finish = () => {
      clearTimeout(timeoutId);
      abortSignal?.removeEventListener("abort", finish);
      resolve();
    };
    const timeoutId = setTimeout(finish, delay);
    abortSignal?.addEventListener("abort", finish, {
      once: true,
    });
  });
}

export function isPromise(maybePromise) {
  return !(
    !maybePromise ||
    !maybePromise.then ||
    typeof maybePromise.then !== "function" ||
    maybePromise?.constructor?.name !== "Promise"
  );
}
