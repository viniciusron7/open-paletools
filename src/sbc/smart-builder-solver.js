/**
 * SBC smart-builder solver. `buildSmartBuilderSquad(challenge, builderConfig)` resolves to
 * `{success, players, hasConceptPlayers, meetsRequirements, count, reason}`; it is used by the
 * sbc-smart-builder plugin and the SBC auto solver dialog (which also imports
 * `getSbcItemInstanceKey`); the one-click solver imports `fetchActiveSquadDefinitionIds`.
 *
 * Flow: wrap the requirements in `SbcEligibilityRequirement` (CHEMISTRY_POINTS ignored; counted =
 * `count > -1`), build search criteria from the uncounted requirements and the config
 * (TEAM_RATING narrows the OVR range to +/-15), collect club-index players (plus SBC storage with
 * `useStorage`; only SBC storage with `storageOnly`), filter them, satisfy the counted
 * requirements (rarity ones first, then larger counts) from per-requirement pools and
 * optionally concept players, then fill the squad, through `fillSquadToReachTeamRating` when a
 * TEAM_RATING requirement exists.
 *
 * Invariants:
 * - `computeSmartBuilderSquad` awaits `getOrLoadClubIndexPlayers()` before reading the club
 *   index. `buildSmartBuilderSquad` re-checks a successful non-concept solution with a real
 *   `services.Club.search`, deletes club-index entries whose definition ids are no longer owned
 *   and recomputes once.
 * - Candidates exclude loans, limited-use items, locked or active-squad items (unless in SBC
 *   storage), evolutions (`ignoreEvolutions`), single-revision specials
 *   (`ignoreSingleRevisionPlayers`), tradables with `untradeablesOnly`, ratings outside the
 *   range, `excludedPlayerKeys`, and important leagues/nations when asked and not required
 *   (SBC-storage items are exempt when `useStorage`).
 * - Key formats: `getSbcItemInstanceKey` gives `id:<id>` / `item:<itemData.id>` / the identity
 *   key; `getSbcPlayerIdentityKey` gives `db:<databaseId>` (or
 *   `definitionId & ItemIdMask.DATABASE`) / `def:<definitionId>`. The auto solver fills
 *   `excludedPlayerKeys` with instance keys, so both sides must keep these formats; identity keys
 *   keep two versions of a player out of one squad.
 * - Squad size is the number of non-brick slots. Candidate order: storage first (with
 *   `preferStorage`), Common, Rare, special, rating, storage, untradeable, market average,
 *   `definitionId`.
 * - `fetchActiveSquadDefinitionIds` throws when the request fails; callers must handle it.
 *
 * Known issues (kept as-is):
 * - Requirement pools are built with `satifiesRequirement`, which is false for the
 *   same-/distinct- nation/league/club count keys, so those requirements can only be met by
 *   players picked for other requirements.
 * - Requirement scope is never read: every counted requirement is checked as a minimum
 *   (`>= count`), including LOWER and EXACT ones.
 * - An uncounted rarity/league/nation/club requirement with several values puts its `Set` into
 *   the criteria (`rarities: [Set]`, `league: Set`, ...), because `value` is not an array.
 */
import {
  clubIndexPlayersByItemKey,
  deleteClubIndexPlayer,
  getClubIndexPlayers,
  getClubIndexRevisionCount,
  getOrLoadClubIndexPlayers,
} from "../club/club-index.js";
import { searchConceptItemsPaged } from "../club/concept-items.js";
import { isItemLocked } from "../club/locked-items.js";
import { uniqueBy } from "../core/collections.js";
import { copyWithOverrides } from "../core/objects.js";
import {
  fillSquadToReachTeamRating,
  teamRatingCandidateRangeAbove,
  teamRatingCandidateRangeBelow,
} from "./rating-solver.js";
import { SbcEligibilityRequirement } from "./sbc-eligibility-requirement.js";
import { SquadRatingCalculator } from "./squad-rating.js";
import { fetchSbcStorageItems, isSbcStorageItem } from "../webapp/item-piles.js";
import { getImportantLeagueIds, getImportantNationIds } from "../webapp/leagues-and-nations.js";
import { observableToPromise } from "../webapp/observable.js";
import { rarityIdByName, rarityIdsByGroupId } from "../webapp/rarities.js";
import { maxOvr, minOvr } from "../webapp/search-criteria-limits.js";

export async function fetchActiveSquadDefinitionIds() {
  const response = await observableToPromise(
    new UTItemSearchViewModel().requestActiveSquadDefIds(),
  );
  if (response.success) {
    return response.data.defIds;
  }
  throw new Error(response.error);
}

function getSmartBuilderRarityRank(item) {
  return item?.rareflag === rarityIdByName.Common
    ? 0
    : item?.rareflag === rarityIdByName.Rare
      ? 1
      : 2;
}

function isSmartBuilderCommonOrRareCard(item) {
  return item?.rareflag === rarityIdByName.Common || item?.rareflag === rarityIdByName.Rare;
}

function getSbcRequiredPlayerCount(challenge) {
  return challenge.squad.getNonBrickSlots().length;
}

function buildSmartBuilderRequirementSearchCriteria(baseCriteria, requirement) {
  const criteriaList = [];
  const requirementValues = requirement.hasMultipleValues
    ? Array.from(requirement.value)
    : [requirement.value];
  switch (requirement.keyValue) {
    case SBCEligibilityKey.PLAYER_RARITY:
      requirementValues.forEach((rarity) => {
        criteriaList.push(
          copyWithOverrides(baseCriteria, new UTSearchCriteriaDTO(), {
            rarities: [rarity],
          }),
        );
      });
      break;
    case SBCEligibilityKey.PLAYER_RARITY_GROUP:
      if (rarityIdsByGroupId[requirement.value]) {
        criteriaList.push(
          copyWithOverrides(baseCriteria, new UTSearchCriteriaDTO(), {
            rarities: Array.from(rarityIdsByGroupId[requirement.value]),
          }),
        );
      }
      break;
    case SBCEligibilityKey.PLAYER_LEVEL:
    case SBCEligibilityKey.PLAYER_QUALITY:
      requirementValues.forEach((quality) => {
        criteriaList.push(
          copyWithOverrides(baseCriteria, new UTSearchCriteriaDTO(), {
            level: SearchLevel[ItemRatingTier[quality]],
          }),
        );
      });
      break;
    case SBCEligibilityKey.LEAGUE_ID:
      requirementValues.forEach((league) => {
        criteriaList.push(
          copyWithOverrides(baseCriteria, new UTSearchCriteriaDTO(), {
            league: league,
          }),
        );
      });
      break;
    case SBCEligibilityKey.NATION_ID:
      requirementValues.forEach((nation) => {
        criteriaList.push(
          copyWithOverrides(baseCriteria, new UTSearchCriteriaDTO(), {
            nation: nation,
          }),
        );
      });
      break;
    case SBCEligibilityKey.CLUB_ID:
      requirementValues.forEach((club) => {
        criteriaList.push(
          copyWithOverrides(baseCriteria, new UTSearchCriteriaDTO(), {
            club: club,
          }),
        );
      });
  }
  return criteriaList;
}

function isSmartBuilderRequirementMet(requirement, players, squadSize) {
  if (
    -1 === requirement.count &&
    requirement.keyValue !== SBCEligibilityKey.TEAM_RATING &&
    requirement.keyValue !== SBCEligibilityKey.PLAYER_QUALITY
  ) {
    return players.every((player) => requirement.satifiesRequirement(player));
  }
  switch (requirement.keyValue) {
    case SBCEligibilityKey.TEAM_RATING:
      return (
        SquadRatingCalculator.getRating(
          players.map((player) => player.rating),
          squadSize,
        ) >= requirement.value
      );
    case SBCEligibilityKey.SAME_NATION_COUNT:
    case SBCEligibilityKey.SAME_LEAGUE_COUNT:
    case SBCEligibilityKey.SAME_CLUB_COUNT: {
      const groups = requirement.group(players);
      const groupSizes = Object.values(groups).map((group) => group.length);
      return (groupSizes.length ? Math.max(...groupSizes) : 0) >= requirement.count;
    }
    case SBCEligibilityKey.NATION_COUNT:
    case SBCEligibilityKey.LEAGUE_COUNT:
    case SBCEligibilityKey.CLUB_COUNT:
      return Object.keys(requirement.group(players)).length >= requirement.count;
    default:
      return (
        players.filter((player) => requirement.satifiesRequirement(player)).length >=
        requirement.count
      );
  }
}

function isSmartBuilderSquadValid(challenge, requirements, players) {
  const squadSize = getSbcRequiredPlayerCount(challenge);
  if (players.length < squadSize) {
    return false;
  }
  const squadPlayers = players.slice(0, squadSize);
  return (
    new Set(squadPlayers.map(getSbcPlayerIdentityKey)).size === squadPlayers.length &&
    requirements.all.every((requirement) =>
      isSmartBuilderRequirementMet(requirement, squadPlayers, squadSize),
    )
  );
}

function addSmartBuilderPlayerIfUnique(player, selectedPlayers, selectedPlayerKeys) {
  const playerKey = getSbcPlayerIdentityKey(player);
  return (
    !selectedPlayerKeys.has(playerKey) &&
    (selectedPlayerKeys.add(playerKey), selectedPlayers.push(player), true)
  );
}

function getSmartBuilderRequirementShortfall(requirement, selectedPlayers) {
  if (requirement.canGroup) {
    const groups = requirement.group(selectedPlayers);
    const groupSizes = Object.values(groups).map((group) => group.length);
    const largestGroupSize = groupSizes.length ? Math.max(...groupSizes) : 0;
    return Math.max(0, requirement.count - largestGroupSize);
  }
  const matchingCount = selectedPlayers.filter((player) =>
    requirement.satifiesRequirement(player),
  ).length;
  return Math.max(0, requirement.count - matchingCount);
}

function getSmartBuilderLargestRequirementGroup(requirement, players, comparePlayers) {
  const groups = requirement.group(players);
  return (
    Object.values(groups).sort((left, right) =>
      right.length !== left.length ? right.length - left.length : comparePlayers(left[0], right[0]),
    )[0] || []
  );
}

function fillSmartBuilderSquad(candidates, selectedPlayers, selectedPlayerKeys, squadSize) {
  for (const player of candidates) {
    if (selectedPlayers.length >= squadSize) {
      break;
    }
    addSmartBuilderPlayerIfUnique(player, selectedPlayers, selectedPlayerKeys);
  }
}

export function getSbcItemInstanceKey(item) {
  return item?.id != null
    ? "id:" + item.id
    : item?.itemData?.id != null
      ? "item:" + item.itemData.id
      : getSbcPlayerIdentityKey(item);
}

function getSbcPlayerIdentityKey(item) {
  const definitionId = getSbcItemDefinitionId(item);
  const databaseId = item?.databaseId;
  return Number.isInteger(databaseId) && databaseId > 0
    ? "db:" + databaseId
    : Number.isInteger(definitionId)
      ? "db:" + (definitionId & ItemIdMask.DATABASE)
      : (function (fallbackItem) {
          return "def:" + getSbcItemDefinitionId(fallbackItem);
        })(item);
}

function getSbcItemDefinitionId(item) {
  return item?.definitionId ?? item?.itemData?.definitionId;
}

async function computeSmartBuilderSquad(challenge, builderConfig) {
  const requirements = (function (sbcChallenge) {
    const requirementsByKey = {};
    const parsedRequirements = {
      get: (key) => requirementsByKey[key],
      has: (key) => !!requirementsByKey[key],
    };
    parsedRequirements.and = sbcChallenge.eligibilityOperation === SBCEligibilityOperation.AND;
    parsedRequirements.or = sbcChallenge.eligibilityOperation === SBCEligibilityOperation.OR;
    parsedRequirements.all = [];
    parsedRequirements.counted = [];
    parsedRequirements.uncounted = [];
    for (let requirement of sbcChallenge.eligibilityRequirements.map(
      (eligibilityRequirement) => new SbcEligibilityRequirement(eligibilityRequirement),
    )) {
      if (requirement.keyValue !== SBCEligibilityKey.CHEMISTRY_POINTS) {
        if (requirement.count > -1) {
          parsedRequirements.counted.push(requirement);
        } else {
          parsedRequirements.uncounted.push(requirement);
        }
        parsedRequirements.all.push(requirement);
        requirementsByKey[requirement.keyValue] = requirement;
      }
    }
    parsedRequirements.count = parsedRequirements.all.length;
    return parsedRequirements;
  })(challenge);
  const includeConceptPlayers = builderConfig.includeConceptPlayers;
  const teamRatingRequirement = requirements.get(SBCEligibilityKey.TEAM_RATING);
  const squadSize = getSbcRequiredPlayerCount(challenge);
  let preferRegularPlayers = true;
  if (
    (function (requirements) {
      return requirements.all.some(
        (requirement) =>
          requirement.keyValue === SBCEligibilityKey.PLAYER_RARITY ||
          requirement.keyValue === SBCEligibilityKey.PLAYER_RARITY_GROUP,
      );
    })(requirements) ||
    builderConfig.allowSpecialCards
  ) {
    preferRegularPlayers = false;
  }
  await getOrLoadClubIndexPlayers();
  const searchCriteria = (function (searchCriteria, requirements) {
    for (const requirement of requirements.uncounted) {
      switch (requirement.keyValue) {
        case SBCEligibilityKey.PLAYER_QUALITY:
        case SBCEligibilityKey.PLAYER_LEVEL:
          searchCriteria.level = SearchLevel[ItemRatingTier[requirement.value]];
          break;
        case SBCEligibilityKey.PLAYER_RARITY:
          searchCriteria.rarities = Array.isArray(requirement.value)
            ? requirement.value
            : [requirement.value];
          break;
        case SBCEligibilityKey.PLAYER_TRADABILITY:
          searchCriteria._untradeables = requirement.value ? "false" : "true";
          break;
        case SBCEligibilityKey.PLAYER_MIN_OVR:
          searchCriteria.ovrMin = Math.max(searchCriteria.ovrMin ?? minOvr, requirement.value);
          break;
        case SBCEligibilityKey.PLAYER_MAX_OVR:
          searchCriteria.ovrMax = Math.min(searchCriteria.ovrMax ?? maxOvr, requirement.value);
          break;
        case SBCEligibilityKey.LEAGUE_ID:
          searchCriteria.league = requirement.value;
          break;
        case SBCEligibilityKey.NATION_ID:
          searchCriteria.nation = requirement.value;
          break;
        case SBCEligibilityKey.CLUB_ID:
          searchCriteria.club = requirement.value;
      }
    }
    return searchCriteria;
  })(
    (function (builderConfig, teamRatingRequirement = null) {
      const criteria = new UTSearchCriteriaDTO();
      criteria.type = SearchType.PLAYER;
      criteria.sortBy = SearchSortType.RATING;
      criteria.sort = SearchSortOrder.ASCENDING;
      if (builderConfig.untradeablesOnly) {
        criteria.untradeables = "true";
      }
      if (builderConfig.ovrMin > minOvr) {
        criteria.ovrMin = builderConfig.ovrMin;
      }
      if (builderConfig.ovrMax < maxOvr) {
        criteria.ovrMax = builderConfig.ovrMax;
      }
      if (teamRatingRequirement) {
        criteria.teamRating = teamRatingRequirement.value;
        criteria.ovrMin = Math.max(
          criteria.ovrMin ?? minOvr,
          teamRatingRequirement.value - teamRatingCandidateRangeBelow,
        );
        criteria.ovrMax = Math.min(
          criteria.ovrMax ?? maxOvr,
          teamRatingRequirement.value + teamRatingCandidateRangeAbove,
        );
      }
      return criteria;
    })(builderConfig, teamRatingRequirement),
    requirements,
  );
  const activeSquadDefinitionIds = new Set(await fetchActiveSquadDefinitionIds());
  const excludedPlayerKeys = new Set(builderConfig.excludedPlayerKeys || []);
  const isEligibleCandidate = (function (
    searchCriteria,
    builderConfig,
    activeSquadDefinitionIds,
    excludedPlayerKeys,
  ) {
    const minRating = searchCriteria.ovrMin ?? minOvr;
    const maxRating = searchCriteria.ovrMax ?? maxOvr;
    return (player) =>
      !(
        !player ||
        player.loans > -1 ||
        player.isLimitedUse() ||
        player.rating < minRating ||
        player.rating > maxRating ||
        (!isSbcStorageItem(player) && isItemLocked(player)) ||
        (activeSquadDefinitionIds.has(player.definitionId) && !isSbcStorageItem(player)) ||
        (builderConfig.ignoreEvolutions && player.upgrades) ||
        (builderConfig.storageOnly && !isSbcStorageItem(player)) ||
        (builderConfig.ignoreSingleRevisionPlayers &&
          player.rareflag > 1 &&
          getClubIndexRevisionCount(player) <= 1) ||
        (builderConfig.untradeablesOnly && player.tradable) ||
        excludedPlayerKeys.has(getSbcItemInstanceKey(player))
      );
  })(searchCriteria, builderConfig, activeSquadDefinitionIds, excludedPlayerKeys);
  const comparePlayers = (left, right) =>
    (function (left, right, preferStorage = false) {
      if (preferStorage) {
        const storageDifference = Number(isSbcStorageItem(right)) - Number(isSbcStorageItem(left));
        if (storageDifference !== 0) {
          return storageDifference;
        }
      }
      const rarityDifference = getSmartBuilderRarityRank(left) - getSmartBuilderRarityRank(right);
      if (rarityDifference !== 0) {
        return rarityDifference;
      }
      const ratingDifference = left.rating - right.rating;
      if (ratingDifference !== 0) {
        return ratingDifference;
      }
      if (!preferStorage) {
        const storageDifference = Number(isSbcStorageItem(right)) - Number(isSbcStorageItem(left));
        if (storageDifference !== 0) {
          return storageDifference;
        }
      }
      const tradableDifference = Number(left.tradable) - Number(right.tradable);
      if (tradableDifference !== 0) {
        return tradableDifference;
      }
      const marketAverageDifference =
        (left.getMarketAverage?.() ?? 0) - (right.getMarketAverage?.() ?? 0);
      return marketAverageDifference !== 0
        ? marketAverageDifference
        : left.definitionId - right.definitionId;
    })(left, right, builderConfig.preferStorage === true);
  const indexedClubPlayers = getClubIndexPlayers();
  const storagePlayers =
    builderConfig.useStorage || builderConfig.storageOnly
      ? await fetchSbcStorageItems(searchCriteria)
      : [];
  let candidates = (
    builderConfig.storageOnly
      ? storagePlayers
      : uniqueBy(
          builderConfig.preferStorage
            ? [...storagePlayers, ...indexedClubPlayers]
            : [...indexedClubPlayers, ...storagePlayers],
          getSbcItemInstanceKey,
        )
  )
    .filter(isEligibleCandidate)
    .filter((player) =>
      (function (player, requirements) {
        return requirements.uncounted.every((requirement) =>
          requirement.satifiesRequirement(player),
        );
      })(player, requirements),
    );
  candidates = (function (candidates, requirements, builderConfig) {
    const importantLeagueIds = new Set(getImportantLeagueIds());
    const importantNationIds = new Set(getImportantNationIds());
    return candidates.filter(
      (player) =>
        !(
          (!builderConfig.useStorage || !isSbcStorageItem(player)) &&
          ((builderConfig.ignoreImportantLeagues &&
            !requirements.has(SBCEligibilityKey.LEAGUE_ID) &&
            importantLeagueIds.has(player.leagueId)) ||
            (builderConfig.ignoreImportantNations &&
              !requirements.has(SBCEligibilityKey.NATION_ID) &&
              importantNationIds.has(player.nationId)))
        ),
    );
  })(candidates, requirements, builderConfig);
  candidates = uniqueBy(candidates.sort(comparePlayers), getSbcPlayerIdentityKey);
  const candidatePools = (function (candidates, requirements, comparePlayers) {
    const requirementPools = new Map();
    for (const requirement of requirements.counted) {
      const poolKey =
        requirement.keyValue +
        ":" +
        requirement.count +
        ":" +
        (requirement.hasMultipleValues
          ? Array.from(requirement.value).join(",")
          : requirement.value);
      requirementPools.set(
        poolKey,
        candidates.filter((player) => requirement.satifiesRequirement(player)).sort(comparePlayers),
      );
    }
    return {
      regular: candidates.filter(isSmartBuilderCommonOrRareCard).sort(comparePlayers),
      special: candidates
        .filter((player) => !isSmartBuilderCommonOrRareCard(player))
        .sort(comparePlayers),
      requirementPools: requirementPools,
    };
  })(candidates, requirements, comparePlayers);
  let hasConceptPlayers = false;
  const selectedPlayers = [];
  const selectedPlayerKeys = new Set();
  hasConceptPlayers = await (async function (
    requirements,
    candidatePools,
    selectedPlayers,
    selectedPlayerKeys,
    squadSize,
    includeConceptPlayers,
    searchCriteria,
    isEligibleCandidate,
    comparePlayers,
  ) {
    let addedConceptPlayer = false;
    const countedRequirements = requirements.counted
      .filter((requirement) => requirement.count > 0)
      .sort((left, right) => {
        const isLeftRarityRequirement =
          left.keyValue === SBCEligibilityKey.PLAYER_RARITY ||
          left.keyValue === SBCEligibilityKey.PLAYER_RARITY_GROUP;
        return isLeftRarityRequirement !==
          (right.keyValue === SBCEligibilityKey.PLAYER_RARITY ||
            right.keyValue === SBCEligibilityKey.PLAYER_RARITY_GROUP)
          ? isLeftRarityRequirement
            ? -1
            : 1
          : right.count - left.count;
      });
    for (const requirement of countedRequirements) {
      if (selectedPlayers.length >= squadSize) {
        break;
      }
      const poolKey =
        requirement.keyValue +
        ":" +
        requirement.count +
        ":" +
        (requirement.hasMultipleValues
          ? Array.from(requirement.value).join(",")
          : requirement.value);
      const pool = candidatePools.requirementPools.get(poolKey) || [];
      const orderedPool = requirement.canGroup
        ? getSmartBuilderLargestRequirementGroup(requirement, pool, comparePlayers)
        : pool;
      let missingCount = getSmartBuilderRequirementShortfall(requirement, selectedPlayers);
      for (const player of orderedPool) {
        if (missingCount <= 0 || selectedPlayers.length >= squadSize) {
          break;
        }
        if (addSmartBuilderPlayerIfUnique(player, selectedPlayers, selectedPlayerKeys)) {
          missingCount--;
        }
      }
      if (missingCount <= 0 || !includeConceptPlayers || selectedPlayers.length >= squadSize) {
        continue;
      }
      const conceptPlayers = [];
      const conceptSearchCriteria = buildSmartBuilderRequirementSearchCriteria(
        searchCriteria,
        requirement,
      );
      for (const criteria of conceptSearchCriteria) {
        criteria.type = SearchType.PLAYER;
        criteria.sortBy = SearchSortType.RATING;
        criteria.sort = SearchSortOrder.ASCENDING;
        const foundPlayers = (await searchConceptItemsPaged(criteria, 3))
          .filter(isEligibleCandidate)
          .filter((player) => requirement.satifiesRequirement(player))
          .sort(comparePlayers);
        conceptPlayers.push(...foundPlayers);
      }
      for (const player of uniqueBy(conceptPlayers, getSbcPlayerIdentityKey)) {
        if (missingCount <= 0 || selectedPlayers.length >= squadSize) {
          break;
        }
        if (addSmartBuilderPlayerIfUnique(player, selectedPlayers, selectedPlayerKeys)) {
          missingCount--;
          addedConceptPlayer = true;
        }
      }
    }
    return addedConceptPlayer;
  })(
    requirements,
    candidatePools,
    selectedPlayers,
    selectedPlayerKeys,
    squadSize,
    includeConceptPlayers,
    searchCriteria,
    isEligibleCandidate,
    comparePlayers,
  );
  if (
    !(function (requirements, players, squadSize) {
      return requirements.counted
        .filter((requirement) => requirement.count > 0)
        .every((requirement) => isSmartBuilderRequirementMet(requirement, players, squadSize));
    })(requirements, selectedPlayers, squadSize)
  ) {
    return {
      success: false,
      players: selectedPlayers.slice(),
      hasConceptPlayers: hasConceptPlayers,
      meetsRequirements: false,
      count: selectedPlayers.length,
      reason: "Unable to satisfy counted SBC requirements before completing the squad",
    };
  }
  let candidatePool = preferRegularPlayers ? candidatePools.regular.slice() : candidates.slice();
  if (teamRatingRequirement) {
    let ratingSquad = await fillSquadToReachTeamRating(
      candidatePool,
      teamRatingRequirement.value,
      selectedPlayers.slice(),
      squadSize,
      false,
      comparePlayers,
      getSbcPlayerIdentityKey,
    );
    if (
      (ratingSquad.length < squadSize ||
        !isSmartBuilderSquadValid(challenge, requirements, ratingSquad)) &&
      candidatePools.special.length > 0 &&
      !preferRegularPlayers
    ) {
      candidatePool = uniqueBy(
        [...candidatePool, ...candidatePools.special].sort(comparePlayers),
        getSbcPlayerIdentityKey,
      );
      ratingSquad = await fillSquadToReachTeamRating(
        candidatePool,
        teamRatingRequirement.value,
        selectedPlayers.slice(),
        squadSize,
        true,
        comparePlayers,
        getSbcPlayerIdentityKey,
      );
    }
    const squadPlayers = uniqueBy(ratingSquad, getSbcPlayerIdentityKey).slice(0, squadSize);
    const isSquadValid = isSmartBuilderSquadValid(challenge, requirements, squadPlayers);
    return {
      success: isSquadValid,
      players: squadPlayers,
      hasConceptPlayers: hasConceptPlayers,
      meetsRequirements: isSquadValid,
      count: squadPlayers.length,
      reason: isSquadValid ? null : "No squad found that meets the SBC requirements",
    };
  }
  fillSmartBuilderSquad(candidatePool, selectedPlayers, selectedPlayerKeys, squadSize);
  if (selectedPlayers.length < squadSize && preferRegularPlayers) {
    fillSmartBuilderSquad(candidatePools.special, selectedPlayers, selectedPlayerKeys, squadSize);
  }
  const players = uniqueBy(selectedPlayers, getSbcPlayerIdentityKey).slice(0, squadSize);
  const success = isSmartBuilderSquadValid(challenge, requirements, players);
  return {
    success: success,
    players: players,
    hasConceptPlayers: hasConceptPlayers,
    meetsRequirements: success,
    count: players.length,
    reason: success ? null : "No squad found that meets the SBC requirements",
  };
}

export async function buildSmartBuilderSquad(challenge, builderConfig) {
  const solution = await computeSmartBuilderSquad(challenge, builderConfig);
  if (!solution.success || solution.hasConceptPlayers) {
    return solution;
  }
  const solutionDefinitionIds = solution.players.map((player) => player.definitionId);
  const staleDefinitionIds = await (async function (definitionIds) {
    const uniqueDefinitionIds = [...new Set(definitionIds || [])];
    if (!uniqueDefinitionIds.length) {
      return [];
    }
    const searchCriteria = new UTItemSearchViewModel().searchCriteria;
    searchCriteria.count = uniqueDefinitionIds.length;
    searchCriteria.type = SearchType.PLAYER;
    searchCriteria.defId = uniqueDefinitionIds;
    searchCriteria.sortBy = SearchSortType.RATING;
    searchCriteria.sort = SearchSortOrder.ASCENDING;
    const searchResponse = await observableToPromise(services.Club.search(searchCriteria));
    if (!searchResponse.success) {
      return [];
    }
    const ownedDefinitionIds = new Set(
      searchResponse.response.items
        .filter((item) => item.type === ItemType.PLAYER && item.loans < 0)
        .map((item) => item.definitionId),
    );
    const missingDefinitionIds = uniqueDefinitionIds.filter(
      (definitionId) => !ownedDefinitionIds.has(definitionId),
    );
    if (!missingDefinitionIds.length) {
      return [];
    }
    const missingDefinitionIdSet = new Set(missingDefinitionIds);
    for (const [indexKey, indexedItem] of clubIndexPlayersByItemKey.entries()) {
      if (missingDefinitionIdSet.has(indexedItem.definitionId)) {
        deleteClubIndexPlayer(indexKey);
      }
    }
    return missingDefinitionIds;
  })(solutionDefinitionIds);
  return staleDefinitionIds.length ? computeSmartBuilderSquad(challenge, builderConfig) : solution;
}
