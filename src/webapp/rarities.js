/**
 * Rarity tables for the SBC code: `rarityIdByName` (EA rareflag ids by name), `rarityIdsByGroupId`
 * (Sets of rareflag ids per SBC rarity-group requirement value, read by
 * src/sbc/sbc-eligibility-requirement.js and src/sbc/smart-builder-solver.js) and
 * `getLocalizedRarities(tradeableOnly = true)` (`{id, name}` from `repositories.Rarity`, names
 * translated with `item.raretype<id>`).
 *
 * Invariants:
 * - Group 83 is computed once at module evaluation as every rarity of `repositories.Rarity` that
 *   is not in group 1001, so EA's rarity repository must be loaded when the script evaluates.
 * - The ids are EA game data and must stay identical.
 *
 * Known issues (kept as-is):
 * - Group 11 includes `rarityIdByName.UTChampions`, which is not defined, so the Set holds
 *   `undefined`.
 */
import { translate } from "../i18n/translations.js";

export const rarityIdByName = {
  Common: 0,
  Rare: 1,
  TOTW: 3,
  TOTY: 5,
  TOTS: 11,
  Icon: 12,
  Futties: 16,
  Heroes: 72,
  TOTY_Icon: 155,
  FOF_Icon: 18,
  FOF_Captains: 28,
  FOF_Showdown: 62,
  FOF_Showdown_Upgrade: 63,
  FOF_StarPerformer: 94,
  FOF_SummerStars_Red: 95,
  FOF_NationalPride: 98,
  FOF_NationalPride_Red: 103,
  FOF_GloryHunters_Red: 104,
  FOF_Phenoms_Red: 106,
  FOF_PathToGlory: 107,
  FOF_GloryHunters: 109,
  FOF_Captains_Icon: 116,
  FOF_GreatsOfTheGame_Hero: 130,
  FOF_GreatsOfTheGame_Icon: 131,
  FOF_Phenoms: 137,
  FOF_SummerStars: 138,
  PremiumWorldTour: 68,
  WorldTourSilverSuperstars: 69,
  WorldTourEvo: 70,
  WorldTour: 91,
  UCL_Common: 47,
  UCL_Rare: 48,
  UCL_POTM: 49,
  UCL_RTTF: 124,
  UEL_RTTF: 125,
  UEL_POTM: 45,
  UEL_RTTK: 46,
  UECL_RTTF: 126,
  UWCL_RTTK: 31,
  UWCL_RTTF: 32,
  SquadFoundations: 87,
  Moments: 90,
  Showdown: 57,
  ShowdownUpgrade: 58,
};

export const rarityIdsByGroupId = {
  11: new Set([rarityIdByName.TOTW, rarityIdByName.TOTS, rarityIdByName.UTChampions]),
  18: new Set([rarityIdByName.TOTW, rarityIdByName.TOTS]),
  4: new Set([rarityIdByName.Rare]),
  5: new Set([rarityIdByName.UCL_Common, rarityIdByName.UCL_Rare]),
  6: new Set([rarityIdByName.UCL_Common, rarityIdByName.UCL_Rare]),
  9: new Set([rarityIdByName.Rare]),
  1000: new Set([
    rarityIdByName.FOF_Icon,
    rarityIdByName.FOF_Captains,
    rarityIdByName.FOF_Showdown,
    rarityIdByName.FOF_Showdown_Upgrade,
    rarityIdByName.FOF_StarPerformer,
    rarityIdByName.FOF_SummerStars_Red,
    rarityIdByName.FOF_NationalPride,
    rarityIdByName.FOF_NationalPride_Red,
    rarityIdByName.FOF_GloryHunters_Red,
    rarityIdByName.FOF_Phenoms_Red,
    rarityIdByName.FOF_PathToGlory,
    rarityIdByName.FOF_GloryHunters,
    rarityIdByName.FOF_Captains_Icon,
    rarityIdByName.FOF_GreatsOfTheGame_Hero,
    rarityIdByName.FOF_GreatsOfTheGame_Icon,
    rarityIdByName.FOF_Phenoms,
    rarityIdByName.FOF_SummerStars,
  ]),
  1001: new Set([
    rarityIdByName.Common,
    rarityIdByName.Rare,
    rarityIdByName.Icon,
    rarityIdByName.Heroes,
    rarityIdByName.Moments,
    rarityIdByName.SquadFoundations,
    rarityIdByName.UEL_RTTK,
    rarityIdByName.Showdown,
    rarityIdByName.ShowdownUpgrade,
    rarityIdByName.WorldTour,
    rarityIdByName.WorldTourEvo,
    rarityIdByName.WorldTourSilverSuperstars,
    rarityIdByName.PremiumWorldTour,
  ]),
};

const rarityIdsOutsideGroup1001 = [];

for (let rarity of getLocalizedRarities(false)) {
  if (!rarityIdsByGroupId[1001].has(rarity.id)) {
    rarityIdsOutsideGroup1001.push(rarity.id);
  }
}

export function getLocalizedRarities(tradeableOnly = true) {
  return repositories.Rarity.values()
    .filter((rarity) => !tradeableOnly || rarity.tradeable)
    .map((rarity) => ({
      id: rarity.id,
      name: translate("item.raretype" + rarity.id),
    }));
}

rarityIdsByGroupId[83] = new Set(rarityIdsOutsideGroup1001);
