/**
 * `getImportantLeagueIds()`/`getImportantNationIds()` return the league/nation ids configured in
 * `configuration.plugins.importantLeagues.leagueIds` / `importantNations.nationIds`, restricted to
 * the entries of `factories.DataProvider.getLeagueDP(0)` / `getNationDP(0)` (without the -1
 * "any" entry), or every id when that plugin is disabled. Used by the SBC smart-builder solver,
 * sbc-builder-enhancer, player-card-info and improved-filters.
 *
 * Invariants:
 * - An enabled plugin with an empty id list yields an empty array, not all ids.
 * - Results follow the data-provider order, not the configured order.
 */
import { configuration } from "../config/configuration.js";

function getAllLeagueOptions() {
  return factories.DataProvider.getLeagueDP(0).filter((league) => league.id > -1);
}

export function getImportantLeagueIds() {
  if (!configuration.plugins.importantLeagues.enabled) {
    return getAllLeagueOptions().map((league) => league.id);
  }
  const importantLeagueIds = new Set(configuration.plugins.importantLeagues.leagueIds);
  return getAllLeagueOptions()
    .filter(
      (league) =>
        configuration.plugins.importantLeagues.leagueIds.length !== 0 &&
        importantLeagueIds.has(league.id),
    )
    .map((league) => league.id);
}

function getAllNationOptions() {
  return factories.DataProvider.getNationDP(0).filter((nation) => nation.id > -1);
}

export function getImportantNationIds() {
  if (!configuration.plugins.importantNations.enabled) {
    return getAllNationOptions().map((nation) => nation.id);
  }
  const importantNationIds = new Set(configuration.plugins.importantNations.nationIds);
  return getAllNationOptions()
    .filter(
      (nation) =>
        configuration.plugins.importantNations.nationIds.length !== 0 &&
        importantNationIds.has(nation.id),
    )
    .map((nation) => nation.id);
}
