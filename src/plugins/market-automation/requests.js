/**
 * Promise helpers shared by Player snipe and Bulk buy (market-automation/sessions.js,
 * player-snipe/market.js, bulk-buy/market.js): abortable sleep, EA observable to Promise with
 * timeout, and response validation.
 *
 * Invariants:
 * - `PLAYER_SNIPE_REQUEST_TIMEOUT_MS` (30 s) bounds every observed request (searches, purchases,
 *   balance refresh) and the wait for the native snipe search to start.
 * - `observePlayerSnipeRequest(observable, signal?)` settles once, always clears its timer,
 *   removes the abort listener and unobserves. The signal is optional on purpose: purchases are
 *   observed without it so Stop never abandons a bid already sent (the timeout still applies).
 * - Aborts reject with `DOMException('Sniping stopped.', 'AbortError')`; the runners report
 *   any error raised after an abort as 'stopped'. `waitForPlayerSnipe` clears its timer on abort.
 * - `validatePlayerSnipeResponse` throws unless `success` is truthy, there is no `error` and
 *   `status` is below 400.
 *
 * Known issues (kept as-is):
 * - The error text always ends with 'Sniping was stopped.', also for bulk-buy searches and
 *   purchases and the bulk-buy balance refresh.
 */
export const PLAYER_SNIPE_REQUEST_TIMEOUT_MS = 30000;

export function createPlayerSnipeAbortError() {
  return new DOMException("Sniping stopped.", "AbortError");
}

export function waitForPlayerSnipe(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      return reject(createPlayerSnipeAbortError());
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(createPlayerSnipeAbortError());
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, {
      once: true,
    });
  });
}

export function observePlayerSnipeRequest(observable, signal) {
  return new Promise((resolve, reject) => {
    const observer = {};
    let settled = false;
    let timeout;
    const settle = (error, response) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      observable.unobserve(observer);
      if (error) {
        reject(error);
      } else {
        resolve(response);
      }
    };
    const onAbort = () => settle(createPlayerSnipeAbortError());
    if (signal?.aborted) {
      return settle(createPlayerSnipeAbortError());
    }
    timeout = setTimeout(
      () => settle(new Error("The Transfer Market took too long to respond.")),
      PLAYER_SNIPE_REQUEST_TIMEOUT_MS,
    );
    signal?.addEventListener("abort", onAbort, {
      once: true,
    });
    try {
      observable.observe(observer, (sender, response) => settle(null, response));
    } catch (error) {
      settle(error);
    }
  });
}

export function validatePlayerSnipeResponse(response, action) {
  if (!response?.success || response.error || Number(response.status) >= 400) {
    const status = response?.status ? ` (${response.status})` : "";
    throw new Error(`Could not ${action}${status}. Sniping was stopped.`);
  }
  return response;
}
