/**
 * `SbcEligibilityRequirement` wraps one EA SBC eligibility requirement and exposes read-only
 * descriptors (`key` = `SBCEligibilityKey[firstKey]`, `keyValue`, `scope`, `count`, `value`,
 * `hasMultipleValues`, `canGroup`/`canFilter`, `sameCount`, `isExact`/`isLower`/`isGreater`,
 * `isCombined`) plus the `satifiesRequirement`, `group` and `filter` helpers. Instantiated by
 * src/sbc/smart-builder-solver.js for every requirement of a challenge.
 *
 * Invariants:
 * - Descriptors are defined with `Object.defineProperty` and are non-writable except `enabled`.
 *   `value` is a `Set` when the requirement has several values, otherwise the first value.
 * - For the count keys (SAME_NATION/LEAGUE/CLUB_COUNT and NATION/LEAGUE/CLUB_COUNT) `count` is
 *   the requirement's first value; for all other keys it is the EA `requirement.count`.
 * - The method name `satifiesRequirement` (sic) is called by the smart builder solver: rename it
 *   everywhere or nowhere. It returns false for the count keys and for unknown keys.
 * - TEAM_RATING accepts ratings within `teamRatingCandidateRangeBelow/Above` of the target. Those
 *   constants come from src/sbc/rating-solver.js, which the manifest places after this module, so
 *   they may only be read lazily inside methods, never at module evaluation.
 * - `group()` returns `{}` when `canGroup` is false; `_requirement` exposes the wrapped object.
 */
import { groupBy } from "../core/collections.js";
import { teamRatingCandidateRangeAbove, teamRatingCandidateRangeBelow } from "./rating-solver.js";
import { rarityIdsByGroupId } from "../webapp/rarities.js";

export class SbcEligibilityRequirement {
  #u;
  constructor(requirement) {
    this.#u = requirement;
    Object.defineProperty(this, "key", {
      value: SBCEligibilityKey[this.#u.getFirstKey()],
      writable: false,
    });
    Object.defineProperty(this, "keyValue", {
      value: requirement.getFirstKey(),
      writable: false,
    });
    Object.defineProperty(this, "scope", {
      value: requirement.scope,
      writable: false,
    });
    Object.defineProperty(this, "canGroup", {
      value:
        requirement.getFirstKey() === SBCEligibilityKey.SAME_NATION_COUNT ||
        requirement.getFirstKey() === SBCEligibilityKey.SAME_LEAGUE_COUNT ||
        requirement.getFirstKey() === SBCEligibilityKey.SAME_CLUB_COUNT ||
        requirement.getFirstKey() === SBCEligibilityKey.NATION_COUNT ||
        requirement.getFirstKey() === SBCEligibilityKey.LEAGUE_COUNT ||
        requirement.getFirstKey() === SBCEligibilityKey.CLUB_COUNT,
      writable: false,
    });
    Object.defineProperty(this, "canFilter", {
      value:
        requirement.getFirstKey() === SBCEligibilityKey.SAME_NATION_COUNT ||
        requirement.getFirstKey() === SBCEligibilityKey.SAME_LEAGUE_COUNT ||
        requirement.getFirstKey() === SBCEligibilityKey.SAME_CLUB_COUNT ||
        requirement.getFirstKey() === SBCEligibilityKey.NATION_COUNT ||
        requirement.getFirstKey() === SBCEligibilityKey.LEAGUE_COUNT ||
        requirement.getFirstKey() === SBCEligibilityKey.CLUB_COUNT,
      writable: false,
    });
    Object.defineProperty(this, "sameCount", {
      value:
        requirement.getFirstKey() === SBCEligibilityKey.SAME_NATION_COUNT ||
        requirement.getFirstKey() === SBCEligibilityKey.SAME_LEAGUE_COUNT ||
        requirement.getFirstKey() === SBCEligibilityKey.SAME_CLUB_COUNT,
      writable: false,
    });
    Object.defineProperty(this, "count", {
      value:
        requirement.getFirstKey() === SBCEligibilityKey.SAME_NATION_COUNT ||
        requirement.getFirstKey() === SBCEligibilityKey.SAME_LEAGUE_COUNT ||
        requirement.getFirstKey() === SBCEligibilityKey.SAME_CLUB_COUNT ||
        requirement.getFirstKey() === SBCEligibilityKey.NATION_COUNT ||
        requirement.getFirstKey() === SBCEligibilityKey.LEAGUE_COUNT ||
        requirement.getFirstKey() === SBCEligibilityKey.CLUB_COUNT
          ? requirement.getFirstValue(requirement.getFirstKey())
          : requirement.count,
      writable: false,
    });
    Object.defineProperty(this, "isExact", {
      value: requirement.scope === SBCEligibilityScope.EXACT,
      writable: false,
    });
    Object.defineProperty(this, "isLower", {
      value: requirement.scope === SBCEligibilityScope.LOWER,
      writable: false,
    });
    Object.defineProperty(this, "isGreater", {
      value: requirement.scope === SBCEligibilityScope.GREATER,
      writable: false,
    });
    Object.defineProperty(this, "isCombined", {
      value: requirement.isCombinedRequirement,
      writable: false,
    });
    Object.defineProperty(this, "value", {
      value:
        requirement.getValue(requirement.getFirstKey()).length > 1
          ? new Set(requirement.getValue(requirement.getFirstKey()))
          : requirement.getFirstValue(requirement.getFirstKey()),
      writable: false,
    });
    Object.defineProperty(this, "hasMultipleValues", {
      value: requirement.getValue(requirement.getFirstKey()).length > 1,
      writable: false,
    });
    Object.defineProperty(this, "enabled", {
      value: true,
      writable: true,
    });
  }
  ["satifiesRequirement"](player) {
    switch (this.keyValue) {
      case SBCEligibilityKey.CLUB_ID:
        return this.hasMultipleValues
          ? this.value.has(player.teamId)
          : player.teamId === this.value;
      case SBCEligibilityKey.FIRST_OWNER_PLAYERS_COUNT:
        return player.owners === 0;
      case SBCEligibilityKey.LEAGUE_ID:
        return this.hasMultipleValues
          ? this.value.has(player.leagueId)
          : player.leagueId === this.value;
      case SBCEligibilityKey.NATION_ID:
        return this.hasMultipleValues
          ? this.value.has(player.nationId)
          : player.nationId === this.value;
      case SBCEligibilityKey.PLAYER_EXACT_OVR:
        return this.hasMultipleValues
          ? this.value.has(player.rating)
          : player.rating === this.value;
      case SBCEligibilityKey.PLAYER_LEVEL:
      case SBCEligibilityKey.PLAYER_QUALITY:
        return player.hasQualityTiers() && player.getTier() === this.value;
      case SBCEligibilityKey.PLAYER_MAX_OVR:
        return player.rating <= this.value;
      case SBCEligibilityKey.PLAYER_MIN_OVR:
        return player.rating >= this.value;
      case SBCEligibilityKey.PLAYER_RARITY:
        return this.hasMultipleValues
          ? this.value.has(player.rareflag)
          : player.rareflag === this.value;
      case SBCEligibilityKey.PLAYER_RARITY_GROUP:
        return (
          player.belongsToGroup(this.value) || rarityIdsByGroupId[this.value]?.has(player.rareflag)
        );
      case SBCEligibilityKey.PLAYER_TRADABILITY:
        return player.tradable === this.value;
      case SBCEligibilityKey.TEAM_RATING:
        return (
          player.rating >= this.value - teamRatingCandidateRangeBelow &&
          player.rating <= this.value + teamRatingCandidateRangeAbove
        );
    }
    return false;
  }
  ["group"](players, valueSelector = null) {
    if (!this.canGroup) {
      return {};
    }
    let keySelector = null;
    switch (this.keyValue) {
      case SBCEligibilityKey.SAME_NATION_COUNT:
      case SBCEligibilityKey.NATION_COUNT:
        keySelector = (player) => player.nationId;
        break;
      case SBCEligibilityKey.SAME_LEAGUE_COUNT:
      case SBCEligibilityKey.LEAGUE_COUNT:
        keySelector = (player) => player.leagueId;
        break;
      case SBCEligibilityKey.SAME_CLUB_COUNT:
      case SBCEligibilityKey.CLUB_COUNT:
        keySelector = (player) => player.teamId;
    }
    return groupBy(players, keySelector, valueSelector);
  }
  ["filter"](players) {
    if (!this.canFilter) {
      return players;
    }
    let predicate = null;
    switch (this.keyValue) {
      case SBCEligibilityKey.SAME_NATION_COUNT:
      case SBCEligibilityKey.NATION_COUNT:
        predicate = (player) => player.nationId == this.value;
        break;
      case SBCEligibilityKey.SAME_LEAGUE_COUNT:
      case SBCEligibilityKey.LEAGUE_COUNT:
        predicate = (player) => player.leagueId == this.value;
        break;
      case SBCEligibilityKey.SAME_CLUB_COUNT:
      case SBCEligibilityKey.CLUB_COUNT:
        predicate = (player) => player.teamId == this.value;
    }
    return players.filter(predicate);
  }
  get ["_requirement"]() {
    return this.#u;
  }
}
