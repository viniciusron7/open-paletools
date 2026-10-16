/**
 * Singleton `paletoolsDatabase` wrapping the IndexedDB database `paletools` (version 11). It owns
 * the store objects `transactions`, `sbcTemplates`, `globalSbcTemplates`, `trackedPlayers` and
 * `priceTracker` (`unassigned` is never set) and offers query helpers to them. `init()` is awaited
 * by `bootWhenWebAppReady` in src/bootstrap/boot.js only when `isSupported()` (the page window
 * has `indexedDB`); `exportDb`/`importDb` serve the settings backup view.
 *
 * Hooks:
 * - At module evaluation, adds `IDBRequest.prototype.toPromise()` (resolves with the success
 *   Event, rejects with the error Event); `clearStore` depends on it.
 *
 * Invariants:
 * - The database name, version and object store names are persisted data. `upgradeneeded` calls
 *   `build(event.oldVersion)` on each store in `stores` order (priceTracker, transactions,
 *   sbcTemplates, globalSbcTemplates, trackedPlayers); each store creates its object store below
 *   a version threshold, so a new store or index needs a version bump and a matching threshold.
 *   `createStore`/`deleteStore` only work inside that upgrade transaction, so `build` must call
 *   them before its first `await`.
 * - The store objects are created by `init()` before the open request and are null before it.
 * - `executeQuery` (readonly) / `executeNonQuery` (readwrite) resolve with `request.result` and
 *   reject with the error Event, but resolve `undefined` at once while the database is not open
 *   (the query still runs later on `initPromise`); the priceTracker and trackedPlayers stores
 *   await `initPromise` first. `clearStore` does not wait for `initPromise`.
 * - The connection closes itself on `versionchange` (another tab upgrading) and is not reopened.
 *   `onblocked` only logs, so `init()`, awaited by boot, stays pending while blocked; an open
 *   error rejects without a reason.
 * - `exportDb()` returns `{storeName: [{key, value}]}` for every object store; `importDb()` clears
 *   EVERY store (also those missing from the backup) and puts the records, passing `key` only for
 *   stores without a keyPath. Both await `initPromise` (they reject if the open failed) and
 *   return `{}` / nothing when `init()` never ran.
 */
import { debugLog } from "../core/logger.js";
import { getPageWindow } from "../core/page-window.js";
import { GlobalSbcTemplatesStore } from "./global-sbc-templates-store.js";
import { PriceTrackerStore } from "./price-tracker-store.js";
import { SbcTemplatesStore } from "./sbc-templates-store.js";
import { TrackedPlayersStore } from "./tracked-players-store.js";
import { TransactionsStore } from "./transactions-store.js";

IDBRequest.prototype.toPromise = function () {
  const request = this;
  return new Promise((resolve, reject) => {
    request.addEventListener("success", (event) => {
      resolve(event);
    });
    request.addEventListener("error", (event) => {
      reject(event);
    });
  });
};

export const paletoolsDatabase = new (class {
  #e;
  constructor() {
    this.#e = null;
    this.initPromise = null;
    this.transactions = null;
    this.unassigned = null;
    this.sbcTemplates = null;
    this.globalSbcTemplates = null;
    this.trackedPlayers = null;
    this.priceTracker = null;
  }
  async ["exportDb"]() {
    await this.initPromise;
    if (!this.#e) {
      return {};
    }
    const exportedStores = {};
    const storeNames = Array.from(this.#e.objectStoreNames);
    await Promise.all(
      storeNames.map(async (storeName) => {
        exportedStores[storeName] = await this.#l(storeName);
      }),
    );
    return exportedStores;
  }
  #l(storeName) {
    return new Promise((resolve, reject) => {
      const transaction = this.#e.transaction(storeName, "readonly");
      const records = [];
      const cursorRequest = transaction.objectStore(storeName).openCursor();
      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          records.push({
            key: cursor.primaryKey,
            value: cursor.value,
          });
          cursor.continue();
        }
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
      transaction.oncomplete = () => resolve(records);
      transaction.onerror = () => reject(transaction.error || "Failed to export database store");
      transaction.onabort = () => reject(transaction.error || "Database export aborted");
    });
  }
  async ["importDb"](exportedData) {
    await this.initPromise;
    if (!this.#e) {
      return;
    }
    const exportedStores = exportedData && typeof exportedData === "object" ? exportedData : {};
    const storeNames = Array.from(this.#e.objectStoreNames);
    for (const storeName of storeNames) {
      const storeRecords = Array.isArray(exportedStores[storeName])
        ? exportedStores[storeName]
        : [];
      await this.#c(storeName, storeRecords);
    }
  }
  #c(storeName, records) {
    return new Promise((resolve, reject) => {
      const transaction = this.#e.transaction(storeName, "readwrite");
      const objectStore = transaction.objectStore(storeName);
      const clearRequest = objectStore.clear();
      clearRequest.onerror = () => reject(clearRequest.error);
      clearRequest.onsuccess = () => {
        for (const record of records) {
          if (record && "value" in record) {
            if (objectStore.keyPath === null) {
              objectStore.put(record.value, record.key);
            } else {
              objectStore.put(record.value);
            }
          }
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || "Failed to import database store");
      transaction.onabort = () => reject(transaction.error || "Database import aborted");
    });
  }
  ["executeQuery"](storeName, query) {
    return new Promise((resolve, reject) => {
      if (!this.#e) {
        resolve();
      }
      this.initPromise.then(() => {
        const request = query(this.#e.transaction(storeName).objectStore(storeName));
        request.addEventListener("success", (event) => {
          resolve(event.target.result);
        });
        request.addEventListener("error", (event) => {
          reject(event);
        });
      });
    });
  }
  ["createStore"](storeName, storeOptions) {
    return this.#e.createObjectStore(storeName, storeOptions);
  }
  ["deleteStore"](storeName) {
    return this.#e.deleteObjectStore(storeName);
  }
  ["clearStore"](storeName) {
    return this.#e.transaction(storeName, "readwrite").objectStore(storeName).clear().toPromise();
  }
  ["executeNonQuery"](storeName, command) {
    return new Promise((resolve, reject) => {
      if (!this.#e) {
        resolve();
      }
      this.initPromise.then(() => {
        const request = command(this.#e.transaction(storeName, "readwrite").objectStore(storeName));
        request.addEventListener("success", (event) => {
          resolve(event.target.result);
        });
        request.addEventListener("error", (event) => {
          reject(event);
        });
      });
    });
  }
  ["addRecord"](storeName, record, recordKey) {
    return this.executeNonQuery(storeName, (objectStore) =>
      recordKey ? objectStore.add(record, recordKey) : objectStore.add(record),
    );
  }
  ["isSupported"]() {
    return getPageWindow().indexedDB;
  }
  ["init"]() {
    this.transactions = new TransactionsStore(this);
    this.sbcTemplates = new SbcTemplatesStore(this);
    this.globalSbcTemplates = new GlobalSbcTemplatesStore(this);
    this.trackedPlayers = new TrackedPlayersStore(this);
    this.priceTracker = new PriceTrackerStore(this);
    this.stores = [
      this.priceTracker,
      this.transactions,
      this.sbcTemplates,
      this.globalSbcTemplates,
      this.trackedPlayers,
    ];
    this.initPromise = new Promise((resolve, reject) => {
      const openRequest = indexedDB.open("paletools", 11);
      openRequest.onblocked = function (blockedEvent) {
        debugLog("DB request blocked");
      };
      openRequest.addEventListener("upgradeneeded", async (event) => {
        this.#e = event.target.result;
        debugLog("Event: " + JSON.stringify(event));
        debugLog("Updgrading from v" + event.oldVersion + " to v" + event.newVersion);
        for (let store of this.stores) {
          store.build(event.oldVersion);
        }
      });
      openRequest.addEventListener("error", (event) => {
        debugLog("Error opening database: " + JSON.stringify(event));
        reject();
      });
      openRequest.addEventListener("success", (event) => {
        this.#e = event.target.result;
        const database = openRequest.result;
        database.onversionchange = function (versionChangeEvent) {
          debugLog("Version chagned");
          database.close();
        };
        resolve();
      });
    });
    return this.initPromise;
  }
})();
