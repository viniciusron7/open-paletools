/**
 * Fallback position tables for placing players into SBC squad slots. Imported by
 * src/sbc/squad-fill.js, whose `fillSbcSquadByPosition` tries the primary list in a first pass
 * and the secondary list in a second pass.
 *
 * Invariants:
 * - Both functions return a new array of `PlayerPosition` values in priority order (earlier
 *   entries are tried first); positions without an entry (e.g. GK) give `[]`.
 *
 * Known issues (kept as-is):
 * - `getSecondaryAlternativePositions(LWB)` lists `LWB` itself where the mirrored RWB entry lists
 *   RM, so LM is never an alternative for LWB players (they can still take any free slot later).
 */
export function getPrimaryAlternativePositions(position) {
  switch (position) {
    case PlayerPosition.ST:
      return [PlayerPosition.CF];
    case PlayerPosition.CF:
      return [PlayerPosition.ST, PlayerPosition.CAM];
    case PlayerPosition.CAM:
      return [PlayerPosition.CM, PlayerPosition.CF];
    case PlayerPosition.CM:
      return [PlayerPosition.CAM, PlayerPosition.CDM];
    case PlayerPosition.CDM:
      return [PlayerPosition.CM];
    case PlayerPosition.LM:
      return [PlayerPosition.LW, PlayerPosition.LF];
    case PlayerPosition.LF:
      return [PlayerPosition.LW, PlayerPosition.LM];
    case PlayerPosition.LW:
      return [PlayerPosition.LF, PlayerPosition.LM];
    case PlayerPosition.RM:
      return [PlayerPosition.RW, PlayerPosition.RF];
    case PlayerPosition.RF:
      return [PlayerPosition.RW, PlayerPosition.RM];
    case PlayerPosition.RW:
      return [PlayerPosition.RF, PlayerPosition.RM];
    case PlayerPosition.LB:
      return [PlayerPosition.LWB];
    case PlayerPosition.LWB:
      return [PlayerPosition.LB];
    case PlayerPosition.RB:
      return [PlayerPosition.RWB];
    case PlayerPosition.RWB:
      return [PlayerPosition.RB];
  }
  return [];
}

export function getSecondaryAlternativePositions(position) {
  switch (position) {
    case PlayerPosition.CB:
      return [PlayerPosition.LB, PlayerPosition.RB];
    case PlayerPosition.CDM:
      return [PlayerPosition.CB];
    case PlayerPosition.LM:
      return [PlayerPosition.LB, PlayerPosition.LWB];
    case PlayerPosition.LF:
      return [PlayerPosition.ST];
    case PlayerPosition.LW:
      return [PlayerPosition.LWB, PlayerPosition.LB];
    case PlayerPosition.RM:
      return [PlayerPosition.RB, PlayerPosition.RWB];
    case PlayerPosition.RF:
      return [PlayerPosition.ST];
    case PlayerPosition.RW:
      return [PlayerPosition.RWB, PlayerPosition.RB];
    case PlayerPosition.LB:
      return [PlayerPosition.LM, PlayerPosition.LW, PlayerPosition.RB];
    case PlayerPosition.LWB:
      return [PlayerPosition.LW, PlayerPosition.LWB, PlayerPosition.RWB];
    case PlayerPosition.RB:
      return [PlayerPosition.RM, PlayerPosition.RW, PlayerPosition.LB];
    case PlayerPosition.RWB:
      return [PlayerPosition.RW, PlayerPosition.RM, PlayerPosition.LWB];
  }
  return [];
}
