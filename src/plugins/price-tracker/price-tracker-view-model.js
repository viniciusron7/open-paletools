/**
 * `PriceTrackerViewModel`, owned by `PriceTrackerViewController`
 * (src/plugins/price-tracker/index.js): tracked-player list, revision search and serialized
 * external price updates.
 *
 * Invariants:
 * - Tracked players live in the IndexedDB store `paletoolsDatabase.priceTracker` (keyPath
 *   `definitionId`) as `{definitionId, name, rating, rarity, holographic}` (the store's `put`
 *   drops other fields); statuses and prices are only kept in memory.
 * - `load()` memoizes `loadPlayers()` (cleared on failure), which migrates the legacy
 *   `configuration.plugins.priceTracker.players` array into the store once, then deletes it and
 *   calls `persistConfiguration()`.
 * - `getRevisions` searches concept items by `defId` (`searchConceptItemsPaged`), de-duplicates
 *   by `definitionId` and sorts by rating desc, then id asc.
 * - `updatePrices` chains on `this.queue`, so price requests never overlap; results are applied
 *   only while `active`, with an unchanged `generation` and all three enable flags on.
 *   `refresh()` sets `active` and bumps `generation`; `stop()` clears `active` and bumps it.
 * - `requestExternalPrices` gets stub items `{definitionId, isPlayer: () => true}`; a price > 0
 *   means `ready`, otherwise `unavailable`; a failed request means `error`.
 * - `pendingAdds` blocks concurrent adds of the same `definitionId`.
 */
import { searchConceptItemsPaged } from "../../club/concept-items.js";
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { paletoolsDatabase } from "../../db/database.js";
import { requestExternalPrices } from "../../market/external-prices/index.js";

export class PriceTrackerViewModel {
  constructor() {
    this.players = [];
    this.pendingAdds = new Set();
    this.loadPromise = null;
    this.queue = Promise.resolve();
    this.generation = 0;
    this.active = false;
    this.onChange = () => {};
  }
  async ["getRevisions"](playerId) {
    const searchCriteria = new UTSearchCriteriaDTO();
    searchCriteria.type = SearchType.PLAYER;
    searchCriteria.defId = playerId.toString();
    searchCriteria.offset = 0;
    const foundItems = await searchConceptItemsPaged(searchCriteria, Number.MAX_SAFE_INTEGER);
    return [...new Map(foundItems.map((item) => [item.definitionId, item])).values()].sort(
      (left, right) => right.rating - left.rating || left.definitionId - right.definitionId,
    );
  }
  ["load"]() {
    if (!this.loadPromise) {
      this.loadPromise = this.loadPlayers().catch((error) => {
        this.loadPromise = null;
        throw error;
      });
    }
    return this.loadPromise;
  }
  async ["loadPlayers"]() {
    const storedPlayers = await paletoolsDatabase.priceTracker.all();
    const storedDefinitionIds = new Set(storedPlayers.map((player) => player.definitionId));
    const legacyPlayers = configuration.plugins.priceTracker.players;
    if (Array.isArray(legacyPlayers)) {
      for (const legacyPlayer of legacyPlayers) {
        if (!storedDefinitionIds.has(legacyPlayer.definitionId)) {
          await paletoolsDatabase.priceTracker.put(legacyPlayer);
          storedPlayers.push(legacyPlayer);
          storedDefinitionIds.add(legacyPlayer.definitionId);
        }
      }
      delete configuration.plugins.priceTracker.players;
      persistConfiguration();
    }
    this.players = storedPlayers.map((player) => ({
      ...player,
      status: "pending",
    }));
    this.onChange();
  }
  async ["addPlayer"](revision) {
    await this.load();
    if (
      this.pendingAdds.has(revision.definitionId) ||
      this.players.some((player) => player.definitionId === revision.definitionId)
    ) {
      return;
    }
    this.pendingAdds.add(revision.definitionId);
    const staticData = revision.getStaticData();
    const trackedPlayer = {
      definitionId: revision.definitionId,
      name:
        staticData.name ||
        staticData.commonName ||
        ((staticData.firstName || "") + " " + (staticData.lastName || "")).trim(),
      rating: revision.rating,
      rarity: revision.rareflag,
      holographic: Boolean(revision.hasHyperCosmetics?.()),
      status: "pending",
    };
    try {
      await paletoolsDatabase.priceTracker.put(trackedPlayer);
      this.players.push(trackedPlayer);
      this.onChange();
      this.updatePrices([trackedPlayer]);
    } finally {
      this.pendingAdds.delete(revision.definitionId);
    }
  }
  async ["removePlayer"](definitionId) {
    await this.load();
    await paletoolsDatabase.priceTracker.delete(definitionId);
    this.players = this.players.filter((player) => player.definitionId !== definitionId);
    this.onChange();
  }
  async ["refresh"]() {
    this.active = true;
    const generation = ++this.generation;
    await this.load();
    if (this.active && generation === this.generation) {
      this.players.forEach((player) => {
        player.status = "pending";
      });
      this.onChange();
      return this.updatePrices([...this.players]);
    }
  }
  ["stop"]() {
    this.active = false;
    this.generation++;
  }
  ["updatePrices"](players) {
    const generation = this.generation;
    const isStillCurrent = () =>
      this.active &&
      generation === this.generation &&
      configuration.enabled &&
      configuration.plugins.priceTracker.enabled &&
      configuration.plugins.externalMarketPrices.enabled;
    this.queue = this.queue.then(async () => {
      if (!isStillCurrent()) {
        return;
      }
      const pendingPlayers = players.filter((player) => this.players.includes(player));
      if (pendingPlayers.length) {
        try {
          const prices = await requestExternalPrices(
            pendingPlayers.map((player) => ({
              definitionId: player.definitionId,
              isPlayer: () => true,
            })),
          );
          if (!isStillCurrent()) {
            return;
          }
          for (const player of pendingPlayers) {
            if (!this.players.includes(player)) {
              continue;
            }
            const price = prices[player.definitionId]?.price;
            player.price = price;
            player.status = price > 0 ? "ready" : "unavailable";
          }
        } catch {
          if (!isStillCurrent()) {
            return;
          }
          for (const player of pendingPlayers) {
            if (this.players.includes(player)) {
              player.status = "error";
            }
          }
        }
        this.onChange();
      }
    });
    return this.queue;
  }
}
