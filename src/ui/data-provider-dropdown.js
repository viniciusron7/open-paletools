/**
 * `DataProviderDropdownControl` wraps an EA `UTSearchFilterControl` listing leagues, teams,
 * nations or rarities (`dataProviderType`) with filter icons, an optional placeholder entry and
 * exclusions; used by the album view, important leagues/nations, lock players and
 * src/ui/data-provider-multi-select-control.js.
 *
 * Invariants:
 * - `getOptions` reads `factories.DataProvider` (leagues, teams of a league without labels
 *   containing `*`, nations); rarities have no built-in options, so callers supply them.
 * - `setOptions` de-duplicates by `Number(id)`; with a placeholder it prepends
 *   `{id: -1, value: -1}` and drops negative ids. The icon table is keyed by option value (rarity
 *   icons use the value, the others the id) and `setHasDefault` follows a negative first id.
 * - The EA control is created and `init()`ed before `addClasses(this, "force-ltr")` (league and
 *   team), because `addClasses` resolves the wrapper through `getRealElement()`.
 * - `updateImage` is added as a CHANGE target in the constructor and removed in `destroy()`.
 */
import { addClasses } from "../core/dom.js";

export const dataProviderType = Object.freeze({
  League: "league",
  Team: "team",
  Nation: "nation",
  Rarity: "rarity",
});

export class DataProviderDropdownControl {
  constructor(type, { placeholder: placeholder, defaultLabel = placeholder } = {}) {
    this.type = type;
    this.placeholder = placeholder;
    this.defaultLabel = defaultLabel;
    this.control = new UTSearchFilterControl();
    this.control.init();
    if (!(type !== dataProviderType.League && type !== dataProviderType.Team)) {
      addClasses(this, "force-ltr");
    }
    this.iconType = {
      [dataProviderType.League]: AssetLocationUtils.FILTER.LEAGUE,
      [dataProviderType.Team]: AssetLocationUtils.FILTER.CLUB,
      [dataProviderType.Nation]: AssetLocationUtils.FILTER.NATION,
      [dataProviderType.Rarity]: AssetLocationUtils.FILTER.RARITY,
    }[type];
    this.control.addTarget(this, this.updateImage, EventType.CHANGE);
  }
  static ["getOptions"](type, leagueId) {
    switch (type) {
      case dataProviderType.League:
        return factories.DataProvider.getLeagueDP(true);
      case dataProviderType.Team:
        return factories.DataProvider.getTeamDP(leagueId).filter(
          (team) => -1 === team.label.indexOf("*"),
        );
      case dataProviderType.Nation:
        return factories.DataProvider.getNationDP();
      default:
        return [];
    }
  }
  ["getRealElement"]() {
    return this.control.getRootElement();
  }
  ["updateImage"]() {
    this.control.image = this.control.iconTable?.get(this.getValue()) || "";
  }
  ["setOptions"](rawOptions) {
    const uniqueOptions = [
      ...new Map(rawOptions.map((option) => [Number(option.id), option])).values(),
    ];
    const dropdownOptions =
      this.placeholder === undefined
        ? uniqueOptions
        : [
            {
              id: -1,
              value: -1,
              label: this.placeholder,
            },
            ...uniqueOptions.filter((option) => Number(option.id) >= 0),
          ];
    this.control.setIconTable(
      new Map(
        dropdownOptions.map((option) => [
          option.value,
          Number(option.id) < 0 || !this.iconType
            ? ""
            : AssetLocationUtils.getFilterImage(
                this.iconType,
                this.type === dataProviderType.Rarity ? option.value : option.id,
              ),
        ]),
      ),
    );
    this.control.setHasDefault(Number(dropdownOptions[0]?.id) < 0);
    this.control.setDefaultLabel(this.defaultLabel ?? dropdownOptions[0]?.label ?? "");
    this.control.setOptions(dropdownOptions);
    this.updateImage();
  }
  ["refresh"]({
    leagueId: leagueId,
    excludedIds: excludedIds = [],
    disabled: disabled = false,
  } = {}) {
    const excludedIdSet = new Set(excludedIds.map(Number));
    this.setOptions(
      DataProviderDropdownControl.getOptions(this.type, leagueId).filter(
        (option) => !excludedIdSet.has(Number(option.id)),
      ),
    );
    this.setInteractionState(!disabled);
  }
  ["getValue"]() {
    return this.control.getValue();
  }
  ["setIndex"](index) {
    this.control.setIndex(index);
    this.updateImage();
  }
  ["setInteractionState"](isInteractive) {
    this.control.setInteractionState(isInteractive);
  }
  ["addTarget"](target, handler, eventType) {
    this.control.addTarget(target, handler, eventType);
  }
  ["removeTarget"](target, handler, eventType) {
    this.control.removeTarget(target, handler, eventType);
  }
  ["destroy"]() {
    this.control.removeTarget(this, this.updateImage, EventType.CHANGE);
    this.control.destroy();
  }
}
