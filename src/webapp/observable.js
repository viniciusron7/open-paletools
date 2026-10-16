/**
 * `observableToPromise(observable)` resolves with the first response an EA observable notifies
 * and then unobserves it. It never rejects, so callers check `response.success` themselves.
 * Used by the club search/index, item-pile helpers, currencies and many plugins.
 */
export function observableToPromise(observable) {
  return new Promise((resolve, reject) => {
    observable.observe(this, (sender, response) => {
      sender.unobserve(this);
      resolve(response);
    });
  });
}
