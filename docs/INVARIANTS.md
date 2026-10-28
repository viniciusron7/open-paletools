# Invariants and sensitive behaviors

English | [Português](pt/INVARIANTS.md) | [Español](es/INVARIANTS.md)

This document gathers rules and behaviors that can be broken inadvertently during modifications. Module-specific details are documented in the header comment of each file in `src/`.

## 1. Structure and initialization

- **One scope, manifest order.** The build concatenates the modules of `src/manifest.json` into module 723 of the original webpack runtime. The manifest order defines the initialization order of the original bundle: top-level statements with side effects (prototype patches, `JSUtils.inherits`, `new ...()`) depend on it. Function declarations are hoisted and may reside in any module.
- **Webpack runtime** (`src/runtime/webpack-runtime.js`, do not edit), including empty modules 491 and 831: `importModule(491)` and `getEmptyModule831Default()` run during boot and must remain.
- **Boot** (`src/bootstrap/boot.js`): `bootWhenWebAppReady` runs immediately if `document.body` exists (otherwise on `DOMContentLoaded`) and retries every 1 s until `.ut-login` is absent and `services.Localization` and `services.Authentication.utasSession.url` exist. Then: hidden iframe to restore `console`, mobile (`phone`) classes, `applyWebAppPatches()`, IndexedDB database initialization, and `initializePluginsWhenReady` (if `.ut-tab-bar` is missing, it schedules a 1 s retry timer and returns). `getAppMain()._ptBooted` is set when `bootWhenWebAppReady` finishes, which can occur before plugins run: any attempt starting after the flag is set does nothing, whereas another script instance (such as the official Paletools) whose attempt starts before the flag is set also completes boot.
- **Plugin list.** The literal list of built-in plugins in `initializePluginsWhenReady`, the `getEmptyModule831Default()` entry (a `{}`), the `left.order - right.order` comparator and `Array.prototype.sort` must remain unchanged: some entries have no `order`, causing the comparator to return `NaN` and making the resulting order depend on list positions. Reordering, adding or removing entries in the built-in list, or modifying the comparator, alters the execution order of built-in plugins and hook chaining. New plugins must be registered in `src/custom-plugins.js`: that list is appended after sorting and runs after the built-in list, before the settings plugin.
- **No error isolation.** If a plugin's `run()` throws, subsequent plugins, the settings menu and the `APP_LOADED`/`APP_STARTED` events do not execute.
- **Hook chaining.** Multiple plugins override the same method (for example `UTMarketSearchFiltersView.prototype._generate`), each calling the previous implementation. Plugin execution order defines the nesting. Direct overrides must continue calling the captured method; hooks in `src/core/prototype-override.js` reuse a single wrapper per method (supporting priority, `cancel`, `setArgs`, `setResult`, `once`).

## 2. Player snipe (`src/plugins/player-snipe/`, `market-automation/`)

- **Confirmation.** The button is enabled only on the visible filters screen, with a player selected and a valid whole `Buy Now Price Max` (200–14,999,000, aligned to a price increment). The dialog displays the player and maximum price; on **Confirm**, all conditions are re-verified (visible controller, same player, same maximum, compatible Player ID filter). Every search repeats the check and terminates the session if the player or maximum changed.
- **Identity.** Any version of the same player matches (same `definitionId`, or same base id via `ItemIdMask.DATABASE`); `defId` and the Player ID field must share the same base id.
- **First eligible offer.** Filters active offers for the player with a whole `buyNowPrice` in `(0, maximum]` and buys `items[0]` **in server order** (without sorting by price), stopping after the first confirmed purchase.
- **Minimum progression** (`getNextPlayerSnipePrices`): starts at `{minBid: 0, minBuy: 0}`; each cycle advances `minBuy` by one Transfer Market price increment (`UTCurrencyInputControl.getIncrementAboveVal`); when `minBuy` would reach `maximum / 2`, it advances `minBid` and sets `minBuy` equal to it. **Always maintains `minBuy < maximum / 2` (strict).** When `minBid` can no longer advance, the cycle restarts at 0/0 without stopping.
- **Variable pauses** (`createPlayerSnipeTiming`): whole milliseconds — search 80–180, return 70–160, adjust 30–90, buy 15–55 — never repeating the immediately preceding pause (overall) nor the previous pause of the same action.
- **CHANGE event protection.** Native price setters emit CHANGE and `e*PriceChanged` handlers normalize minimums (`minBid < minBuy`). While a session is active, those handlers are cancelled via hooks (`prototypeOverride.cancel()`); the search writes prices to the DTO, invokes the setters and writes the values back. Cancellation depends solely on `activePlayerSnipeSession`; `triggeringSearch` only distinguishes session searches from manual ones, and `applyingFilters` is written but never read.
- **Search capture.** The `services.Item.searchTransferMarket` wrapper hands the observable to the pending search only if it has not been captured yet and `maxBuy`, `minBid` and `minBuy` match. It must remain the outer wrapper (installed at order 10010).
- **Stop.** Aborts the signal, preventing new searches or purchases. **A purchase already sent continues to be observed without the abort signal** (subject only to the 30 s timeout) and, if confirmed, is counted. A manual search (`eSearchSelected` not triggered by the session), filter reset or disabling Paletools also terminates the session.

## 3. Bulk Buy (`src/plugins/bulk-buy/`, `market-automation/`)

- **Plan** (`validateBulkBuyPlan`): multiple rows of OVR (1–99) / max price (200–14,999,000, multiple of the tier's price increment: ≤1,000→50, ≤10,000→100, ≤50,000→250, ≤100,000→500, above→1,000) / quantity (positive whole number). **The sum of max costs must be strictly lower than the coin balance.**
- **Budget revalidation.** Performed in the dialog on every input change and on every `USER_CURRENCY_UPDATE`; on **Run**, validates the plan, refreshes the balance from the server, validates again, closes the dialog and revalidates in `startBulkBuy`. Before each bid, the max cost of remaining units must be strictly lower than `min(current balance, initial balance − spent)`.
- **Accounting.** Only confirmed purchases with a whole price in `(0, row max]` count.
- **Exact OVR with pagination.** The Transfer Market does not filter exact OVR on the server: each page fetches players up to the max price with `disableOverrides: true` and checks `rating === OVR` locally; pages without eligible candidates are also traversed; page size comes from EA configuration and the lookahead page indicates whether more results exist. After each purchase, the row restarts from the first page.
- **Deduplication.** Each auction (`tradeId`) is attempted at most once per run, recording the key before sending the bid.
- **Lost offers.** EA responses 462/478/479 (with matching HTTP statuses) are skipped without counting; any other failure terminates the run with an error.
- **Stop.** Same as sniping: prevents new purchases while observing and counting any in-flight purchase.

## 4. Mutual exclusion of the two automations

`src/plugins/market-automation/sessions.js` is the sole owner of `activePlayerSnipeSession`, `playerSnipeConfirmation`, `activeBulkBuySession` and `bulkBuyConfirmation`. While any of them is set, neither automation opens a dialog or starts a session, and both buttons remain disabled. Keeping this state and its mutators in a single module prevents import cycles.

## 5. Upstream automations that buy (Paletools 27.2.1)

Originating from the official release, these are **not** part of the mutual exclusion in section 4 and share the account's Transfer Market rate limits:

- **Auto Snipe** (`src/plugins/auto-snipe/`): disabled by default; enabling it prompts `plugins.dangerous`. Runs only on its dedicated screen (Transfers hub tile) while Paletools and Auto Snipe are enabled; leaving the screen or disabling the option stops it. Each search and each purchase counts as one attempt (`maxSnipes`), and bought cards count toward `maxCards`; buys all active offers at or below the maximum price, cheapest first. Its embedded market filters execute `market-search-filters` hooks and also receive the Snipe Player and Bulk Buy buttons, which its stylesheet hides.
- **Album and gallery Buy button** (`src/plugins/album/album-view-controller.js`): disabled by default (`album.buyEnabled`, `gallery.buyEnabled`, confirmed with `plugins.dangerous`); performs one purchase at a time of the cheapest active offer for that exact card, after a confirmation dialog and only if the price remains unchanged.

## 6. Persisted data and external identifiers

Do not rename: `localStorage` keys (e.g. `paletools:settings`, `paletools:searchFilters`), IndexedDB database and store names, configuration keys (`configuration.plugins.<name>`), translation keys, event names (`paletools:*`), CSS ids/classes referenced by styles or shortcuts, and methods added to Web App prototypes called by name across modules.

## 7. Known defects inherited from the original script

Pre-existing defects from the original Paletools were intentionally preserved to maintain identical behavior. The complete list is in the `"Known issues (kept as-is)"` section of each module's header comment. Fixing any of them constitutes a behavior change and requires running `npm test`.

- Undeclared identifiers — `saveConfiguration`, `updateConfiguration`, `addStyles`, `removeStyles`, `remove`, `i`, `info` and one `response` — throw `ReferenceError` when executed (listed in `src/external-globals.json`, `undeclaredInOriginal`).
- `hasClass("phone")` during boot is called without an element.
- The plugin list comparator returns `NaN` for entries without `order` (see section 1).
- Market result transformers (`src/webapp/patches.js`) apply to Player Snipe searches (which do not use `disableOverrides`). With "hide duplicates" (`marketSearchFilters.hideDuplicates`) enabled, offers whose `definitionId` is already in the club are filtered out before reaching sniping. Since 27.2.1, the same applies to offers outside the OVR range in `marketSearchFilters.playerRating`. Bulk Buy and Auto Snipe are unaffected (`disableOverrides: true`).

Defects introduced in Paletools 27.2.1 and preserved by the port:

- Club Analyzer: 27.2.1 removed `counters.rare` initialization while still incrementing it for rare (`rareflag` 1) players, throwing a `TypeError` on the first rare non-loan club player and preventing the analysis from finishing.
- Market search filters: the holographic/OVR result transformer runs even when Paletools is disabled, and `handlePlayerIdChange` writes `defId = []` on the active controller even when it is not a market-filters controller.
