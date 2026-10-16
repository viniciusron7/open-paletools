/**
 * Builds the fixed Player snipe status panel (`aside.paletools-player-snipe-status`: a polite
 * live status line and a Stop button calling `session.runner.stop()`), called by
 * `startPlayerSnipe` in market-automation/sessions.js.
 *
 * Invariants:
 * - Stores `status`, `stopButton` and `panel` on the session; the runner's `onStatus` writes
 *   them, so the panel must exist before `runner.start()`. The session removes the panel when the
 *   run ends.
 */
export function createPlayerSnipeStatus(session) {
  const panel = document.createElement("aside");
  panel.className = "paletools-player-snipe-status";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const stop = document.createElement("button");
  stop.type = "button";
  stop.textContent = "Stop";
  stop.setAttribute("aria-label", "Stop sniping");
  stop.addEventListener("click", () => session.runner.stop());
  panel.append(status, stop);
  document.body.append(panel);
  session.status = status;
  session.stopButton = stop;
  session.panel = panel;
}
