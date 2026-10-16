/**
 * Web App side of Bulk buy, used by market-automation/sessions.js: coin balance, one raw
 * transfer-market page search per call, the candidate filter and lost-offer detection.
 *
 * Invariants:
 * - `getBulkBuyCoins` reads the COINS currency of `services.User.getUser()` (`value()` or
 *   `amount`) and throws unless it is a non-negative safe integer.
 * - OVR is not a server-side transfer-market filter: each search asks for all players with
 *   `maxBuy = row.maxPrice` (other prices 0, no defId) and `disableOverrides: true`, bypassing
 *   the patches.js transformers/validators; every page is inspected, including pages without
 *   candidates.
 * - Page size from `EAConfigurationRepository` (`KEY_ITEMS_PER_PAGE` /
 *   `ITEMS_PER_PAGE.TRANSFER_MARKET`, 20 without config); offsets are multiples of it, page =
 *   offset / size + 1; only the first `size` items are used and `hasMore` means more than `size`
 *   came back (the native next-page lookahead).
 * - The market cache is cleared before each search and `restoreNotificationQueue()` always runs
 *   after it (the patches.js search wrapper replaced `services.Notification.queue`).
 * - `isBulkBuyCandidate`: player with `rating === row.ovr`, valid tradeId, ACTIVE, not own trade,
 *   not pending expiry, not already highest bidder, integer buyNowPrice in [200, row.maxPrice].
 * - `isBulkBuyAuctionUnavailable`: `success === false` with `UtasErrorCode.STATE_INVALID` (462)
 *   or `INVALID_OWNER` (479) and HTTP 403, or `NO_TRADE_EXISTS` (478) and HTTP 404 (a status
 *   equal to the code is also accepted); the numbers are fallbacks when `UtasErrorCode` is
 *   missing.
 */
import { renderBulkBuyStatus } from "./status-panel.js";
import {
  createPlayerSnipeAbortError,
  observePlayerSnipeRequest,
  validatePlayerSnipeResponse,
} from "../market-automation/requests.js";
import { restoreNotificationQueue } from "../../webapp/patches.js";

export function getBulkBuyCoins() {
  const user = services.User.getUser();
  const currency =
    typeof user?.getCurrency === "function" ? user.getCurrency(GameCurrency.COINS) : user?.coins;
  const coins = typeof currency?.value === "function" ? currency.value() : currency?.amount;
  if (!Number.isSafeInteger(coins) || coins < 0) {
    throw new Error("Could not read the account's coin balance.");
  }
  return coins;
}

function getBulkBuyPageSize() {
  const repository = getAppMain().getConfigRepository();
  const config = repository.getConfigObject(EAConfigurationRepository.KEY_ITEMS_PER_PAGE);
  const size = config ? config[EAConfigurationRepository.ITEMS_PER_PAGE.TRANSFER_MARKET] : 20;
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("The Transfer Market page size is invalid.");
  }
  return size;
}

export function isBulkBuyCandidate(item, row) {
  const auction = item?.getAuctionData?.();
  const tradeId = auction?.tradeId;
  const validId =
    (typeof tradeId === "string" && tradeId.trim() !== "" && tradeId.trim() !== "0") ||
    (Number.isSafeInteger(tradeId) && tradeId > 0);
  return (
    item?.isPlayer?.() === true &&
    item.rating === row.ovr &&
    validId &&
    auction._tradeState === AuctionTradeStateEnum.ACTIVE &&
    auction.tradeOwner !== true &&
    !(typeof auction.isPendingExpiry === "function" && auction.isPendingExpiry()) &&
    auction._bidState !== "highest" &&
    Number.isSafeInteger(auction.buyNowPrice) &&
    auction.buyNowPrice >= 200 &&
    auction.buyNowPrice <= row.maxPrice
  );
}

export async function searchBulkBuyMarket(session, row, { offset, signal }) {
  if (signal.aborted) {
    throw createPlayerSnipeAbortError();
  }
  const pageSize = getBulkBuyPageSize();
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % pageSize !== 0) {
    throw new Error("The page requested for the bulk buy is invalid.");
  }
  const page = offset / pageSize + 1;
  const criteria = new UTSearchCriteriaDTO();
  Object.assign(criteria, {
    type: SearchType.PLAYER,
    minBid: 0,
    maxBid: 0,
    minBuy: 0,
    maxBuy: row.maxPrice,
    defId: [],
    maskedDefId: 0,
    disableOverrides: true,
  });
  session.page = page;
  if (session.lastStatus) {
    renderBulkBuyStatus(session, session.lastStatus);
  }
  services.Item.clearTransferMarketCache();
  let response;
  try {
    response = validatePlayerSnipeResponse(
      await observePlayerSnipeRequest(services.Item.searchTransferMarket(criteria, page), signal),
      "search offers for the bulk buy",
    );
  } finally {
    restoreNotificationQueue();
  }
  if (!Array.isArray(response.data?.items)) {
    throw new Error("The Transfer Market returned an invalid list of offers.");
  }
  const rawItems = response.data.items;
  // OVR is not a server-side transfer-market filter. Inspect every page,
  // including pages with no candidates, and keep the native lookahead.
  return {
    items: rawItems.slice(0, pageSize).filter((item) => isBulkBuyCandidate(item, row)),
    hasMore: rawItems.length > pageSize,
    nextOffset: offset + pageSize,
  };
}

export function isBulkBuyAuctionUnavailable(response) {
  if (response?.success !== false) {
    return false;
  }
  const code = Number(response.error?.code);
  const status = Number(response.status);
  const nativeCodes = typeof UtasErrorCode === "undefined" ? {} : UtasErrorCode;
  const invalidState = nativeCodes.STATE_INVALID ?? 462;
  const noTrade = nativeCodes.NO_TRADE_EXISTS ?? 478;
  const ownTrade = nativeCodes.INVALID_OWNER ?? 479;
  const mappedStatus =
    code === noTrade ? 404 : code === invalidState || code === ownTrade ? 403 : null;
  return mappedStatus !== null && (status === mappedStatus || status === code);
}
