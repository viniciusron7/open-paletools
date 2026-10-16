/**
 * Data and search helpers for one-click (score-based) SBCs: challenge and candidate loading, the
 * cancellable score search, limits and revalidation. Used by dialog.js and one-click-view.js.
 *
 * Invariants:
 * - Errors are `Error`s whose message and `code` are a one-click code (`throwOneClickSbcError`);
 *   every code must be listed in `showOneClickSbcError` (one-click-view.js) and have a
 *   `plugins.sbcAutoSolver.oneClick.errors.<code>` translation.
 * - `findOneClickSbcScoreSolutions` is a dynamic programme over summed `sbsScore` (at most 5
 *   states per score, unlimited with `ratingCounts`); it yields to the event loop every 10 000
 *   iterations, re-checks `isActive`,
 *   and throws `searchLimit` after 5 000 000 iterations or 100 000 buckets/states. Earlier
 *   candidates are preferred, so the candidate order breaks ties. With `ratingCounts` it only
 *   returns exact-size alternatives with the same rating multiset (refresh), and `itemPenalty`
 *   discourages reuse. It returns up to 5 solutions with distinct rating multisets, lowest score
 *   first.
 * - `loadOneClickSbcCandidatePlayers` pages `services.Club.search` (100 per page,
 *   `sbcChallengeId`, club and storage piles, or storage only) and drops concept, non-player,
 *   loan, limited-use, locked and active-squad items plus those excluded by the options; sorted
 *   storage first (when preferred), then rating, then id.
 * - `assertSbcAutoSolverActive` throws `cancelled` unless Paletools and the plugin are enabled
 *   and `isActive()` holds. Submit limit: server setting `ONE_CLICK_SBC_SUBMIT_LIMIT` (default
 *   30).
 * - `revalidateOneClickSbcChallenge` reloads with a cache reset and throws `staleSolution` when
 *   the plan is invalidated or the challenge's score state changed.
 */
import { getClubIndexRevisionCount } from "../../club/club-index.js";
import { isItemLocked } from "../../club/locked-items.js";
import { configuration } from "../../config/configuration.js";
import { toArray } from "../../core/collections.js";
import { fetchActiveSquadDefinitionIds } from "../../sbc/smart-builder-solver.js";
import { isSbcStorageItem } from "../../webapp/item-piles.js";
import { observableToPromise } from "../../webapp/observable.js";

const oneClickSbcSolutionLimit = 5;

const oneClickSbcMaxSearchStates = 100000;

const oneClickSbcMaxSearchIterations = 5000000;

export async function findOneClickSbcScoreSolutions(
  candidates,
  targetScore,
  maxPlayerCount,
  isActive = () => true,
  searchOptions = {},
) {
  if (
    !Number.isSafeInteger(targetScore) ||
    targetScore <= 0 ||
    !Number.isSafeInteger(maxPlayerCount) ||
    maxPlayerCount <= 0
  ) {
    throwOneClickSbcError("invalidScore");
  }
  const seenCandidateIds = new Set();
  const countsByScoreAndRating = new Map();
  const uniqueCandidates = candidates.filter((candidate) => {
    const candidateId = String(candidate.id);
    if (
      !Number.isSafeInteger(Number(candidate.id)) ||
      Number(candidate.id) <= 0 ||
      seenCandidateIds.has(candidateId) ||
      !Number.isSafeInteger(candidate.sbsScore) ||
      candidate.sbsScore <= 0
    ) {
      return false;
    }
    if (searchOptions.ratingCounts && !searchOptions.ratingCounts.has(candidate.rating)) {
      return false;
    }
    seenCandidateIds.add(candidateId);
    const scoreRatingKey = candidate.sbsScore + ":" + candidate.rating;
    const sameScoreRatingCount = countsByScoreAndRating.get(scoreRatingKey) || 0;
    countsByScoreAndRating.set(scoreRatingKey, sameScoreRatingCount + 1);
    return (
      sameScoreRatingCount < (searchOptions.ratingCounts?.get(candidate.rating) ?? maxPlayerCount)
    );
  });
  if (
    uniqueCandidates
      .map((candidate) => candidate.sbsScore)
      .sort((left, right) => right - left)
      .slice(0, maxPlayerCount)
      .reduce((sum, score) => sum + score, 0) < targetScore
  ) {
    return [];
  }
  const statesByScore = new Map([
    [
      0,
      [
        {
          count: 0,
          preference: 0,
          previous: null,
          ratings: [],
          ratingKey: "",
        },
      ],
    ],
  ]);
  const reachedScores = new Set();
  let iterationCount = 0;
  let stateCount = 1;
  let scoreCeiling = searchOptions.ratingCounts ? targetScore : 1 / 0;
  for (const [candidateIndex, candidate] of uniqueCandidates.entries()) {
    if (!isActive()) {
      throwOneClickSbcError("cancelled");
    }
    const scoresBelowTarget = Array.from(statesByScore.keys())
      .filter((score) => score < targetScore)
      .sort((left, right) => right - left);
    for (const score of scoresBelowTarget) {
      const nextScore = score + candidate.sbsScore;
      if (!Number.isSafeInteger(nextScore)) {
        throwOneClickSbcError("invalidScore");
      }
      if (!(nextScore > scoreCeiling)) {
        for (const previous of statesByScore.get(score)) {
          if (++iterationCount > oneClickSbcMaxSearchIterations) {
            throwOneClickSbcError("searchLimit");
          }
          if (iterationCount % 10000 == 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (!isActive()) {
              throwOneClickSbcError("cancelled");
            }
          }
          if (previous.count >= maxPlayerCount) {
            continue;
          }
          if (
            searchOptions.ratingCounts &&
            previous.ratings.filter((rating) => rating === candidate.rating).length >=
              searchOptions.ratingCounts.get(candidate.rating)
          ) {
            continue;
          }
          const nextCount = previous.count + 1;
          if (
            searchOptions.ratingCounts &&
            nextScore === targetScore &&
            nextCount !== maxPlayerCount
          ) {
            continue;
          }
          const preference =
            previous.preference + candidateIndex + (searchOptions.itemPenalty?.(candidate) || 0);
          const bucket = statesByScore.get(nextScore) || [];
          const ratings = [...previous.ratings, candidate.rating].sort(
            (left, right) => left - right,
          );
          const ratingKey = ratings.join(",");
          const sameRatingsIndex = bucket.findIndex((state) => state.ratingKey === ratingKey);
          if (sameRatingsIndex >= 0) {
            if (bucket[sameRatingsIndex].preference <= preference) {
              continue;
            }
            bucket.splice(sameRatingsIndex, 1);
            stateCount--;
          }
          const insertIndex = bucket.findIndex(
            (state) =>
              nextCount < state.count ||
              (nextCount === state.count && preference < state.preference),
          );
          const bucketLimit = searchOptions.ratingCounts ? 1 / 0 : oneClickSbcSolutionLimit;
          if (insertIndex < 0 && bucket.length >= bucketLimit) {
            continue;
          }
          const nextState = {
            count: nextCount,
            preference: preference,
            previous: previous,
            item: candidate,
            ratings: ratings,
            ratingKey: ratingKey,
          };
          bucket.splice(insertIndex < 0 ? bucket.length : insertIndex, 0, nextState);
          stateCount++;
          if (bucket.length > bucketLimit) {
            bucket.pop();
            stateCount--;
          }
          statesByScore.set(nextScore, bucket);
          if (nextScore >= targetScore) {
            reachedScores.add(nextScore);
            const sortedReachedScores = Array.from(reachedScores).sort(
              (left, right) => left - right,
            );
            const distinctRatingKeys = new Set();
            scoreCeiling = statesByScore.has(targetScore) ? targetScore : 1 / 0;
            for (const reachedScore of sortedReachedScores) {
              statesByScore
                .get(reachedScore)
                .forEach((state) => distinctRatingKeys.add(state.ratingKey));
              if (distinctRatingKeys.size >= oneClickSbcSolutionLimit) {
                scoreCeiling = Math.min(scoreCeiling, reachedScore);
                break;
              }
            }
            for (const reachedScore of reachedScores) {
              if (reachedScore > scoreCeiling) {
                stateCount -= statesByScore.get(reachedScore).length;
                statesByScore.delete(reachedScore);
                reachedScores.delete(reachedScore);
              }
            }
          }
          if (statesByScore.size > oneClickSbcMaxSearchStates) {
            throwOneClickSbcError("searchLimit");
          }
          if (searchOptions.ratingCounts && stateCount > oneClickSbcMaxSearchStates) {
            throwOneClickSbcError("searchLimit");
          }
        }
      }
    }
  }
  if (!isActive()) {
    throwOneClickSbcError("cancelled");
  }
  const finalScores = Array.from(reachedScores).sort((left, right) => left - right);
  const seenRatingKeys = new Set();
  return finalScores
    .flatMap((score) =>
      statesByScore.get(score).map((path) => ({
        score: score,
        path: path,
      })),
    )
    .filter(
      ({ path: path }) =>
        !seenRatingKeys.has(path.ratingKey) && (seenRatingKeys.add(path.ratingKey), true),
    )
    .slice(0, oneClickSbcSolutionLimit)
    .map(({ score: score, path: path }) => {
      const players = [];
      for (let node = path; node.item; node = node.previous) {
        players.push(node.item);
      }
      players.reverse();
      return {
        players: players,
        score: score,
        excess: score - targetScore,
      };
    });
}

export function throwOneClickSbcError(code) {
  throw Object.assign(new Error(code), {
    code: code,
  });
}

export function isSbcAutoSolverEnabled() {
  return configuration.enabled && configuration.plugins.sbcAutoSolver.enabled;
}

export function assertSbcAutoSolverActive(isActive) {
  if (!(isSbcAutoSolverEnabled() && isActive())) {
    throwOneClickSbcError("cancelled");
  }
}

export function getOneClickSbcSubmitLimit() {
  const submitLimit =
    services.Configuration.getFeatureSetting(
      UTServerSettingsRepository.KEY.ONE_CLICK_SBC_SUBMIT_LIMIT,
    ) || 30;
  if (!Number.isSafeInteger(submitLimit) || submitLimit <= 0) {
    throwOneClickSbcError("invalidScore");
  }
  return submitLimit;
}

export function getOneClickSbcRemainingScore(challenge) {
  const scoreRequirement = challenge.scoreRequirement;
  const submittedScore = challenge.submittedScore ?? 0;
  if (
    !Number.isSafeInteger(scoreRequirement) ||
    !Number.isSafeInteger(submittedScore) ||
    submittedScore < 0 ||
    scoreRequirement <= submittedScore
  ) {
    throwOneClickSbcError("invalidScore");
  }
  return scoreRequirement - submittedScore;
}

export async function loadOneClickSbcChallenges(
  sbcSet,
  isActive = () => true,
  forceRefresh = false,
) {
  assertSbcAutoSolverActive(isActive);
  if (forceRefresh) {
    services.SBC.repository.setCacheTimestamp(0);
  }
  const response = await observableToPromise(services.SBC.requestChallengesForSet(sbcSet));
  assertSbcAutoSolverActive(isActive);
  if (!response.success) {
    throwOneClickSbcError("loadFailed");
  }
  const loadedSet = response.data?.set || sbcSet;
  const challenges = toArray(response.data?.challenges || loadedSet.getChallenges())
    .map((challengeEntry) => challengeEntry?.value ?? challengeEntry)
    .filter(
      (challenge) =>
        !challenge.isCompleted() && challenge.scoreRequirement > (challenge.submittedScore ?? 0),
    );
  if (!challenges.length) {
    throwOneClickSbcError("noChallenges");
  }
  return {
    set: loadedSet,
    challenges: challenges,
  };
}

export async function loadOneClickSbcCandidatePlayers(challenge, solveOptions, isActive) {
  assertSbcAutoSolverActive(isActive);
  const activeSquadDefinitionIds = new Set((await fetchActiveSquadDefinitionIds()).map(String));
  const candidatesById = new Map();
  const pileSearchTypes = solveOptions.storageOnly
    ? [PileSearchType.STORAGE]
    : [PileSearchType.CLUB, PileSearchType.STORAGE];
  for (const pileSearchType of pileSearchTypes) {
    let offset = 0;
    const seenItemIds = new Set();
    for (;;) {
      assertSbcAutoSolverActive(isActive);
      const searchCriteria = new UTSearchCriteriaDTO();
      searchCriteria.sbcChallengeId = challenge.id;
      searchCriteria.pileSearchType = pileSearchType;
      searchCriteria.sort = SearchSortOrder.ASCENDING;
      searchCriteria.untradeables = SearchUntradeables.DEFAULT;
      if (services.Item.isFavoritePlayersEnabled()) {
        searchCriteria.isFavorite = false;
      }
      searchCriteria.count = 100;
      searchCriteria.offset = offset;
      const response = await observableToPromise(services.Club.search(searchCriteria));
      assertSbcAutoSolverActive(isActive);
      if (!(response.success && Array.isArray(response.response?.items))) {
        throwOneClickSbcError("loadFailed");
      }
      const pageItems = response.response.items;
      let newItemCount = 0;
      for (const item of pageItems) {
        const itemId = String(item.id);
        if (!seenItemIds.has(itemId)) {
          seenItemIds.add(itemId);
          newItemCount++;
          if (
            !(
              item.sbsScore <= 0 ||
              !Number.isSafeInteger(item.sbsScore) ||
              item.isConceptPlayer ||
              !item.isPlayer() ||
              item.loans > -1 ||
              item.isLimitedUse() ||
              isItemLocked(item) ||
              activeSquadDefinitionIds.has(String(item.definitionId)) ||
              (solveOptions.storageOnly && !isSbcStorageItem(item)) ||
              (solveOptions.ignoreEvolutions !== false && item.upgrades) ||
              (solveOptions.ignoreSingleRevisionPlayers &&
                item.rareflag > 1 &&
                getClubIndexRevisionCount(item) <= 1) ||
              (solveOptions.allowSpecialCards === false && item.rareflag > 1) ||
              (solveOptions.untradeablesOnly && item.tradable) ||
              item.rating < solveOptions.ovrMin ||
              item.rating > solveOptions.ovrMax
            )
          ) {
            candidatesById.set(itemId, item);
          }
        }
      }
      if (response.response.retrievedAll) {
        break;
      }
      if (!(pageItems.length && newItemCount)) {
        throwOneClickSbcError("loadFailed");
      }
      offset += pageItems.length;
    }
  }
  return Array.from(candidatesById.values()).sort(
    (left, right) =>
      (solveOptions.preferStorage
        ? Number(isSbcStorageItem(right)) - Number(isSbcStorageItem(left))
        : 0) ||
      left.rating - right.rating ||
      Number(left.id) - Number(right.id),
  );
}

export async function revalidateOneClickSbcChallenge(plan, isActive) {
  if (plan.invalidated) {
    throwOneClickSbcError("staleSolution");
  }
  const loadResult = await loadOneClickSbcChallenges(plan.set, isActive, true);
  const challenge = loadResult.challenges.find(
    (loadedChallenge) => String(loadedChallenge.id) === String(plan.challenge.id),
  );
  if (
    !(
      challenge &&
      challenge.scoreRequirement === plan.scoreRequirement &&
      (challenge.submittedScore ?? 0) === plan.submittedScore &&
      getOneClickSbcRemainingScore(challenge) === plan.target
    )
  ) {
    throwOneClickSbcError("staleSolution");
  }
  return {
    set: loadResult.set,
    challenge: challenge,
  };
}
