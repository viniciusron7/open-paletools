/**
 * Promise wrappers for EA observables (the Web App's request results).
 *
 * - `observableToPromise(observable)` resolves with the first response the observable notifies
 *   and then unobserves it. It never rejects, so callers check `response.success` themselves.
 *   Used by the club search/index, item-pile helpers, currencies and many plugins.
 * - `observableToPromiseWithTimeout(observable)` (added in 27.2.1, used by the album Buy
 *   button) does the same with its own observer object, and rejects with `Error("timeout")`
 *   after 30 s without a response (unobserving first).
 */
export function observableToPromise(observable) {
  return new Promise((resolve, reject) => {
    observable.observe(this, (sender, response) => {
      sender.unobserve(this);
      resolve(response);
    });
  });
}

export function observableToPromiseWithTimeout(observable) {
  return new Promise((resolve, reject) => {
    const observer = {};
    const timeoutId = setTimeout(() => {
      observable.unobserve(observer);
      reject(new Error("timeout"));
    }, 30000);
    observable.observe(observer, (sender, response) => {
      clearTimeout(timeoutId);
      sender.unobserve(observer);
      resolve(response);
    });
  });
}
