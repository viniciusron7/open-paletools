/**
 * Helpers that put club players into an SBC challenge squad. Used by
 * src/sbc/use-players-button.js (the *-to-SBC buttons); `fillSbcSquadByPosition` is also used by
 * the SBC auto solver preview (src/plugins/sbc-auto-solver/preview-view.js).
 *
 * Invariants:
 * - `findClubPlayersMatchingItems` re-reads the club (`findOwnedClubPlayers` bypassing the cache)
 *   and keeps the club players with the same `definitionId` and `rareflag` that have no
 *   `upgrades`, so squads receive club copies, never the source items themselves.
 * - Squads are written as a 23-entry array through `squad.setPlayers(players, true)`.
 * - `fillSbcSquadByRating` places the players in `getSBCSlots()` order, saves the challenge
 *   (`services.SBC.saveChallenge`, not awaited) and resets
 *   `repositories.Item.unassigned/transfer.expiryTimestamp` to 0. `fillSbcSquadByPosition` does
 *   neither: its callers save or submit.
 * - `fillSbcSquadByPosition` sorts the first 23 players by ascending rating and places them by
 *   preferred position, then by the primary and secondary alternatives of src/sbc/positions.js,
 *   then into any remaining position slot, then on the bench from index 11.
 */
import { findOwnedClubPlayers } from "../club/club-players-cache.js";
import { getPrimaryAlternativePositions, getSecondaryAlternativePositions } from "./positions.js";

export async function findClubPlayersMatchingItems(sourceItems, unusedArgument2) {
  let clubPlayers = await findOwnedClubPlayers(sourceItems, 0, false, true);
  let matchingPlayers = [];
  for (let clubPlayer of clubPlayers) {
    if (
      sourceItems.find(
        (item) =>
          item.definitionId === clubPlayer.definitionId &&
          item.rareflag === clubPlayer.rareflag &&
          !clubPlayer.upgrades,
      )
    ) {
      matchingPlayers.push(clubPlayer);
    }
  }
  return matchingPlayers;
}

export async function fillSbcSquadByRating(challenge, sourceItems, unusedArgument3, isAscending) {
  if (!challenge) {
    return;
  }
  let clubPlayers = await findClubPlayersMatchingItems(sourceItems);
  const squad = challenge.squad;
  if (isAscending) {
    clubPlayers.sort((left, right) =>
      left.rating > right.rating ? 1 : left.rating < right.rating ? -1 : 0,
    );
  } else {
    clubPlayers.sort((left, right) =>
      left.rating < right.rating ? 1 : left.rating > right.rating ? -1 : 0,
    );
  }
  clubPlayers = clubPlayers.slice(0, 23);
  const sbcSlots = squad.getSBCSlots();
  const squadPlayers = new Array(23);
  for (let slot of sbcSlots) {
    squadPlayers[slot.index] = clubPlayers.shift();
  }
  squad.setPlayers(squadPlayers, true);
  services.SBC.saveChallenge(challenge);
  repositories.Item.unassigned.expiryTimestamp = 0;
  repositories.Item.transfer.expiryTimestamp = 0;
}

export function fillSbcSquadByPosition(challenge, players) {
  if (!challenge) {
    return;
  }
  const squadCandidates = players.slice(0, 23);
  const squad = challenge.squad;
  const slotIndexesByPosition = squad
    .getSBCSlots()
    .reduce(
      (accumulator, slot) =>
        slot.position
          ? (accumulator[slot.position.typeName] || (accumulator[slot.position.typeName] = []),
            accumulator[slot.position.typeName].push(slot.index),
            accumulator)
          : accumulator,
      {},
    );
  squadCandidates.sort((left, right) =>
    left.rating < right.rating ? -1 : left.rating > right.rating ? 1 : 0,
  );
  let nextBenchIndex = 11;
  let unplacedPlayers = [];
  const squadPlayers = new Array(23);
  for (const player of squadCandidates) {
    const slotIndexes = slotIndexesByPosition[PlayerPosition[player.preferredPosition]];
    if (slotIndexes && slotIndexes.length > 0) {
      squadPlayers[slotIndexes.shift()] = player;
      if (slotIndexes.length === 0) {
        delete slotIndexesByPosition[PlayerPosition[player.preferredPosition]];
      }
    } else {
      unplacedPlayers.push(player);
    }
  }
  function placeUsingAlternativePositions(getAlternativePositions) {
    for (
      let skippedCount = 0;
      skippedCount < unplacedPlayers.length && Object.keys(slotIndexesByPosition).length > 0;
    ) {
      let player = unplacedPlayers.shift();
      let slotIndexes = null;
      for (let position of getAlternativePositions(player.preferredPosition)) {
        slotIndexes = slotIndexesByPosition[PlayerPosition[position]];
        if (slotIndexes && slotIndexes.length != 0) {
          squadPlayers[slotIndexes.shift()] = player;
          if (slotIndexes.length === 0) {
            delete slotIndexesByPosition[PlayerPosition[position]];
          }
          break;
        }
      }
      if (!slotIndexes) {
        unplacedPlayers.push(player);
        skippedCount++;
      }
    }
  }
  placeUsingAlternativePositions(getPrimaryAlternativePositions);
  placeUsingAlternativePositions(getSecondaryAlternativePositions);
  for (let positionName of Object.keys(slotIndexesByPosition)) {
    if (unplacedPlayers.length === 0) {
      break;
    }
    for (let slotIndex of slotIndexesByPosition[positionName]) {
      if (unplacedPlayers.length === 0) {
        break;
      }
      squadPlayers[slotIndex] = unplacedPlayers.shift();
    }
  }
  for (let player of unplacedPlayers) {
    if (nextBenchIndex >= 23) {
      break;
    }
    squadPlayers[nextBenchIndex++] = player;
  }
  squad.setPlayers(squadPlayers, true);
}
