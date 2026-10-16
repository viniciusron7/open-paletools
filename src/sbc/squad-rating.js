/**
 * `SquadRatingCalculator`: static team-rating formula and multiset helpers. `getRating` is used
 * by src/sbc/rating-solver.js, src/sbc/smart-builder-solver.js and the SBC rating calculator
 * plugin; `getMultisubsets` feeds the rating calculator's combination list.
 *
 * Invariants:
 * - `getRating(ratings, squadSize)` = floor(round(sum + excess over the average of `ratings`) /
 *   `squadSize`); both solvers compare it with the TEAM_RATING requirement, so it must keep
 *   matching the Web App's rule. The divisor is `squadSize`, not `ratings.length`.
 * - `getMultisubsets` is a lazy generator of every size-n multiset (combination with repetition)
 *   of the values; callers iterate it with `next()` and may stop early.
 * - The class is not hoisted; other modules only use it inside functions.
 */
export class SquadRatingCalculator {
  static ["getMultisubsetsCount"](valueCount, subsetSize) {
    return (
      this.factorial(valueCount + subsetSize - 1) /
      (this.factorial(valueCount - 1) * this.factorial(subsetSize))
    );
  }
  static ["factorial"](integer) {
    let product = 1;
    for (let factor = 2; factor <= integer; factor++) {
      product *= factor;
    }
    return product;
  }
  static ["getRating"](ratings, squadSize) {
    const ratingSum = ratings.reduce((sum, rating) => sum + rating, 0);
    const averageRating = ratingSum / ratings.length;
    const excessRating = ratings.reduce(
      (excess, rating) => (rating <= averageRating ? excess : excess + rating - averageRating),
      0,
    );
    const squadRating = Math.round(ratingSum + excessRating) / squadSize;
    return Math.floor(squadRating);
  }
  static ["getMultisubsets"](values, size) {
    return generateMultisubsets(values, size);
  }
}

function* generateMultisubsets(values, size) {
  if (size === 0) {
    yield [];
  } else if (values.length > 0) {
    const [firstValue, remainingValues] = [values[0], values.slice(1)];
    for (let restSize = 0; restSize < size; restSize++) {
      yield* prependRepeatedValue(
        firstValue,
        generateMultisubsets(remainingValues, restSize),
        size - restSize,
      );
    }
    yield* generateMultisubsets(remainingValues, size);
  }
}

function* prependRepeatedValue(repeatedValue, subsets, repeatCount) {
  const repeatedValues = Array.from({
    length: repeatCount,
  }).fill(repeatedValue);
  for (let subset of subsets) {
    yield [...repeatedValues, ...subset];
  }
}
