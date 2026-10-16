/**
 * Team-rating solver: `fillSquadToReachTeamRating` completes a partial selection with the
 * cheapest mix of candidate ratings that lets the squad reach a TEAM_RATING target. Called by
 * src/sbc/smart-builder-solver.js; it also exports the +/-15 candidate rating window used by
 * src/sbc/sbc-eligibility-requirement.js and the smart builder search criteria.
 *
 * Invariants:
 * - Selected players and candidates are de-duplicated with `getPlayerKey` (default
 *   `definitionId`); candidates exclude selected players and, unless `allowSpecialCards`, every
 *   rareflag other than Common/Rare.
 * - Combinations are enumerated branch-and-bound over the available candidate ratings inside
 *   target-15..target+15 (clamped to `minOvr`/`maxOvr`), priced per rating by the average market
 *   price or the `estimatePriceForRating` heuristic; at most `maxRatingCombinations` (5000)
 *   cheapest are kept.
 * - Results are memoized in the module-level `ratingCombinationsCache`, keyed by target, squad
 *   size, selected ratings and per-rating availability and price; it is never cleared.
 * - Players are taken from the highest rating down, each rating's players sorted with
 *   `comparePlayers`. The selection is returned unchanged when no combination is available or a
 *   full squad still misses the target; an incomplete squad is returned as is.
 * - `teamRatingCandidateRangeBelow/Above` are part of other modules' contracts (requirement
 *   matching, search criteria); change them together.
 */
import { groupBy, uniqueBy } from "../core/collections.js";
import { compareItemsBySortOptions } from "./player-sort.js";
import { SquadRatingCalculator } from "./squad-rating.js";
import { rarityIdByName } from "../webapp/rarities.js";
import { maxOvr, minOvr } from "../webapp/search-criteria-limits.js";

export const teamRatingCandidateRangeBelow = 15;

export const teamRatingCandidateRangeAbove = 15;

const defaultSbcSquadSize = 11;

const maxRatingCombinations = 5000;

const ratingCombinationsCache = {};

function getAverageMarketPriceByRating(players) {
  const priceTotalsByRating = players.reduce((totalsByRating, player) => {
    const rating = player.rating;
    const marketAverage = player.getMarketAverage();
    if (!(marketAverage <= 0)) {
      if (!totalsByRating[rating]) {
        totalsByRating[rating] = {
          total: 0,
          count: 0,
        };
      }
      totalsByRating[rating].total += marketAverage;
      totalsByRating[rating].count += 1;
    }
    return totalsByRating;
  }, {});
  return Object.fromEntries(
    Object.entries(priceTotalsByRating).map(
      ([rating, { total: totalPrice, count: playerCount }]) => [rating, totalPrice / playerCount],
    ),
  );
}

function estimatePriceForRating(rating, targetRating) {
  return 1000 * rating + 10000 * Math.abs(targetRating - rating);
}

function getRatingCombinationCost(combination, averagePriceByRating, targetRating) {
  return Object.entries(combination).reduce(
    (totalCost, [rating, playerCount]) =>
      playerCount === 0
        ? totalCost
        : totalCost +
          (averagePriceByRating[rating] || estimatePriceForRating(parseInt(rating), targetRating)) *
            playerCount,
    0,
  );
}

function getCombinationSquadRating(fixedRatings, ratingCounts, candidateRatings, squadSize) {
  const addedRatings = [];
  for (let ratingIndex = 0; ratingIndex < ratingCounts.length; ratingIndex++) {
    for (let copyIndex = 0; copyIndex < ratingCounts[ratingIndex]; copyIndex++) {
      addedRatings.push(candidateRatings[ratingIndex]);
    }
  }
  return SquadRatingCalculator.getRating([...fixedRatings, ...addedRatings], squadSize);
}

function canCombinationReachTargetRating(
  fixedRatings,
  ratingCounts,
  candidateRatings,
  unusedArgument4,
  slotsLeft,
  targetRating,
  squadSize,
) {
  const countsWithBestFill = ratingCounts.slice();
  countsWithBestFill[countsWithBestFill.length - 1] += slotsLeft;
  return (
    getCombinationSquadRating(fixedRatings, countsWithBestFill, candidateRatings, squadSize) >=
    targetRating
  );
}

function getPriceForRating(averagePriceByRating, rating, targetRating) {
  return averagePriceByRating[rating] || estimatePriceForRating(rating, targetRating);
}

function isRatingCombinationAvailable(
  combination,
  availableCountsByRating,
  requiredCountsByRating = {},
) {
  for (const [rating, requiredCount] of Object.entries(requiredCountsByRating)) {
    if ((combination[rating] || 0) < requiredCount) {
      return false;
    }
  }
  for (const [rating, neededCount] of Object.entries(combination)) {
    if (
      (requiredCountsByRating[rating] || 0) + (availableCountsByRating[rating] || 0) <
      neededCount
    ) {
      return false;
    }
  }
  return true;
}

function pickPlayersWithRating(playersByRating, rating, takeCount, comparePlayers) {
  return (playersByRating[rating] || []).slice().sort(comparePlayers).slice(0, takeCount);
}

export async function fillSquadToReachTeamRating(
  candidatePlayers,
  targetRating,
  selectedPlayers,
  squadSize = defaultSbcSquadSize,
  allowSpecialCards,
  comparePlayers = compareItemsBySortOptions,
  getPlayerKey = (item) => item.definitionId,
) {
  selectedPlayers = uniqueBy(
    selectedPlayers.filter((player) => player),
    getPlayerKey,
  );
  const selectedPlayerKeys = new Set(selectedPlayers.map(getPlayerKey));
  const candidatesByRating = groupBy(
    (candidatePlayers = uniqueBy(
      (candidatePlayers = candidatePlayers.filter(
        (player) =>
          !(
            selectedPlayerKeys.has(getPlayerKey(player)) ||
            (!allowSpecialCards &&
              player.rareflag !== rarityIdByName.Common &&
              player.rareflag !== rarityIdByName.Rare)
          ),
      )),
      getPlayerKey,
    )),
    (player) => player.rating,
    (player) => player,
  );
  const allPlayers = [...candidatePlayers, ...selectedPlayers];
  const cheapestCombination = (function (
    combinations,
    availableCountsByRating,
    requiredCountsByRating = {},
  ) {
    for (const combination of combinations) {
      if (
        isRatingCombinationAvailable(combination, availableCountsByRating, requiredCountsByRating)
      ) {
        return combination;
      }
    }
  })(
    (function (targetRating, combinations, pricedPlayers) {
      const averagePriceByRating = getAverageMarketPriceByRating(pricedPlayers);
      return combinations
        .slice()
        .sort(
          (left, right) =>
            getRatingCombinationCost(left, averagePriceByRating, targetRating) -
            getRatingCombinationCost(right, averagePriceByRating, targetRating),
        );
    })(
      targetRating,
      (function (
        targetRating,
        squadSize = defaultSbcSquadSize,
        availableCountsByRating = {},
        candidatePlayers = [],
        selectedPlayers = [],
      ) {
        const candidateRatings = (function (targetRating, countsByRating = {}) {
          const minRating = Math.max(minOvr, targetRating - teamRatingCandidateRangeBelow);
          const maxRating = Math.min(maxOvr, targetRating + teamRatingCandidateRangeAbove);
          return Object.keys(countsByRating)
            .map((ratingKey) => parseInt(ratingKey))
            .filter((rating) => rating >= minRating && rating <= maxRating)
            .sort((left, right) => left - right);
        })(targetRating, availableCountsByRating);
        const averagePriceByRating = getAverageMarketPriceByRating(candidatePlayers);
        const selectedRatings = selectedPlayers.map((player) => player.rating);
        const remainingSlots = squadSize - selectedRatings.length;
        const cacheKey =
          targetRating +
          ":" +
          squadSize +
          ":" +
          selectedRatings.sort((left, right) => left - right).join(",") +
          ":" +
          candidateRatings
            .map(
              (rating) =>
                rating +
                ":" +
                availableCountsByRating[rating] +
                ":" +
                getPriceForRating(averagePriceByRating, rating, targetRating),
            )
            .join("|");
        if (ratingCombinationsCache[cacheKey]) {
          return ratingCombinationsCache[cacheKey];
        }
        const combinations = [];
        const ratingCounts = new Array(candidateRatings.length).fill(0);
        let priceCutoff = 1 / 0;
        if (candidateRatings.length === 0 || remainingSlots < 0) {
          ratingCombinationsCache[cacheKey] = combinations;
          return combinations;
        } else if (remainingSlots === 0) {
          if (SquadRatingCalculator.getRating(selectedRatings, squadSize) >= targetRating) {
            combinations.push({});
          }
          ratingCombinationsCache[cacheKey] = combinations;
          return combinations;
        } else {
          (function searchCombinations(ratingIndex, slotsLeft, accumulatedPrice) {
            if (accumulatedPrice > priceCutoff) {
              return;
            }
            if (ratingIndex === candidateRatings.length - 1) {
              if (slotsLeft > (availableCountsByRating[candidateRatings[ratingIndex]] || 0)) {
                return;
              }
              ratingCounts[ratingIndex] = slotsLeft;
              if (
                getCombinationSquadRating(
                  selectedRatings,
                  ratingCounts,
                  candidateRatings,
                  squadSize,
                ) >= targetRating
              ) {
                const combination = (function (counts, ratings) {
                  return counts.reduce((countByRating, ratingCount, index) => {
                    countByRating[ratings[index]] = ratingCount;
                    return countByRating;
                  }, {});
                })(ratingCounts, candidateRatings);
                combination.__price =
                  accumulatedPrice +
                  getPriceForRating(
                    averagePriceByRating,
                    candidateRatings[ratingIndex],
                    targetRating,
                  ) *
                    slotsLeft;
                (function (newCombination) {
                  if (
                    !(
                      combinations.length === maxRatingCombinations &&
                      newCombination.__price >= priceCutoff
                    )
                  ) {
                    combinations.push(newCombination);
                    combinations.sort((left, right) => left.__price - right.__price);
                    if (combinations.length > maxRatingCombinations) {
                      combinations.pop();
                    }
                    if (combinations.length === maxRatingCombinations) {
                      priceCutoff = combinations[combinations.length - 1].__price;
                    }
                  }
                })(combination);
              }
              return void (ratingCounts[ratingIndex] = 0);
            }
            const maxCount = Math.min(
              slotsLeft,
              availableCountsByRating[candidateRatings[ratingIndex]] || 0,
            );
            for (let countForRating = 0; countForRating <= maxCount; countForRating++) {
              ratingCounts[ratingIndex] = countForRating;
              const slotsRemaining = slotsLeft - countForRating;
              const nextAccumulatedPrice =
                accumulatedPrice +
                getPriceForRating(
                  averagePriceByRating,
                  candidateRatings[ratingIndex],
                  targetRating,
                ) *
                  countForRating;
              if (
                canCombinationReachTargetRating(
                  selectedRatings,
                  ratingCounts,
                  candidateRatings,
                  0,
                  slotsRemaining,
                  targetRating,
                  squadSize,
                )
              ) {
                searchCombinations(ratingIndex + 1, slotsRemaining, nextAccumulatedPrice);
              }
            }
            ratingCounts[ratingIndex] = 0;
          })(0, remainingSlots, 0);
          ratingCombinationsCache[cacheKey] = combinations.map((combination) => {
            const cleanCombination = {
              ...combination,
            };
            delete cleanCombination.__price;
            return cleanCombination;
          });
          return ratingCombinationsCache[cacheKey];
        }
      })(
        targetRating,
        squadSize,
        (function (players) {
          return players.reduce((countsByRating, player) => {
            countsByRating[player.rating] = (countsByRating[player.rating] || 0) + 1;
            return countsByRating;
          }, {});
        })(candidatePlayers),
        candidatePlayers,
        selectedPlayers,
      ),
      allPlayers,
    ),
    (function (players) {
      const playersByRating = groupBy(
        players,
        (player) => player.rating,
        (player) => player,
      );
      const countsByRating = {};
      for (let rating of Object.keys(playersByRating)) {
        countsByRating[rating] = (countsByRating[rating] || 0) + playersByRating[rating].length;
      }
      return countsByRating;
    })(candidatePlayers),
  );
  if (!cheapestCombination) {
    return selectedPlayers;
  }
  const squadPlayers = [...selectedPlayers];
  for (let [rating, playerCount] of Object.entries(cheapestCombination).sort(
    (left, right) => parseInt(right[0]) - parseInt(left[0]),
  )) {
    if (playerCount === 0) {
      continue;
    }
    if (squadPlayers.length >= squadSize) {
      break;
    }
    const takeCount = Math.min(playerCount, squadSize - squadPlayers.length);
    if (!(takeCount <= 0)) {
      squadPlayers.push(
        ...pickPlayersWithRating(candidatesByRating, rating, takeCount, comparePlayers),
      );
    }
  }
  return squadPlayers.length < squadSize
    ? squadPlayers
    : SquadRatingCalculator.getRating(
          squadPlayers.map((player) => player.rating),
          squadSize,
        ) < targetRating
      ? selectedPlayers
      : squadPlayers;
}
