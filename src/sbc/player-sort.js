/**
 * Configurable multi-criteria comparator for squad candidates (`compareItemsBySortOptions`).
 * Imported by src/sbc/rating-solver.js as the default `comparePlayers` of
 * `fillSquadToReachTeamRating`.
 *
 * Invariants:
 * - Criteria names are `storage`, `tradable`, `rarity`, `rating` and `marketAvg`; each option is
 *   `{enabled, order}` (defaults: enabled, `SearchSortOrder.ASCENDING`) and `sortOrder` lists the
 *   five names by priority (default `defaultItemSortOrder`).
 * - The options object is normalized in place. Used directly as an `Array#sort` comparator (no
 *   third argument) the defaults apply: SBC-storage items first, then untradeable items, then
 *   lower `rareflag`, lower rating, lower `getMarketAverage()`.
 * - `compareItemsByCriterion` returns `undefined` on a tie so the next criterion decides; items
 *   equal on every enabled criterion compare as 0.
 *
 * Known issues (kept as-is):
 * - The guard `(!sortOptions.sortOrder) instanceof Array` is always false (operator precedence),
 *   so any `sortOrder` with five entries is accepted, even one that is not an array.
 */
import { isSbcStorageItem } from "../webapp/item-piles.js";

const defaultItemSortOrder = ["storage", "tradable", "rarity", "rating", "marketAvg"];

export function compareItemsBySortOptions(left, right, sortOptions) {
  if (
    !(sortOptions = sortOptions || {}).sortOrder ||
    (!sortOptions.sortOrder) instanceof Array ||
    sortOptions.sortOrder.length !== defaultItemSortOrder.length
  ) {
    sortOptions.sortOrder = defaultItemSortOrder;
  }
  sortOptions.storage = normalizeSortCriterion(sortOptions.storage);
  sortOptions.tradable = normalizeSortCriterion(sortOptions.tradable);
  sortOptions.rarity = normalizeSortCriterion(sortOptions.rarity);
  sortOptions.rating = normalizeSortCriterion(sortOptions.rating);
  sortOptions.marketAvg = normalizeSortCriterion(sortOptions.marketAvg);
  let comparison;
  let criterion = "";
  criterion = sortOptions.sortOrder[0];
  if (
    sortOptions[criterion].enabled &&
    ((comparison = compareItemsByCriterion(
      criterion,
      left,
      right,
      sortOptions[criterion].order === SearchSortOrder.ASCENDING,
    )),
    comparison !== undefined)
  ) {
    return comparison;
  } else {
    criterion = sortOptions.sortOrder[1];
    if (
      sortOptions[criterion].enabled &&
      ((comparison = compareItemsByCriterion(
        criterion,
        left,
        right,
        sortOptions[criterion].order === SearchSortOrder.ASCENDING,
      )),
      comparison !== undefined)
    ) {
      return comparison;
    } else {
      criterion = sortOptions.sortOrder[2];
      if (
        sortOptions[criterion].enabled &&
        ((comparison = compareItemsByCriterion(
          criterion,
          left,
          right,
          sortOptions[criterion].order === SearchSortOrder.ASCENDING,
        )),
        comparison !== undefined)
      ) {
        return comparison;
      } else {
        criterion = sortOptions.sortOrder[3];
        if (
          sortOptions[criterion].enabled &&
          ((comparison = compareItemsByCriterion(
            criterion,
            left,
            right,
            sortOptions[criterion].order === SearchSortOrder.ASCENDING,
          )),
          comparison !== undefined)
        ) {
          return comparison;
        } else {
          criterion = sortOptions.sortOrder[4];
          return sortOptions[criterion].enabled &&
            ((comparison = compareItemsByCriterion(
              criterion,
              left,
              right,
              sortOptions[criterion].order === SearchSortOrder.ASCENDING,
            )),
            comparison !== undefined)
            ? comparison
            : 0;
        }
      }
    }
  }
}

function normalizeSortCriterion(criterionOptions) {
  return {
    enabled: true,
    order: SearchSortOrder.ASCENDING,
    ...criterionOptions,
  };
}

function compareItemsByCriterion(criterion, left, right, isAscending) {
  switch (criterion) {
    case "storage":
      const isLeftInStorage = isSbcStorageItem(left);
      const isRightInStorage = isSbcStorageItem(right);
      if (isLeftInStorage !== isRightInStorage) {
        return isAscending ? (isLeftInStorage ? -1 : 1) : isRightInStorage ? 1 : -1;
      }
      break;
    case "tradable":
      if (left.tradable !== right.tradable) {
        return isAscending ? (left.tradable ? 1 : -1) : right.tradable ? -1 : 1;
      }
      break;
    case "rarity":
      if (left.rareflag !== right.rareflag) {
        return isAscending ? left.rareflag - right.rareflag : right.rareflag - left.rareflag;
      }
      break;
    case "rating":
      if (left.rating !== right.rating) {
        return isAscending ? left.rating - right.rating : right.rating - left.rating;
      }
      break;
    case "marketAvg":
      if (left.getMarketAverage() !== right.getMarketAverage()) {
        return isAscending
          ? left.getMarketAverage() - right.getMarketAverage()
          : right.getMarketAverage() - left.getMarketAverage();
      }
  }
}
