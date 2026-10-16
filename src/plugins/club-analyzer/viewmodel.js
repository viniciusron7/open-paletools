/**
 * `ClubAnalyzerViewModel`, built by `ClubAnalyzerViewController._reload` and rendered by
 * `ClubAnalyzerView`: player groupings (all, club, by nation/league/rating/rarity, unassigned,
 * trade pile, watchlist states, SBC storage), prices and dashboard counters. Also defines the
 * module-private `ClubAnalyzerRankedList` (bounded list kept sorted descending by a selector).
 *
 * Invariants:
 * - Property names, including the `unnasigned` and `watchlistLoosing` spellings, are read by the
 *   controller and the view.
 *
 * Known issues (kept as-is):
 * - `violentCalculation` (a plain function) is never called; `rank` (the only holder of
 *   `ClubAnalyzerRankedList` instances) is never read or filled; `prices` is never filled either.
 * - `counters.tots` is not initialized although the controller increments it.
 */
const ClubAnalyzerRankedList = class {
  constructor(maxSize, valueSelector) {
    if (typeof valueSelector !== "function") {
      throw new Error("valueSelector must be a function");
    }
    this.maxSize = maxSize;
    this.valueSelector = valueSelector;
    this.items = [];
  }
  ["canAdd"](item) {
    return (
      this.items.length < this.maxSize ||
      this.valueSelector(item) > this.valueSelector(this.items[this.items.length - 1])
    );
  }
  ["add"](item) {
    if (!this.canAdd(item)) {
      return false;
    }
    const itemValue = this.valueSelector(item);
    let insertIndex = 0;
    for (
      ;
      insertIndex < this.items.length && this.valueSelector(this.items[insertIndex]) > itemValue;
    ) {
      insertIndex++;
    }
    this.items.splice(insertIndex, 0, item);
    if (this.items.length > this.maxSize) {
      this.items.length = this.maxSize;
    }
    return true;
  }
  ["getAll"]() {
    return [...this.items];
  }
  get ["size"]() {
    return this.items.length;
  }
  ["clear"]() {
    this.items = [];
  }
};

export class ClubAnalyzerViewModel {
  constructor() {
    this.violentCalculation = function (player) {
      return 100000 * player.getRedCards() + player.getYellowCards();
    };
    this.rank = {
      games: new ClubAnalyzerRankedList(Number.MAX_SAFE_INTEGER, (player) =>
        player.getGamesPlayed(),
      ),
      gpg: new ClubAnalyzerRankedList(
        Number.MAX_SAFE_INTEGER,
        (player) => player.getGoals() / player.getGamesPlayed(),
      ),
      goals: new ClubAnalyzerRankedList(Number.MAX_SAFE_INTEGER, (player) => player.getGoals()),
      assists: new ClubAnalyzerRankedList(Number.MAX_SAFE_INTEGER, (player) => player.assists),
      reds: new ClubAnalyzerRankedList(Number.MAX_SAFE_INTEGER, (player) => player.getRedCards()),
      yellows: new ClubAnalyzerRankedList(Number.MAX_SAFE_INTEGER, (player) =>
        player.getYellowCards(),
      ),
    };
    this.players = {
      all: {},
      club: {},
      byNation: {},
      byLeague: {},
      byRating: {},
      byRarity: {},
      unnasigned: {
        all: {},
        tradeable: {},
        untradeable: {},
      },
      tradepile: {},
      watchlistWon: {},
      watchlistWinning: {},
      watchlistLoosing: {},
      watchlistLost: {},
      sbcStorage: {},
    };
    this.prices = {};
    this.counters = {
      special: 0,
      rare: {
        gold: 0,
        silver: 0,
        bronze: 0,
        ucl: 0,
      },
      common: {
        gold: 0,
        silver: 0,
        bronze: 0,
        ucl: 0,
      },
      libertadores: {
        motm: 0,
        gold: 0,
        silver: 0,
        bronze: 0,
      },
      sudamericana: {
        motm: 0,
        gold: 0,
        silver: 0,
        bronze: 0,
      },
      totw: 0,
      unnasignedTotal: 0,
      watchlistTotal: 0,
      tradepileTotal: 0,
      sbcStorageTotal: 0,
    };
  }
}
