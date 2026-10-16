/**
 * `TransactionsStore` (`paletoolsDatabase.transactions`): bought and sold item records in the
 * object stores `transactions_bought` and `transactions_sold` (keyPath `itemId`, non-unique
 * indexes `definitionId` and `timestamp`). Written by `services.Item.list` in
 * src/webapp/patches.js, the ITEM_MOVED listener in src/bootstrap/boot.js and the
 * track-transactions plugin; read by the sell-profit plugin (`getBuyByItemId`).
 *
 * Invariants:
 * - `build(oldVersion)` drops both stores when oldVersion < 2 and creates them only when
 *   oldVersion is 0 or 1. It also registers the APP_LOADED listener that runs `scan()`; `build`
 *   only runs inside `upgradeneeded`, so the scan only happens in sessions that upgrade the DB.
 * - Record shape `{itemId, definitionId, staticDataId, rating, price, auctionId (tradeId),
 *   itemType, timestamp}`; `timestamp` is `toUtcDateTimeNumber` (YYYYMMDDhhmmss, UTC) and the
 *   date-range queries convert their bounds the same way. Item timestamps below 1577836800000
 *   (2020-01-01 in ms) are treated as seconds.
 * - Inserts are fire-and-forget and skipped when a record with the same `itemId` exists. The
 *   price falls back to `currentBid`, then `lastSalePrice`; missing prices and prices below 200
 *   are not recorded.
 *
 * Known issues (kept as-is):
 * - `scan()` iterates `soldItem.filter(...)` over its own loop binding (TDZ ReferenceError
 *   swallowed by the try/catch), so the scan never records sold transfer-list items.
 * - `scan()` calls `loadClubPlayers()` without `shouldLoad`, which returns `{}`, so its club loop
 *   does nothing.
 * - The try/catch around `addRecord` cannot catch its asynchronous rejection (e.g. a duplicate
 *   key when the same item is inserted twice concurrently).
 */
import { loadClubPlayers } from "../club/club-players-cache.js";
import { toUtcDateTimeNumber } from "../core/dates.js";
import { listenForEvent, paletoolsEvents } from "../core/events.js";
import { debugLog } from "../core/logger.js";
import {
  fetchTransferListItems,
  fetchUnassignedItems,
  fetchWatchlistItems,
} from "../webapp/item-piles.js";

const boughtTransactionsStoreName = "transactions_bought";

const soldTransactionsStoreName = "transactions_sold";

export class TransactionsStore {
  #e;
  constructor(database) {
    this.#e = database;
  }
  async #o(storeName, item, price, getExistingRecord) {
    if (!this.#e) {
      return;
    }
    if (await getExistingRecord(item.id)) {
      return;
    }
    let timestamp = item.timestamp;
    if (timestamp < 1577836800000) {
      timestamp *= 1000;
    }
    const auctionData = item.getAuctionData();
    if ((price = price || auctionData.currentBid || item.lastSalePrice) && !(price < 200)) {
      try {
        this.#e.addRecord(storeName, {
          itemId: item.id,
          definitionId: item.definitionId,
          staticDataId: item.getMetaData().id,
          rating: item.rating,
          price: price || auctionData.currentBid,
          auctionId: auctionData.tradeId,
          itemType: item.type,
          timestamp: toUtcDateTimeNumber(new Date(timestamp)),
        });
      } catch (error) {
        debugLog(error);
      }
    }
  }
  async ["build"](oldVersion = 1) {
    debugLog("Building for v" + oldVersion);
    if (oldVersion < 2) {
      this.drop();
    }
    if (!oldVersion || oldVersion === 1) {
      debugLog("Creating object store " + boughtTransactionsStoreName);
      const boughtStore = this.#e.createStore(boughtTransactionsStoreName, {
        keyPath: "itemId",
      });
      boughtStore.createIndex("definitionId", "definitionId", {
        unique: false,
      });
      boughtStore.createIndex("timestamp", "timestamp", {
        unique: false,
      });
      debugLog("Creating object store " + soldTransactionsStoreName);
      const soldStore = this.#e.createStore(soldTransactionsStoreName, {
        keyPath: "itemId",
      });
      soldStore.createIndex("definitionId", "definitionId", {
        unique: false,
      });
      soldStore.createIndex("timestamp", "timestamp", {
        unique: false,
      });
    }
    listenForEvent(paletoolsEvents.APP_LOADED, () => {
      this.scan();
    });
  }
  async ["drop"]() {
    try {
      this.#e.deleteStore(boughtTransactionsStoreName);
    } catch {}
    try {
      this.#e.deleteStore(soldTransactionsStoreName);
    } catch {}
  }
  async ["scan"]() {
    const clubPlayers = await loadClubPlayers();
    for (let definitionId of Object.keys(clubPlayers).filter(
      (candidateDefinitionId) => clubPlayers[candidateDefinitionId].lastSalePrice > 0,
    )) {
      const clubPlayer = clubPlayers[definitionId];
      debugLog(clubPlayer);
      this.insertBuy(clubPlayer, clubPlayer.lastSalePrice, clubPlayer.timestamp);
    }
    try {
      let transferListItems = await fetchTransferListItems();
      for (let item of transferListItems.filter((candidate) => candidate.lastSalePrice > 0)) {
        this.insertBuy(item, item.lastSalePrice, item.timestamp);
      }
      for (let soldItem of soldItem.filter((transferItem) =>
        transferItem.getAuctionData().isSold(),
      )) {
        this.insertSell(soldItem);
      }
    } catch {}
    try {
      let unassignedItems = await fetchUnassignedItems();
      for (let item of unassignedItems.filter((candidate) => candidate.lastSalePrice > 0)) {
        this.insertBuy(item, item.lastSalePrice, item.timestamp);
      }
    } catch {}
    try {
      let watchedItems = await fetchWatchlistItems();
      for (let item of watchedItems.filter((candidate) => candidate.getAuctionData().isWon())) {
        this.insertBuy(item);
      }
    } catch {}
  }
  ["getBuyCount"]() {
    return this.#e.executeQuery(boughtTransactionsStoreName, (objectStore) => objectStore.count());
  }
  ["getSellCount"]() {
    return this.#e.executeQuery(soldTransactionsStoreName, (objectStore) => objectStore.count());
  }
  ["getBuyCountByDateRange"](startDate, endDate) {
    const timestampRange = IDBKeyRange.bound(
      toUtcDateTimeNumber(startDate),
      toUtcDateTimeNumber(endDate),
    );
    return this.#e.executeQuery(boughtTransactionsStoreName, (objectStore) =>
      objectStore.index("timestamp").count(timestampRange),
    );
  }
  ["getBuyByDateRange"](startDate, endDate) {
    const timestampRange = IDBKeyRange.bound(
      toUtcDateTimeNumber(startDate),
      toUtcDateTimeNumber(endDate),
    );
    return this.#e.executeQuery(boughtTransactionsStoreName, (objectStore) =>
      objectStore.index("timestamp").getAll(timestampRange),
    );
  }
  ["getSellCountByDateRange"](startDate, endDate) {
    const timestampRange = IDBKeyRange.bound(
      toUtcDateTimeNumber(startDate),
      toUtcDateTimeNumber(endDate),
    );
    return this.#e.executeQuery(soldTransactionsStoreName, (objectStore) =>
      objectStore.index("timestamp").count(timestampRange),
    );
  }
  ["getSellByDateRange"](startDate, endDate) {
    const timestampRange = IDBKeyRange.bound(
      toUtcDateTimeNumber(startDate),
      toUtcDateTimeNumber(endDate),
    );
    return this.#e.executeQuery(soldTransactionsStoreName, (objectStore) =>
      objectStore.index("timestamp").getAll(timestampRange),
    );
  }
  ["getAllBuy"]() {
    return this.#e.executeQuery(boughtTransactionsStoreName, (objectStore) => objectStore.getAll());
  }
  ["getAllSell"]() {
    return this.#e.executeQuery(soldTransactionsStoreName, (objectStore) => objectStore.getAll());
  }
  ["getBuyByItemId"](itemId) {
    return this.#e.executeQuery(boughtTransactionsStoreName, (objectStore) =>
      objectStore.get(itemId),
    );
  }
  ["getSellByItemId"](itemId) {
    return this.#e.executeQuery(soldTransactionsStoreName, (objectStore) =>
      objectStore.get(itemId),
    );
  }
  ["clearBuy"]() {
    return this.#e.clearStore(boughtTransactionsStoreName);
  }
  ["clearSell"]() {
    return this.#e.clearStore(soldTransactionsStoreName);
  }
  async ["insertMultipleBuy"](boughtItems) {
    for (let item of boughtItems) {
      this.insertBuy(item);
    }
  }
  ["insertBuy"](item, price) {
    if (this.#e) {
      if (!(price < 200)) {
        this.#o(boughtTransactionsStoreName, item, price, (itemId) => this.getBuyByItemId(itemId));
      }
    }
  }
  async ["insertMultipleSell"](soldItems) {
    for (let item of soldItems) {
      this.insertSell(item);
    }
  }
  async ["insertSell"](item, price) {
    if (this.#e) {
      if (!(price < 200)) {
        this.#o(soldTransactionsStoreName, item, price, (itemId) => this.getSellByItemId(itemId));
      }
    }
  }
}
