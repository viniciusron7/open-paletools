/**
 * Pack-opening engine of the packs opener, imported by src/plugins/packs-opener/index.js:
 * `packsOpenerOpenPack` buys (store pack) or opens (my pack) one pack, then routes the unassigned
 * items by category; `PacksOpenerState` accumulates statistics and item lists for the results.
 *
 * Invariants:
 * - Pre-checks: any item in `ItemPile.PURCHASED` returns `UNASSIGNED_ITEMS`; a store pack priced
 *   above `services.User.getUser()[currency.toLowerCase()].amount` returns `NOT_ENOUGH_CREDITS`.
 *   Spent coins/points are counted before the purchase request.
 * - Processing order is fixed: players, managers, other items, duplicate players, duplicate
 *   managers, duplicate items, then misc items (redeemed, `amount` added to `coinsEarned`); the
 *   first non-success step ends the pack. A step without an action gets the transfer-list-full
 *   action; successful steps wait 314-681 ms x speed; `requestUserCurrencies()` follows each pack.
 * - A full transfer list either stops (items left unassigned) or quick-sells, per
 *   `transferListFullAction`. Only the duplicate-players step has a `moveToSbcStorage` updater,
 *   so `SBC_STORAGE` must stay limited to that category.
 * - `PacksOpenerState.addItems(destination, items)` appends to `<destination>Items`; destinations
 *   are club, storage, transferList, unassigned, discarded (read by ./results-view.js).
 * - `packsOpenerItemActions` values are persisted in settings and used as <select> values.
 *
 * Known issues (kept as-is):
 * - `packsOpenerRedeemMiscItems` does not await `services.Item.redeem`, and its catch block
 *   (`packsOpenerProcessStatus.ERROR;`) is a no-op, so it always reports success.
 * - A `SBC_STORAGE_FULL` step result is mapped to `packsOpenerOpenStatus.ERROR` (switch default).
 * - If the SBC-storage move fails without `storedItemsCount`, `playersToSbcStorage` becomes NaN.
 */
import { waitForDelay } from "../../core/async.js";
import { requestUserCurrencies } from "../../webapp/currencies.js";
import {
  discardItems,
  fetchUnassignedItems,
  moveItemsToClub,
  moveItemsToSbcStorage,
} from "../../webapp/item-piles.js";
import { observableToPromise } from "../../webapp/observable.js";

export class PacksOpenerState {
  constructor(
    coinsSpent = 0,
    coinsEarned = 0,
    pointsSpent = 0,
    packsOpened = 0,
    players = 0,
    playersToClub = 0,
    playersToTransferList = 0,
    playersToSbcStorage = 0,
    playersDiscarded = 0,
    duplicatedPlayers = 0,
    managers = 0,
    duplicatedManagers = 0,
    managersToClub = 0,
    managersToTransferList = 0,
    managersDiscarded = 0,
    items = 0,
    duplicatedItems = 0,
    itemsToClub = 0,
    itemsToTransferList = 0,
    itemsDiscarded = 0,
  ) {
    this.coinsSpent = coinsSpent;
    this.coinsEarned = coinsEarned;
    this.pointsSpent = pointsSpent;
    this.packsOpened = packsOpened;
    this.playersToClub = playersToClub;
    this.players = players;
    this.playersToTransferList = playersToTransferList;
    this.playersToSbcStorage = playersToSbcStorage;
    this.playersDiscarded = playersDiscarded;
    this.duplicatedPlayers = duplicatedPlayers;
    this.managers = managers;
    this.duplicatedManagers = duplicatedManagers;
    this.managersToClub = managersToClub;
    this.managersToTransferList = managersToTransferList;
    this.managersDiscarded = managersDiscarded;
    this.items = items;
    this.duplicatedItems = duplicatedItems;
    this.itemsToClub = itemsToClub;
    this.itemsToTransferList = itemsToTransferList;
    this.itemsDiscarded = itemsDiscarded;
    this.clubItems = [];
    this.storageItems = [];
    this.transferListItems = [];
    this.unassignedItems = [];
    this.discardedItems = [];
  }
  ["addItems"](destination, items) {
    this[destination + "Items"].push(...items);
  }
}

export const packsOpenerItemActions = {
  MOVE_TO_CLUB: "club",
  MOVE_TO_TRANSFER_LIST: "transferList",
  QUICK_SELL: "quickSell",
  STOP_PROCESS: "stopProcess",
  SBC_STORAGE: "sbcStorage",
};

export const packsOpenerOpenStatus = {
  SUCCESS: "success",
  UNASSIGNED_ITEMS: "unassignedItems",
  NOT_ENOUGH_CREDITS: "notEnoughCredits",
  TRANSFER_LIST_FULL: "transferListFull",
  SBC_STORAGE_FULL: "sbcStorageFull",
  ERROR: "error",
};

const packsOpenerProcessStatus = {
  SUCCESS: "success",
  TRANSFER_LIST_FULL: "transferListFull",
  SBC_STORAGE_FULL: "sbcStorageFull",
  ERROR: "error",
};

function packsOpenerProcessPlayers(packItems, action, transferListFullAction, state) {
  const players = packItems.filter((item) => !item.isDuplicate() && item.isPlayer());
  state.players += players.length;
  return packsOpenerApplyItemAction(
    players,
    action,
    transferListFullAction,
    {
      discard: (discardedCount, earnedCoins) => {
        state.playersDiscarded += discardedCount;
        state.coinsEarned += earnedCoins;
      },
      moveToTransferList: (movedCount) => (state.playersToTransferList += movedCount),
      moveToClub: (movedCount) => (state.playersToClub += movedCount),
    },
    state,
  );
}

function packsOpenerProcessManagers(packItems, action, transferListFullAction, state) {
  const managers = packItems.filter((item) => !item.isDuplicate() && item.isManager());
  state.managers += managers.length;
  return packsOpenerApplyItemAction(
    managers,
    action,
    transferListFullAction,
    {
      discard: (discardedCount, earnedCoins) => {
        state.managersDiscarded += discardedCount;
        state.coinsEarned += earnedCoins;
      },
      moveToTransferList: (movedCount) => (state.managersToTransferList += movedCount),
      moveToClub: (movedCount) => (state.managersToClub += movedCount),
    },
    state,
  );
}

function packsOpenerProcessOtherItems(packItems, action, transferListFullAction, state) {
  const otherItems = packItems.filter(
    (item) => !(item.isDuplicate() || item.isPlayer() || item.isManager() || item.isMiscItem()),
  );
  state.items += otherItems.length;
  return packsOpenerApplyItemAction(
    otherItems,
    action,
    transferListFullAction,
    {
      discard: (discardedCount, earnedCoins) => {
        state.itemsDiscarded += discardedCount;
        state.coinsEarned += earnedCoins;
      },
      moveToTransferList: (movedCount) => (state.itemsToTransferList += movedCount),
      moveToClub: (movedCount) => (state.itemsToClub += movedCount),
    },
    state,
  );
}

function packsOpenerProcessDuplicatePlayers(packItems, action, transferListFullAction, state) {
  const duplicatePlayers = packItems.filter((item) => item.isDuplicate() && item.isPlayer());
  state.players += duplicatePlayers.length;
  state.duplicatedPlayers += duplicatePlayers.length;
  return packsOpenerApplyItemAction(
    duplicatePlayers,
    action,
    transferListFullAction,
    {
      discard: (discardedCount, earnedCoins) => {
        state.playersDiscarded += discardedCount;
        state.coinsEarned += earnedCoins;
      },
      moveToTransferList: (movedCount) => (state.playersToTransferList += movedCount),
      moveToClub: (movedCount) => (state.playersToClub += movedCount),
      moveToSbcStorage: (movedCount) => (state.playersToSbcStorage += movedCount),
    },
    state,
  );
}

function packsOpenerProcessDuplicateManagers(packItems, action, transferListFullAction, state) {
  const duplicateManagers = packItems.filter((item) => item.isDuplicate() && item.isManager());
  state.managers += duplicateManagers.length;
  state.duplicatedManagers += duplicateManagers.length;
  return packsOpenerApplyItemAction(
    duplicateManagers,
    action,
    transferListFullAction,
    {
      discard: (discardedCount, earnedCoins) => {
        state.managersDiscarded += discardedCount;
        state.coinsEarned += earnedCoins;
      },
      moveToTransferList: (movedCount) => (state.managersToTransferList += movedCount),
      moveToClub: (movedCount) => (state.managersToClub += movedCount),
    },
    state,
  );
}

function packsOpenerProcessDuplicateOtherItems(packItems, action, transferListFullAction, state) {
  const duplicateOtherItems = packItems.filter(
    (item) => item.isDuplicate() && !item.isPlayer() && !item.isManager() && !item.isMiscItem(),
  );
  state.items += duplicateOtherItems.length;
  state.duplicatedItems += duplicateOtherItems.length;
  return packsOpenerApplyItemAction(
    duplicateOtherItems,
    action,
    transferListFullAction,
    {
      discard: (discardedCount, earnedCoins) => {
        state.itemsDiscarded += discardedCount;
        state.coinsEarned += earnedCoins;
      },
      moveToTransferList: (movedCount) => (state.itemsToTransferList += movedCount),
      moveToClub: (movedCount) => (state.itemsToClub += movedCount),
    },
    state,
  );
}

async function packsOpenerRedeemMiscItems(packItems, action, transferListFullAction, state) {
  const miscItems = packItems.filter((item) => item.isMiscItem());
  if (miscItems.length === 0) {
    return packsOpenerProcessStatus.SUCCESS;
  }
  try {
    await Promise.all(
      miscItems.map(async (item) => {
        try {
          if (item.amount) {
            state.coinsEarned += item.amount;
          }
        } catch (error) {
          console.log(error);
        }
        services.Item.redeem(item);
        await waitForDelay(389, 675);
      }),
    );
  } catch (error) {
    packsOpenerProcessStatus.ERROR;
  }
  return packsOpenerProcessStatus.SUCCESS;
}

async function packsOpenerApplyItemAction(
  packItems,
  action,
  transferListFullAction,
  statsUpdaters,
  state,
) {
  if (packItems.length === 0) {
    return packsOpenerProcessStatus.SUCCESS;
  }
  function sumDiscardValue(itemsToSum) {
    return itemsToSum.reduce((total, item) => total + item.discardValue, 0);
  }
  let response;
  switch (action) {
    case packsOpenerItemActions.MOVE_TO_TRANSFER_LIST:
      if (repositories.Item.isPileFull(ItemPile.TRANSFER)) {
        if (transferListFullAction === packsOpenerItemActions.STOP_PROCESS) {
          state.addItems("unassigned", packItems);
          return packsOpenerProcessStatus.TRANSFER_LIST_FULL;
        }
        response = await discardItems(packItems);
        if (response.success) {
          statsUpdaters.discard(packItems.length, sumDiscardValue(packItems));
          state.addItems("discarded", packItems);
          return packsOpenerProcessStatus.SUCCESS;
        }
      }
      response = await (function (itemsToMove) {
        return observableToPromise(services.Item.move(itemsToMove, ItemPile.TRANSFER));
      })(packItems);
      if (response.success) {
        statsUpdaters.moveToTransferList(packItems.length);
        state.addItems("transferList", packItems);
      }
      break;
    case packsOpenerItemActions.MOVE_TO_CLUB:
      response = await moveItemsToClub(packItems);
      if (response.success) {
        statsUpdaters.moveToClub(packItems.length);
        state.addItems("club", packItems);
      }
      break;
    case packsOpenerItemActions.QUICK_SELL:
      response = await discardItems(packItems);
      if (response.success) {
        statsUpdaters.discard(packItems.length, sumDiscardValue(packItems));
        state.addItems("discarded", packItems);
      }
      break;
    case packsOpenerItemActions.SBC_STORAGE:
      response = await moveItemsToSbcStorage(packItems);
      if (!response.success) {
        statsUpdaters.moveToSbcStorage(response.storedItemsCount);
        state.addItems("storage", packItems.slice(0, response.storedItemsCount));
        state.addItems("unassigned", packItems.slice(response.storedItemsCount));
        return packsOpenerProcessStatus.SBC_STORAGE_FULL;
      }
      statsUpdaters.moveToSbcStorage(packItems.length);
      state.addItems("storage", packItems);
      break;
    case packsOpenerItemActions.STOP_PROCESS:
      state.addItems("unassigned", packItems);
      return packsOpenerProcessStatus.SUCCESS;
  }
  if (response.success) {
    return packsOpenerProcessStatus.SUCCESS;
  } else {
    state.addItems("unassigned", packItems);
    return packsOpenerProcessStatus.ERROR;
  }
}

export async function packsOpenerOpenPack(
  pack,
  speedMultiplier,
  playersAction,
  duplicatedPlayersAction,
  managersAction,
  duplicatedManagersAction,
  itemsAction,
  duplicatedItemsAction,
  transferListFullAction,
  currency,
  state,
) {
  const requiresPurchase = !pack.isMyPack;
  if (repositories.Item.numItemsInCache(ItemPile.PURCHASED)) {
    return packsOpenerOpenStatus.UNASSIGNED_ITEMS;
  }
  if (requiresPurchase) {
    if (
      !pack.prices.get(currency) ||
      pack.prices.get(currency).amount > services.User.getUser()[currency.toLowerCase()].amount
    ) {
      return packsOpenerOpenStatus.NOT_ENOUGH_CREDITS;
    }
    if (currency == GameCurrency.COINS) {
      state.coinsSpent += pack.prices.get(currency).amount;
    } else {
      state.pointsSpent += pack.prices.get(currency).amount;
    }
  }
  if (
    !(await observableToPromise(requiresPurchase ? pack.purchase(currency) : pack.open())).success
  ) {
    return packsOpenerOpenStatus.ERROR;
  }
  state.packsOpened++;
  const unassignedItems = await fetchUnassignedItems();
  const runProcessingStep = async (processor, action) => {
    let stepStatus = await processor(
      unassignedItems,
      action || transferListFullAction,
      transferListFullAction,
      state,
    );
    if (!(stepStatus != packsOpenerProcessStatus.SUCCESS)) {
      await waitForDelay(314 * speedMultiplier, 681 * speedMultiplier);
    }
    return stepStatus;
  };
  let processingSteps = [
    [packsOpenerProcessPlayers, playersAction],
    [packsOpenerProcessManagers, managersAction],
    [packsOpenerProcessOtherItems, itemsAction],
    [packsOpenerProcessDuplicatePlayers, duplicatedPlayersAction],
    [packsOpenerProcessDuplicateManagers, duplicatedManagersAction],
    [packsOpenerProcessDuplicateOtherItems, duplicatedItemsAction],
    [packsOpenerRedeemMiscItems],
  ];
  let processStatus = packsOpenerProcessStatus.SUCCESS;
  for (let step of processingSteps) {
    const [processor, action] = step;
    processStatus = await runProcessingStep(processor, action);
    if (processStatus !== packsOpenerProcessStatus.SUCCESS) {
      break;
    }
  }
  await requestUserCurrencies();
  switch (processStatus) {
    case packsOpenerProcessStatus.SUCCESS:
      return packsOpenerOpenStatus.SUCCESS;
    case packsOpenerProcessStatus.TRANSFER_LIST_FULL:
      return packsOpenerOpenStatus.TRANSFER_LIST_FULL;
    default:
      return packsOpenerOpenStatus.ERROR;
  }
}
