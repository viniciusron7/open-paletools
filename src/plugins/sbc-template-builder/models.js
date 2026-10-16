/**
 * Data models of the SBC template builder: `SbcTemplateSearchSettings` (builder settings of one
 * step), `SbcTemplateFilter` (one step or exclusion: search criteria plus optional settings),
 * `GlobalSbcTemplate` and `SbcChallengeTemplate` (editor view models). The first two are plain
 * constructors (no `JSUtils.inherits`) whose prototype methods are assigned after them.
 *
 * Invariants:
 * - Settings fields `minRating`, `maxRating`, `maxPlayers`, `playersFromSameClub`,
 *   `ignorePlayerPos`, `important/unimportantLeaguesOnly`, `important/unimportantNationsOnly`,
 *   `searchSource` and `sortBy` are persisted in template steps and, except `ignorePlayerPos`
 *   (read by the template builder's index.js into `ignorePosition`), read by sbc-builder-enhancer
 *   through `viewModel.searchSettings`; keep the names.
 * - `createSbcTemplateSearchCriteria` reads public or underscore DTO fields (`_sort`,
 *   `_untradeables`, `_type`) because stored steps are structured clones of
 *   `UTSearchCriteriaDTO`.
 * - Exclusions are filters without settings (`searchSettings === null`).
 * - `serialize`/`deserialize`
 *   (`mi:..;mr:..;mp:..;sc:..;ip:..;il:..;ul:..;in:..;un:..;ss:..;sb:..`) are not called by other
 *   modules.
 *
 * Known issues (kept as-is):
 * - `SbcTemplateSearchSettings.update` assigns `settings.maxRating` to `maxPlayers` (overwritten
 *   on the next line), so `maxRating` is never updated.
 */
export function SbcTemplateSearchSettings(settings, searchCriteria) {
  this.minRating = (settings && settings.minRating) || (searchCriteria && searchCriteria.ovrMin);
  this.maxRating = (settings && settings.maxRating) || (searchCriteria && searchCriteria.ovrMax);
  this.maxPlayers = settings && settings.maxPlayers;
  this.playersFromSameClub = settings && settings.playersFromSameClub;
  this.ignorePlayerPos = settings && settings.ignorePlayerPos;
  this.importantLeaguesOnly = settings && settings.importantLeaguesOnly;
  this.unimportantLeaguesOnly = settings && settings.unimportantLeaguesOnly;
  this.importantNationsOnly = settings && settings.importantNationsOnly;
  this.unimportantNationsOnly = settings && settings.unimportantNationsOnly;
  this.searchSource = settings && settings.searchSource;
  this.sortBy;
  if (searchCriteria) {
    switch (searchCriteria.sortBy) {
      case SearchSortType.VALUE:
        this.sortBy =
          searchCriteria.sort === "asc" ? SearchSortID.VALUE_ASC : SearchSortID.VALUE_DESC;
        break;
      case SearchSortType.RATING:
        this.sortBy =
          searchCriteria.sort === "asc" ? SearchSortID.RATING_ASC : SearchSortID.RATING_DESC;
        break;
      case SearchSortType.RECENCY:
        this.sortBy = SearchSortID.RECENCY_DESC;
    }
  }
}

function createSbcTemplateSearchCriteria(sourceCriteria) {
  const searchCriteria = new UTItemSearchViewModel().searchCriteria;
  searchCriteria.sort = sourceCriteria.sort || sourceCriteria._sort;
  searchCriteria.club = sourceCriteria.club;
  searchCriteria.league = sourceCriteria.league;
  searchCriteria.level = sourceCriteria.level;
  searchCriteria.nation = sourceCriteria.nation;
  searchCriteria.rarities = sourceCriteria.rarities;
  searchCriteria.sortBy = sourceCriteria.sortBy;
  searchCriteria.untradeables = sourceCriteria._untradeables;
  searchCriteria.ovrMin = sourceCriteria.ovrMin;
  searchCriteria.ovrMax = sourceCriteria.ovrMax;
  searchCriteria.type = sourceCriteria.type || sourceCriteria._type;
  return searchCriteria;
}

export function SbcTemplateFilter(searchCriteria, searchSettings) {
  this.searchCriteria = createSbcTemplateSearchCriteria(searchCriteria);
  this.searchSettings = searchSettings
    ? new SbcTemplateSearchSettings(searchSettings, searchCriteria)
    : null;
}

SbcTemplateSearchSettings.prototype.setMinRating = function (minRating) {
  this.minRating = parseInt(minRating);
};

SbcTemplateSearchSettings.prototype.setMaxRating = function (maxRating) {
  this.maxRating = parseInt(maxRating);
};

SbcTemplateSearchSettings.prototype.setMaxPlayers = function (maxPlayers) {
  this.maxPlayers = parseInt(maxPlayers);
};

SbcTemplateSearchSettings.prototype.setPlayersFromSameClub = function (playersFromSameClub) {
  this.playersFromSameClub = parseInt(playersFromSameClub);
};

SbcTemplateSearchSettings.prototype.setIgnorePositions = function (ignorePlayerPos) {
  this.ignorePlayerPos = ignorePlayerPos;
};

SbcTemplateSearchSettings.prototype.setImportantLeaguesOnly = function (importantLeaguesOnly) {
  this.importantLeaguesOnly = importantLeaguesOnly;
};

SbcTemplateSearchSettings.prototype.setUnimportantLeaguesOnly = function (unimportantLeaguesOnly) {
  this.unimportantLeaguesOnly = unimportantLeaguesOnly;
};

SbcTemplateSearchSettings.prototype.setImportantNationsOnly = function (importantNationsOnly) {
  this.importantNationsOnly = importantNationsOnly;
};

SbcTemplateSearchSettings.prototype.setUnimportantNationsOnly = function (unimportantNationsOnly) {
  this.unimportantNationsOnly = unimportantNationsOnly;
};

SbcTemplateSearchSettings.prototype.setSbcStorage = function (sbcStorage) {
  this.sbcStorage = sbcStorage;
};

SbcTemplateSearchSettings.prototype.setSearchSource = function (searchSource) {
  this.searchSource = searchSource;
};

SbcTemplateSearchSettings.prototype.update = function (settings) {
  this.minRating = settings.minRating;
  this.maxPlayers = settings.maxRating;
  this.maxPlayers = settings.maxPlayers;
  this.playersFromSameClub = settings.playersFromSameClub;
  this.ignorePlayerPos = settings.ignorePlayerPos;
  this.importantLeaguesOnly = settings.importantLeaguesOnly;
  this.unimportantLeaguesOnly = settings.unimportantLeaguesOnly;
  this.importantNationsOnly = settings.importantNationsOnly;
  this.unimportantNationsOnly = settings.unimportantNationsOnly;
  this.searchSource = settings.searchSource;
};

SbcTemplateSearchSettings.prototype.serialize = function () {
  return (
    "mi:" +
    this.minRating +
    ";mr:" +
    this.maxRating +
    ";mp:" +
    this.maxPlayers +
    ";sc:" +
    this.playersFromSameClub +
    ";ip:" +
    (this.ignorePlayerPos ? 1 : 0) +
    ";il:" +
    (this.importantLeaguesOnly ? 1 : 0) +
    ";ul:" +
    (this.unimportantLeaguesOnly ? 1 : 0) +
    ";in:" +
    (this.importantNationsOnly ? 1 : 0) +
    ";un:" +
    (this.unimportantNationsOnly ? 1 : 0) +
    ";ss:" +
    this.searchSource +
    ";sb:" +
    this.sortBy
  );
};

SbcTemplateSearchSettings.prototype.deserialize = function (serialized) {
  serialized.split(";").forEach((pair) => {
    const [settingKey, settingValue] = pair.split(":");
    switch (settingKey) {
      case "mi":
        this.minRating = parseInt(settingValue);
        break;
      case "mr":
        this.maxRating = parseInt(settingValue);
        break;
      case "mp":
        this.maxPlayers = parseInt(settingValue);
        break;
      case "sc":
        this.playersFromSameClub = parseInt(settingValue);
        break;
      case "ip":
        this.ignorePlayerPos = parseInt(settingValue) === 1;
        break;
      case "il":
        this.importantLeaguesOnly = parseInt(settingValue) === 1;
        break;
      case "ul":
        this.unimportantLeaguesOnly = parseInt(settingValue) === 1;
        break;
      case "in":
        this.importantNationsOnly = parseInt(settingValue) === 1;
        break;
      case "un":
        this.unimportantNationsOnly = parseInt(settingValue) === 1;
        break;
      case "ss":
        this.searchSource = parseInt(settingValue);
        break;
      case "sb":
        this.sortBy = parseInt(settingValue);
    }
  });
};

SbcTemplateFilter.prototype.updateCriteria = function (searchCriteria) {
  this.searchCriteria = createSbcTemplateSearchCriteria(searchCriteria);
};

SbcTemplateFilter.prototype.clone = function () {
  return new SbcTemplateFilter(this.searchCriteria, this.searchSettings);
};

SbcTemplateFilter.prototype.serialize = function () {
  return this.searchSettings?.serialize() || "";
};

export class GlobalSbcTemplate {
  #Y;
  #Q;
  #K = [];
  constructor(template) {
    this.#Y = template.id;
    this.#Q = template.name;
    this.#K = template.steps.map(
      (step) => new SbcTemplateFilter(step.searchCriteria, step.searchSettings),
    );
  }
  get ["id"]() {
    return this.#Y;
  }
  get ["name"]() {
    return this.#Q;
  }
  get ["filters"]() {
    return this.#K;
  }
  ["serialize"]() {
    return this.#K.map((filter) => filter.serialize()).join("|");
  }
}

export class SbcChallengeTemplate {
  #J;
  #Z;
  #K = [];
  #X = [];
  #$;
  #ee = [];
  constructor(sbcSet, challenge, globalTemplateId) {
    this.#J = sbcSet;
    this.#Z = challenge;
    this.#$ = globalTemplateId;
  }
  get ["set"]() {
    return this.#J;
  }
  get ["challenge"]() {
    return this.#Z;
  }
  get ["filters"]() {
    return this.#K;
  }
  set ["filters"](filters) {
    this.#K = filters;
  }
  get ["exclusions"]() {
    return this.#X;
  }
  set ["exclusions"](exclusions) {
    this.#X = exclusions;
  }
  get ["globalTemplateId"]() {
    return this.#$;
  }
  get ["globalTemplates"]() {
    return this.#ee;
  }
}
