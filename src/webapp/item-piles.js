/**
 * Promise wrappers around EA item-pile requests (transfer list, watch list, unassigned items,
 * SBC storage) and around moving items between piles. Used by src/db/transactions-store.js, the
 * player-tracking initial sync in src/bootstrap/boot.js, the SBC solvers and many plugins.
 *
 * Invariants:
 * - Moves and discards go through `services.Item.move`/`discard`, so src/webapp/patches.js
 *   dispatches ITEM_MOVED/ITEM_DISCARDED for them; storage searches go through the patched
 *   `services.Item.searchStorageItems` (count forced, client-side sort).
 * - After moving, only `moveUnassignedItemsToClub` (PURCHASED, INBOX, CLUB, plus STORAGE with
 *   `storeDuplicates`; with it, no marks of its own when nothing is unassigned) and
 *   `moveMatchingStorageItemsToClub` (all four, only when a storage item matches) mark piles
 *   dirty in `repositories.Item`; `moveItemsToClub`, `moveItemsToTransferList`,
 *   `moveItemsToSbcStorage` and `discardItems` mark nothing. `fetchUnassignedItems` marks PURCHASED dirty first and sends the
 *   "Unassigned Items - List View" PIN page view.
 * - `moveItemsToSbcStorage` sends at most `sbcStorageCapacity` (100) minus the current storage
 *   count; when it truncates it sets `success = false` and `storedItemsCount` on the move
 *   response, which `moveUnassignedItemsToClub` uses to know which duplicates were stored.
 * - `moveUnassignedItemsToClub(definitionIds, storeDuplicates)`: without `storeDuplicates` it
 *   moves non-duplicate players, and a non-empty `definitionIds` REPLACES that test (any item with
 *   a listed id is moved); with `storeDuplicates` duplicate players go to SBC storage first and
 *   every other unassigned item (filtered by `definitionIds` when given) is moved to the club.
 * - `moveMatchingStorageItemsToClub` reads `definitionId`/`isStorage` directly, so it expects
 *   items, not squad slots.
 * - `searchSbcStorageItems` can tag storage items with the club copy's id (`duplicateId`) and
 *   collapse them by definitionId with a `count`.
 * - The transfer/watch list fetchers reject with `response.error`; `fetchUnassignedItems` does
 *   not check `response.success`.
 */
import { findOwnedClubPlayers } from "../club/club-players-cache.js";
import { groupBy, uniqueBy } from "../core/collections.js";
import { observableToPromise } from "./observable.js";
import { trackPageView } from "./telemetry.js";

export function fetchTransferListItems() {
  return new Promise((resolve, reject) => {
    services.Item.requestTransferItems().observe(this, (sender, response) => {
      if (response.success) {
        resolve(response.response.items);
      } else {
        reject(response.error);
      }
    });
  });
}

export function fetchUnlistedTransferListItems() {
  return new Promise((resolve, reject) => {
    services.Item.requestTransferItems().observe(this, (sender, response) => {
      if (response.success) {
        var unlistedItems = (
          JSUtils.isObject(response.response) ? response.response.items : []
        ).filter(function (item) {
          return !item.getAuctionData().isValid();
        });
        resolve(unlistedItems);
      } else {
        reject(response.error);
      }
    });
  });
}

export function fetchWatchlistItems() {
  return new Promise((resolve, reject) => {
    services.Item.requestWatchedItems().observe(this, (sender, response) => {
      if (response.success) {
        resolve(response.response.items);
      } else {
        reject(response.error);
      }
    });
  });
}

const sbcStorageCapacity = 100;

export function isSbcStorageItem(item) {
  return item.isStorage || item.utasPile === ItemPile.STORAGE || item.pile === ItemPile.STORAGE;
}

export function fetchUnassignedItems() {
  repositories.Item.setDirty(ItemPile.PURCHASED);
  trackPageView("Unassigned Items - List View");
  return new Promise((resolve) => {
    services.Item.requestUnassignedItems().observe(this, (sender, response) => {
      resolve(response.response.items);
    });
  });
}

export async function moveUnassignedItemsToClub(definitionIds = [], storeDuplicates = false) {
  if (!storeDuplicates) {
    return void (await (async function (definitionIdFilter) {
      definitionIdFilter = definitionIdFilter || [];
      const playersToMove = (await fetchUnassignedItems()).filter((item) => {
        let shouldMove = item.isPlayer() && !item.isDuplicate();
        if (definitionIdFilter.length > 0) {
          shouldMove = definitionIdFilter.indexOf(item.definitionId) > -1;
        }
        return shouldMove;
      });
      await moveItemsToClub(playersToMove);
      repositories.Item.setDirty(ItemPile.PURCHASED);
      repositories.Item.setDirty(ItemPile.INBOX);
      repositories.Item.setDirty(ItemPile.CLUB);
    })(definitionIds));
  }
  definitionIds = definitionIds || [];
  const unassignedItems = await fetchUnassignedItems();
  if (!unassignedItems.length) {
    return;
  }
  const duplicatePlayers = unassignedItems.filter((item) => item.isPlayer() && item.isDuplicate());
  let storedCount = 0;
  if (duplicatePlayers.length && storeDuplicates) {
    const storeResult = await moveItemsToSbcStorage(duplicatePlayers);
    storedCount = storeResult.success ? duplicatePlayers.length : storeResult.storedItemsCount || 0;
  }
  const storedItems = new Set(duplicatePlayers.slice(0, storedCount));
  const itemsToMove = unassignedItems.filter(
    (item) =>
      !storedItems.has(item) &&
      (!definitionIds.length || definitionIds.includes(item.definitionId)),
  );
  if (itemsToMove.length) {
    await moveItemsToClub(itemsToMove);
  }
  repositories.Item.setDirty(ItemPile.STORAGE);
  repositories.Item.setDirty(ItemPile.PURCHASED);
  repositories.Item.setDirty(ItemPile.INBOX);
  repositories.Item.setDirty(ItemPile.CLUB);
}

export function moveItemsToClub(itemsToMove) {
  return observableToPromise(services.Item.move(itemsToMove, ItemPile.CLUB));
}

export function moveItemsToTransferList(itemsToMove) {
  return observableToPromise(services.Item.move(itemsToMove, ItemPile.TRANSFER));
}

export function discardItems(itemsToDiscard) {
  return observableToPromise(services.Item.discard(itemsToDiscard));
}

export async function moveItemsToSbcStorage(itemsToStore) {
  let currentStorageCount = (
    await observableToPromise(services.Item.searchStorageItems(new UTSearchCriteriaDTO()))
  ).response.items.length;
  let requestedCount = itemsToStore.length;
  itemsToStore = itemsToStore.slice(0, sbcStorageCapacity - currentStorageCount);
  const moveResult = await observableToPromise(services.Item.move(itemsToStore, ItemPile.STORAGE));
  if (itemsToStore.length < requestedCount) {
    moveResult.success = false;
    moveResult.storedItemsCount = itemsToStore.length;
  }
  return moveResult;
}

export async function moveMatchingStorageItemsToClub(sourceItems) {
  const definitionIds = (sourceItems = sourceItems || [])
    .filter((item) => !isSbcStorageItem(item))
    .map((item) => item.definitionId);
  const matchingStorageItems = (await fetchSbcStorageItems()).filter((storageItem) => {
    let isMatch = false;
    if (definitionIds.length > 0) {
      isMatch = definitionIds.indexOf(storageItem.definitionId) > -1;
    }
    return isMatch;
  });
  if (matchingStorageItems.length > 0) {
    await moveItemsToClub(matchingStorageItems);
    repositories.Item.setDirty(ItemPile.STORAGE);
    repositories.Item.setDirty(ItemPile.PURCHASED);
    repositories.Item.setDirty(ItemPile.INBOX);
    repositories.Item.setDirty(ItemPile.CLUB);
  }
}

export async function fetchSbcStorageItems(searchCriteria, markClubDuplicates = false) {
  const searchResult = await searchSbcStorageItems(searchCriteria, markClubDuplicates);
  return searchResult.success ? searchResult.response.items : [];
}

export async function searchSbcStorageItems(
  searchCriteria,
  markClubDuplicates = false,
  collapseByDefinitionId = false,
) {
  const searchResult = await observableToPromise(
    services.Item.searchStorageItems(searchCriteria || new UTSearchCriteriaDTO()),
  );
  if (markClubDuplicates) {
    const clubPlayers = await findOwnedClubPlayers(searchResult.response.items, 0, false, true);
    for (let clubPlayer of clubPlayers) {
      for (let storageItem of searchResult.response.items.filter(
        (candidate) => candidate.definitionId === clubPlayer.definitionId,
      )) {
        storageItem.duplicateId = clubPlayer.id;
      }
    }
  }
  if (collapseByDefinitionId) {
    let storageItems = searchResult.response.items;
    const itemsByDefinitionId = groupBy(storageItems, (item) => item.definitionId);
    storageItems = uniqueBy(storageItems, (item) => item.definitionId);
    for (let storageItem of storageItems) {
      const sameDefinitionItems = itemsByDefinitionId[storageItem.definitionId];
      if (sameDefinitionItems.length > 1) {
        storageItem.count = sameDefinitionItems.length;
      }
    }
    searchResult.response.items = storageItems;
  }
  return searchResult;
}
