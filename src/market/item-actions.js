/**
 * Shared `UTItemActionController` instance (`sharedItemActionController`) through which the
 * player-snipe market flow and the legacy snipe plugin place their bids.
 *
 * Invariants:
 * - Created at module evaluation, so `UTItemActionController` must exist when the script runs.
 * - The player-snipe and bulk-buy tests inject a fake named `sharedItemActionController`.
 */
export const sharedItemActionController = new UTItemActionController();
