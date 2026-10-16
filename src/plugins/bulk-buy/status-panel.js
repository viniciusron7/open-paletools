/**
 * Renders the Bulk buy summary panel created by `startBulkBuy` in market-automation/sessions.js;
 * called from the runner's `onStatus`, the final result and `searchBulkBuyMarket` (page number).
 *
 * Invariants:
 * - Stores `session.lastStatus`; shows the phase label, confirmed purchases against
 *   `session.plan.totalQuantity`, coins spent, the page while searching and one line per row;
 *   Stop is disabled while 'stopping'. Phases without a label ('bought', 'rowUnavailable') show
 *   'Bulk Buy'.
 */
import { formatNumber } from "../../i18n/translations.js";

export function renderBulkBuyStatus(session, status) {
  session.lastStatus = status;
  const phases = {
    searching: "Searching offers",
    buying: "Buying",
    waiting: "Preparing the next purchase",
    stopping: "Stopping; waiting for the current operation",
    complete: "Bulk buy complete",
    stopped: "Bulk buy stopped",
    unavailable: "Not all requested offers were found",
    error: "Bulk buy ended",
  };
  const bought = status.totalBought ?? status.bought ?? 0;
  const spent = status.spent ?? 0;
  session.status.textContent =
    `${phases[status.phase] || "Bulk Buy"}. ` +
    `Bought: ${bought}/${session.plan.totalQuantity}. Spent: ${formatNumber(spent)} coins.` +
    (status.phase === "searching" && session.page ? ` Page ${session.page}.` : "");
  session.rows.replaceChildren();
  for (const row of status.rows || session.plan.rows) {
    const line = document.createElement("li");
    line.textContent =
      `OVR ${row.ovr}: ${row.bought || 0}/${row.quantity} · ` +
      `up to ${formatNumber(row.maxPrice)} coins per player`;
    session.rows.append(line);
  }
  session.stopButton.disabled = status.phase === "stopping";
}
