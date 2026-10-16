/**
 * Gallery scoring helpers used by the gallery controller and view: per-card score, bonus-rule
 * filtering and best-card auto-selection.
 *
 * Invariants:
 * - `getGalleryItemScore` uses `item.gradingScore` when it is a positive number, otherwise
 *   `galleryPointsByRating[rating]`, flagged `estimated` when missing or when `rareflag > 1`.
 * - Rule attributes (NATION, CLUB, LEAGUEID, RARE, BASE_DEF_ID, LEVEL, FIRST_OWNED,
 *   HYPER_COSMETIC_TYPE, WEAK_FOOT, SKILL_MOVES, POSSIBLE_POSITIONS) and rule types
 *   (MAX_COUNT_ALL_SAME, COUNT_DIFF, MIN_COUNT, otherwise value match) are the vocabulary of the
 *   bundled gallery data and must stay identical. LEVEL: < 65 bronze, < 75 silver, else gold.
 * - `pickBestGalleryCardIds` orders tracked entries by score, first owner, rating, definitionId
 *   and keeps `requiredItems` of them.
 *
 * Known issues (kept as-is):
 * - `pickBestGalleryCardIds` also accepts `status === "owned"`, which `createAlbumEntries` never
 *   produces (dead branch).
 */
import { galleryPointsByRating } from "./points-by-rating.js";

export function getGalleryItemScore(item) {
  const score = Number(item.gradingScore);
  return Number.isFinite(score) && score > 0
    ? {
        score: score,
        estimated: false,
      }
    : {
        score: galleryPointsByRating[item.rating] || 0,
        estimated: Number(item.rareflag) > 1 || !galleryPointsByRating[item.rating],
      };
}

function getGalleryRuleAttribute(item, attribute) {
  switch (attribute) {
    case "NATION":
      return item.nationId;
    case "CLUB":
      return item.teamId;
    case "LEAGUEID":
      return item.leagueId;
    case "RARE":
      return item.rareflag;
    case "BASE_DEF_ID":
      return item.databaseId ?? item.definitionId & ItemIdMask.DATABASE;
    case "LEVEL":
      return item.rating < 65 ? "bronze" : item.rating < 75 ? "silver" : "gold";
    case "FIRST_OWNED":
      return item.concept || item.isConceptPlayer || item.owners !== 1 ? 0 : 1;
    case "HYPER_COSMETIC_TYPE":
      return item.getFoilSubtype?.() ?? -1;
    case "WEAK_FOOT":
      return item.getWeakFoot?.() ?? item._weakFoot;
    case "SKILL_MOVES":
      return item.getSkillMoves?.() ?? item._skillMoves;
    case "POSSIBLE_POSITIONS":
      return (item.possiblePositions || [item.preferredPosition]).map((position) =>
        typeof position === "number" ? PlayerPosition[position] : position,
      );
    default:
      return;
  }
}

export function applyGalleryBonusRule(items, rule) {
  const ruleValues = rule.values.map(String);
  if (rule.type === "MAX_COUNT_ALL_SAME" || rule.type === "COUNT_DIFF") {
    const itemsByAttributeValue = new Map();
    for (const item of items) {
      const attributeValue = getGalleryRuleAttribute(item, rule.attribute);
      if (attributeValue == null || Number(attributeValue) < 0) {
        continue;
      }
      const groupKey = String(attributeValue);
      if (!itemsByAttributeValue.has(groupKey)) {
        itemsByAttributeValue.set(groupKey, []);
      }
      itemsByAttributeValue.get(groupKey).push(item);
    }
    const sumScores = (group) =>
      group.reduce((total, item) => total + getGalleryItemScore(item).score, 0);
    return rule.type === "COUNT_DIFF"
      ? [...itemsByAttributeValue.values()].map(
          (group) =>
            group
              .slice()
              .sort(
                (left, right) => getGalleryItemScore(right).score - getGalleryItemScore(left).score,
              )[0],
        )
      : [...itemsByAttributeValue.values()].sort(
          (left, right) => right.length - left.length || sumScores(right) - sumScores(left),
        )[0] || [];
  }
  return items.filter((item) => {
    const attributeValue = getGalleryRuleAttribute(item, rule.attribute);
    return (
      attributeValue != null &&
      (rule.type === "MIN_COUNT"
        ? Number(attributeValue) >= Number(rule.values[0])
        : (Array.isArray(attributeValue) ? attributeValue : [attributeValue]).some(
            (candidateValue) => ruleValues.includes(String(candidateValue)),
          ))
    );
  });
}

export function pickBestGalleryCardIds(gallerySet, albumEntries) {
  return albumEntries
    .filter((entry) => entry.status === "owned" || entry.tracked)
    .sort(
      (left, right) =>
        getGalleryItemScore(right.item).score - getGalleryItemScore(left.item).score ||
        (right.item.owners === 1) - (left.item.owners === 1) ||
        right.item.rating - left.item.rating ||
        left.item.definitionId - right.item.definitionId,
    )
    .slice(0, gallerySet.requiredItems)
    .map((entry) => entry.item.definitionId);
}
