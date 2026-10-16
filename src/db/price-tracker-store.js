/**
 * `PriceTrackerStore` (`paletoolsDatabase.priceTracker`): items followed by the price-tracker
 * plugin (src/plugins/price-tracker/price-tracker-view-model.js).
 *
 * Invariants:
 * - Object store `priceTracker`, keyPath `definitionId`, created when oldVersion < 11 (the
 *   current version).
 * - Records are exactly `{definitionId, name, rarity, holographic (Boolean), rating}`; `put()`
 *   throws "Invalid definition ID" unless definitionId is a positive safe integer.
 * - `put`/`delete` go through `write()`, which awaits `initPromise` and resolves only after the
 *   readwrite transaction completes (rejects on abort/error); `all()` resolves `[]` when the query
 *   returns nothing.
 */
const priceTrackerStoreName = "priceTracker";

export class PriceTrackerStore {
  constructor(database) {
    this.db = database;
  }
  get ["name"]() {
    return priceTrackerStoreName;
  }
  ["build"](oldVersion) {
    if (oldVersion < 11) {
      this.db.createStore(priceTrackerStoreName, {
        keyPath: "definitionId",
      });
    }
  }
  async ["all"]() {
    await this.db.initPromise;
    return (
      (await this.db.executeQuery(priceTrackerStoreName, (objectStore) => objectStore.getAll())) ||
      []
    );
  }
  async ["put"]({
    definitionId: definitionId,
    name: itemName,
    rarity: rarity,
    holographic: isHolographic,
    rating: rating,
  }) {
    if (!Number.isSafeInteger(definitionId) || definitionId <= 0) {
      throw new Error("Invalid definition ID");
    }
    await this.write((objectStore) =>
      objectStore.put({
        definitionId: definitionId,
        name: itemName,
        rarity: rarity,
        holographic: Boolean(isHolographic),
        rating: rating,
      }),
    );
  }
  async ["delete"](definitionId) {
    await this.write((objectStore) => objectStore.delete(definitionId));
  }
  async ["write"](applyWrite) {
    let transactionCompletion;
    await this.db.initPromise;
    await this.db.executeNonQuery(priceTrackerStoreName, (objectStore) => {
      transactionCompletion = new Promise((resolve, reject) => {
        objectStore.transaction.addEventListener("complete", resolve);
        objectStore.transaction.addEventListener("abort", () =>
          reject(objectStore.transaction.error || new Error("Storage transaction aborted")),
        );
        objectStore.transaction.addEventListener("error", () =>
          reject(objectStore.transaction.error || new Error("Storage transaction failed")),
        );
      });
      transactionCompletion.catch(() => {});
      return applyWrite(objectStore);
    });
    await transactionCompletion;
  }
}
