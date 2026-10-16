# Invariants and sensitive behaviors

This document gathers the rules that a change can break without noticing. Read the section of the feature you are about to change. The details of each module are in the header comment of its own file in `src/`.

## 1. Structure and initialization

- **One scope, manifest order.** The build concatenates the modules of `src/manifest.json` into module 723 of the original webpack runtime. The manifest order is the initialization order of the original bundle: top-level statements with effects (prototype patches, `JSUtils.inherits`, `new ...()`) depend on it. Function declarations are hoisted and may live in any module.
- **Webpack runtime** (`src/runtime/webpack-runtime.js`, do not edit), including the empty modules 491 and 831: `importModule(491)` and `getEmptyModule831Default()` run during the boot and must stay.
- **Boot** (`src/bootstrap/boot.js`): `bootWhenWebAppReady` runs immediately if `document.body` exists (otherwise on `DOMContentLoaded`) and retries every 1 s until there is no `.ut-login` and `services.Localization` and `services.Authentication.utasSession.url` exist. Then: hidden iframe to restore `console`, phone classes, `applyWebAppPatches()`, the IndexedDB database, and `initializePluginsWhenReady` (if `.ut-tab-bar` is missing, it starts a 1 s retry timer and returns). `getAppMain()._ptBooted` is set when `bootWhenWebAppReady` finishes, which can be before the plugins run: an attempt that starts after it is set does nothing, but another copy of the script (for example the official Paletools) whose attempt starts before it is set boots too.
- **Plugin list.** The literal list of built-in plugins in `initializePluginsWhenReady`, the `getEmptyModule831Default()` entry (a `{}`), the `left.order - right.order` comparator and `Array.prototype.sort` must stay as they are: some entries have no `order`, the comparator returns `NaN` and the resulting order depends on the positions in the list. Reordering, adding or removing entries, or "fixing" the comparator, changes the run order of the built-in plugins and the hook chaining. New plugins go in `src/custom-plugins.js` instead: that list is appended after the sort and runs after the built-in list, in its own order, before the settings plugin.
- **No error isolation.** If a plugin's `run()` throws, the following plugins, the settings menu and the `APP_LOADED`/`APP_STARTED` events do not happen.
- **Hook chaining.** Several plugins override the same method (for example `UTMarketSearchFiltersView.prototype._generate`): each one calls the previous one. The plugins' run order defines the nesting. Direct overrides must keep calling the captured method; the hooks in `src/core/prototype-override.js` reuse a single wrapper per method (priority, `cancel`, `setArgs`, `setResult`, `once`).

## 2. Player snipe (`src/plugins/player-snipe/`, `market-automation/`)

- **Confirmation.** The button is only enabled on the visible filters screen, with a player selected and a valid whole `Buy Now Price Max` (200–14,999,000, on a price increment). The dialog shows the player and the maximum; on **Confirm** everything is checked again (visible controller, same player, same maximum, compatible Player ID filter). Every search repeats the check and ends the session if the player or the maximum changed.
- **Identity.** Any version of the same player counts (same `definitionId`, or the same base id `ItemIdMask.DATABASE`); `defId` and the Player ID field must have the same base id.
- **First eligible offer.** It filters the player's active offers with a whole `buyNowPrice` in `(0, maximum]` and buys `items[0]` **in server order** (no sorting by price). It stops after the first confirmed purchase.
- **Minimum progression** (`getNextPlayerSnipePrices`): starts at `{minBid: 0, minBuy: 0}`; each cycle advances `minBuy` by one Transfer Market price increment (`UTCurrencyInputControl.getIncrementAboveVal`); when `minBuy` would reach `maximum / 2`, it advances `minBid` and sets `minBuy` equal to it. **Always `minBuy < maximum / 2` (strict).** When not even `minBid` can advance, the cycle restarts at 0/0 without stopping.
- **Variable pauses** (`createPlayerSnipeTiming`): whole milliseconds — search 80–180, return 70–160, adjust 30–90, buy 15–55 — never equal to the previous pause overall nor to the previous one of the same action.
- **CHANGE event protection.** The native price setters emit CHANGE and the `e*PriceChanged` handlers normalize the minimums (`minBid < minBuy`). While a session is active, those handlers are cancelled by hooks (`prototypeOverride.cancel()`); the search writes the prices to the DTO, calls the setters and writes the values back. The cancellation depends only on `activePlayerSnipeSession`; `triggeringSearch` only tells the session's search apart from a manual one, and `applyingFilters` is written but never read.
- **Search capture.** The `services.Item.searchTransferMarket` wrapper hands the observable to the pending search only if it has not been captured yet and `maxBuy`, `minBid` and `minBuy` match. It must remain the outer wrapper (installed at order 10010).
- **Stop.** It aborts the signal; no new search or purchase starts. **A purchase that was already sent is observed without the signal** (only the 30 s timeout applies) and, if confirmed, it is counted. A manual search (`eSearchSelected` not triggered by the session), a filter reset and turning Paletools off also stop the session.

## 3. Bulk Buy (`src/plugins/bulk-buy/`, `market-automation/`)

- **Plan** (`validateBulkBuyPlan`): several rows of OVR (1–99) / max price (200–14,999,000, a multiple of the price increment of its range: ≤1,000→50, ≤10,000→100, ≤50,000→250, ≤100,000→500, above→1,000) / quantity (positive whole number). **The sum of the max costs is strictly lower than the balance.**
- **Budget revalidation.** In the dialog on every change and on every `USER_CURRENCY_UPDATE`; on **Run**: it validates, refreshes the balance from the server, validates again, closes the dialog and `startBulkBuy` validates once more. Before each bid, the max cost of the remaining units must be lower than `min(current balance, initial balance − spent)`.
- **Only confirmed purchases count**, with a whole price in `(0, row max]`.
- **Exact OVR with pagination.** The Transfer Market does not filter OVR on the server: each page fetches players up to the max price with `disableOverrides: true` and checks `rating === OVR` locally; pages without candidates are also walked; the page size comes from the EA configuration and the extra page (lookahead) indicates that there is more. After each purchase the row restarts from the beginning (the following offers change page).
- **Deduplication.** Each auction (`tradeId`) is tried at most once per run — the key is recorded before the bid.
- **Lost offers.** EA responses 462/478/479 (with the matching HTTP statuses) are skipped without counting; any other failure ends the run with an error.
- **Stop.** Same as sniping: no new purchase, and the purchase in progress is observed and counted.

## 4. Mutual exclusion of the two automations

`src/plugins/market-automation/sessions.js` is the only owner of `activePlayerSnipeSession`, `playerSnipeConfirmation`, `activeBulkBuySession` and `bulkBuyConfirmation`. While any of them exists, neither automation opens a dialog or starts; both buttons are disabled and every place that changes one of these states updates both. That is why this state and the functions that assign it live in a single module (splitting them would create an import cycle).

## 5. Persisted data and external identifiers

Do not rename: `localStorage` keys (for example `paletools:settings`, `paletools:searchFilters`), IndexedDB database and store names, configuration keys (`configuration.plugins.<name>`), translation keys, event names (`paletools:*`), CSS ids/classes used by styles and shortcuts, and methods added to Web App prototypes that other modules call by name.

## 6. Known defects inherited from the original script

These defects come from the original Paletools and were deliberately left as they are, so the script behaves like the original. The complete list is in the "Known issues (kept as-is)" section of each module's header comment. Fixing one is a behavior change: do it on purpose and run `npm test`.

- Identifiers declared nowhere — `saveConfiguration`, `updateConfiguration`, `addStyles`, `removeStyles`, `remove`, `i`, `info` and a `response` — throw `ReferenceError` when that code runs (list in `src/external-globals.json`, `undeclaredInOriginal`).
- `hasClass("phone")` in the boot is called without an element.
- The plugin list comparator returns `NaN` for entries without `order` (see section 1).
- The market result transformers (`src/webapp/patches.js`) apply to the player snipe searches, which do not use `disableOverrides`. With "hide duplicates" (`marketSearchFilters.hideDuplicates`) on, offers whose `definitionId` is already in the club are removed before they reach the sniping, which then does not buy them. Bulk Buy is not affected (it uses `disableOverrides: true`).
