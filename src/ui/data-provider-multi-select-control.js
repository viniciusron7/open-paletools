/**
 * `DataProviderMultiSelectControl`: a section with a `DataProviderDropdownControl` and removable
 * chips for the selected ids, optionally preceded by a league dropdown that filters team
 * options; used by the lock players and important leagues/nations settings.
 *
 * Invariants:
 * - The `ids` array passed in is mutated in place (push on select, splice on remove) before
 *   `onChange()` is called without arguments; callers persist that same array.
 * - Each construction upserts the stylesheet `paletools-data-provider-selector`; the classes
 *   `data-provider-selector`, `data-provider-selected-items`, `data-provider-selected-item`,
 *   `data-provider-selected-item-remove`, `data-provider-dropdown` and
 *   `data-provider-section-label` are styled there and by the settings CSS.
 * - With `leagueLabel`, the options are empty and the dropdown disabled until a league is chosen.
 *   Selected ids are excluded from the options; chip labels come from `getOptions()` (or the
 *   `options` provider) and fall back to the id. The section label is inserted as HTML.
 * - `destroy()` removes the CHANGE targets, destroys both dropdowns and removes the container.
 */
import { addClasses, appendElements, createElement } from "../core/dom.js";
import { translate } from "../i18n/translations.js";
import { DataProviderDropdownControl, dataProviderType } from "./data-provider-dropdown.js";
import { upsertStylesheet } from "./stylesheets.js";
import dataProviderSelectorCss from "./data-provider-selector.css";

export class DataProviderMultiSelectControl {
  constructor({
    type: type,
    ids: ids,
    label: label,
    placeholder: defaultLabel,
    selectLabel: selectPlaceholder = defaultLabel,
    onChange: handleChange,
    options: optionsProvider,
    leagueLabel: leagueLabel,
  }) {
    this.type = type;
    this.ids = ids;
    this.onChange = handleChange;
    this.options = optionsProvider;
    this.leagueId = undefined;
    this.leagueLabel = leagueLabel;
    upsertStylesheet("paletools-data-provider-selector", dataProviderSelectorCss);
    this.container = createElement("section", {
      className: "data-provider-selector",
    });
    this.selectedItems = createElement("div", {
      className: "data-provider-selected-items",
    });
    this.dropdown = new DataProviderDropdownControl(type, {
      placeholder: selectPlaceholder,
      defaultLabel: defaultLabel,
    });
    addClasses(this.dropdown, "data-provider-dropdown");
    this.dropdown.addTarget(this, this.selectionChanged, EventType.CHANGE);
    if (label) {
      appendElements(
        this,
        createElement(
          "div",
          {
            className: "data-provider-section-label",
          },
          label,
        ),
      );
    }
    if (leagueLabel) {
      this.league = new DataProviderDropdownControl(dataProviderType.League, {
        placeholder: selectPlaceholder,
        defaultLabel: leagueLabel,
      });
      addClasses(this.league, "data-provider-dropdown");
      this.league.refresh();
      this.league.addTarget(this, this.leagueChanged, EventType.CHANGE);
      appendElements(this, this.league);
    }
    appendElements(this, this.dropdown, this.selectedItems);
    this.render();
    this.refresh();
  }
  ["getRealElement"]() {
    return this.container;
  }
  ["getOptions"]() {
    return this.options ? this.options() : DataProviderDropdownControl.getOptions(this.type);
  }
  ["refresh"]() {
    const selectedIds = new Set(this.ids.map(Number));
    const availableOptions = this.leagueLabel
      ? this.leagueId === undefined
        ? []
        : DataProviderDropdownControl.getOptions(this.type, this.leagueId)
      : this.getOptions();
    this.dropdown.setOptions(
      availableOptions.filter((option) => !selectedIds.has(Number(option.id))),
    );
    this.dropdown.setInteractionState(!this.leagueLabel || this.leagueId !== undefined);
  }
  ["render"]() {
    this.selectedItems.replaceChildren();
    const optionsById = new Map(this.getOptions().map((option) => [Number(option.id), option]));
    for (const id of this.ids) {
      const selectedItem = createElement("span", {
        className: "data-provider-selected-item",
      });
      selectedItem.textContent = optionsById.get(Number(id))?.label || String(id);
      const removeButton = createElement("button", {
        className: "data-provider-selected-item-remove fut_icon icon_close",
        type: "button",
        title: translate("remove"),
        "aria-label": translate("remove"),
      });
      removeButton.addEventListener("click", () => {
        this.ids.splice(this.ids.indexOf(id), 1);
        this.onChange();
        this.render();
        this.refresh();
      });
      appendElements(selectedItem, removeButton);
      appendElements(this.selectedItems, selectedItem);
    }
  }
  ["selectionChanged"](sender, eventType, eventData) {
    const selectedId = Number(eventData.value);
    if (
      !(
        !Number.isInteger(selectedId) ||
        selectedId < 0 ||
        this.ids.some((id) => Number(id) === selectedId)
      )
    ) {
      this.ids.push(selectedId);
      this.onChange();
      this.render();
      this.refresh();
    }
  }
  ["leagueChanged"](sender, eventType, eventData) {
    this.leagueId = Number(eventData.value) >= 0 ? Number(eventData.value) : undefined;
    this.refresh();
  }
  ["destroy"]() {
    this.dropdown.removeTarget(this, this.selectionChanged, EventType.CHANGE);
    this.dropdown.destroy();
    if (this.league) {
      this.league.removeTarget(this, this.leagueChanged, EventType.CHANGE);
      this.league.destroy();
    }
    this.selectedItems.replaceChildren();
    this.container.remove();
  }
}
