/**
 * `TrackedPlayersStore` (`paletoolsDatabase.trackedPlayers`): EA `owners` count per player
 * definitionId. Written by `trackPlayerItems` in src/club/player-tracking.js and by the album
 * view controller (owners 1); read as a Map by src/plugins/album/album-data.js.
 *
 * Invariants:
 * - Object store `trackedPlayers`, keyPath `definitionId`, created when oldVersion < 10.
 * - `add()` and `delete()` ignore ids that are not positive safe integers; `add()` never
 *   overwrites a record whose `owners` is 1 and resolves only after the readwrite transaction
 *   completes (rejects on abort/error).
 * - `all()` resolves `Map(definitionId -> owners)`; every method awaits `initPromise` first.
 */
const trackedPlayersStoreName = "trackedPlayers";

export class TrackedPlayersStore {
  constructor(database) {
    this.db = database;
  }
  get ["name"]() {
    return trackedPlayersStoreName;
  }
  ["build"](oldVersion) {
    if (oldVersion < 10) {
      this.db.createStore(trackedPlayersStoreName, {
        keyPath: "definitionId",
      });
    }
  }
  async ["all"]() {
    await this.db.initPromise;
    const records = await this.db.executeQuery(trackedPlayersStoreName, (objectStore) =>
      objectStore.getAll(),
    );
    var ownersByDefinitionId = new Map();
    for (let record of records) {
      ownersByDefinitionId.set(record.definitionId, record.owners);
    }
    return ownersByDefinitionId;
  }
  async ["delete"](definitionId) {
    if (!(!Number.isSafeInteger(definitionId) || definitionId <= 0)) {
      await this.db.initPromise;
      await this.db.executeNonQuery(trackedPlayersStoreName, (objectStore) =>
        objectStore.delete(definitionId),
      );
    }
  }
  async ["add"](definitionId, owners) {
    if (!Number.isSafeInteger(definitionId) || definitionId <= 0) {
      return;
    }
    let transactionCompletion;
    await this.db.initPromise;
    await this.db.executeNonQuery(trackedPlayersStoreName, (objectStore) => {
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
      const existingRecordRequest = objectStore.get(definitionId);
      existingRecordRequest.addEventListener("success", () => {
        if (existingRecordRequest.result?.owners !== 1) {
          objectStore.put({
            definitionId: definitionId,
            owners: owners,
          });
        }
      });
      return existingRecordRequest;
    });
    await transactionCompletion;
  }
}
