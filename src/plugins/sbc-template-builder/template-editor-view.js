/**
 * `SbcTemplateEditorView(viewModel)`: old-style EA view of the template editor: global-template
 * picker (challenge templates only), ordered filter steps (sort, search source, untradeable
 * toggle, `EnhancedSearchFiltersControl`, item search view, duplicate/remove/move buttons),
 * exclusions and add/exclude/save buttons. Created by template-editor-view-controller.js for an
 * `SbcChallengeTemplate` or a `GlobalSbcTemplate` (`isGlobalTemplate`).
 *
 * Invariants:
 * - `JSUtils.inherits(SbcTemplateEditorView, EAView)` runs at module evaluation and must precede
 *   the `prototype.*` assignments; fields and observables are set before `EAView.call(this)`.
 * - `searchViews`/`exclusionViews` must stay index-aligned with `viewModel.filters`/`exclusions`:
 *   remove and move look up the index by the item search view's `id` (`generateUuid()`) and
 *   splice or swap both arrays.
 * - Search source values are the src/sbc/search-sources.js constants (default storage then club);
 *   the untradeable toggle sets `SearchUntradeables.ONLY`/`DEFAULT`; position and playStyle
 *   filters are hidden.
 * - Events: `onSaveClicked`, `onFilterRemoved`, `onExclusionRemoved`, `onGlobalTemplateChanged`
 *   (dropdown value), `onGlobalTemplateUseClicked` (id); `onCancelClicked` is never notified.
 * - Stylesheet id `sbc-template-builder`.
 *
 * Known issues (kept as-is):
 * - `clearFilters` empties `viewModel.filters` and the DOM but not `searchViews`, and
 *   `update(..., forceAddFilters)` re-adds every exclusion view; after "edit global template" the
 *   views drift from the model, so remove and move can hit the wrong entries.
 * - `dealloc` does not dealloc `onExclusionRemoved`.
 */
import {
  addClasses,
  appendElements,
  createElement,
  insertAfter,
  insertBefore,
  removeFromParentNode,
} from "../../core/dom.js";
import { generateUuid } from "../../core/uuid.js";
import { translate } from "../../i18n/translations.js";
import { EnhancedSearchFiltersControl } from "./enhanced-search-filters-control.js";
import { GlobalSbcTemplate, SbcTemplateFilter, SbcTemplateSearchSettings } from "./models.js";
import {
  searchSourceClub,
  searchSourceClubThenStorage,
  searchSourceStorage,
  searchSourceStorageThenClub,
} from "../../sbc/search-sources.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import sbcTemplateBuilderStyles from "./sbc-template-builder.css";

export function SbcTemplateEditorView(viewModel) {
  this.viewModel = viewModel;
  if (viewModel instanceof GlobalSbcTemplate) {
    this.isGlobalTemplate = true;
  }
  this.onCancelClicked = new EAObservable();
  this.onSaveClicked = new EAObservable();
  this.onFilterRemoved = new EAObservable();
  this.onExclusionRemoved = new EAObservable();
  this.onGlobalTemplateChanged = new EAObservable();
  this.onGlobalTemplateUseClicked = new EAObservable();
  this.searchViews = [];
  this.exclusionViews = [];
  EAView.call(this);
}

function createSbcTemplateItemSearchView(searchViewModel) {
  const itemSearchView = new UTItemSearchView();
  itemSearchView.id = generateUuid();
  itemSearchView.init();
  itemSearchView.setFilters(searchViewModel);
  itemSearchView.togglePlayerNameRow(false);
  itemSearchView.togglePileFilter(false);
  itemSearchView.toggleEvolutionStatusFilter(false);
  for (let hiddenFilter of itemSearchView.filters.filter(
    (filter) => filter.setId === "position" || filter.setId === "playStyle",
  )) {
    hiddenFilter.getRootElement().style.display = "none";
  }
  return itemSearchView;
}

JSUtils.inherits(SbcTemplateEditorView, EAView);

SbcTemplateEditorView.prototype.dealloc = function () {
  this.onCancelClicked.dealloc();
  this.onCancelClicked = null;
  this.onSaveClicked.dealloc();
  this.onSaveClicked = null;
  this.onFilterRemoved.dealloc();
  this.onFilterRemoved = null;
  this.onGlobalTemplateChanged.dealloc();
  this.onGlobalTemplateChanged = null;
  this.onGlobalTemplateUseClicked.dealloc();
  this.onGlobalTemplateUseClicked = null;
};

SbcTemplateEditorView.prototype.update = function (
  viewModel,
  skipGlobalTemplateOptions,
  forceAddFilters,
) {
  this.viewModel = viewModel;
  if (!this.viewModel.globalTemplateId || forceAddFilters) {
    for (let filter of this.viewModel.filters) {
      this.addFilter(filter);
    }
  }
  if (!this.isGlobalTemplate && !skipGlobalTemplateOptions) {
    const globalTemplateOptions = [];
    globalTemplateOptions.push({
      value: "",
      label: translate("plugins.sbcTemplateBuilder.editor.selectGlobal"),
    });
    for (let globalTemplate of this.viewModel.globalTemplates) {
      globalTemplateOptions.push({
        value: globalTemplate.id,
        label: globalTemplate.name,
      });
    }
    this._globalTemplatesDropDown.setOptions(globalTemplateOptions);
    this._globalTemplatesDropDown.setIndexByValue(viewModel.globalTemplateId);
  }
  for (let exclusion of this.viewModel.exclusions) {
    this.addExclusion(exclusion);
  }
};

SbcTemplateEditorView.prototype.clearFilters = function () {
  this.viewModel.filters.length = 0;
  this._filtersContainer.innerHTML = "";
};

SbcTemplateEditorView.prototype.addExclusion = function (exclusion) {
  showElements(this._exclusionsTitle);
  const searchViewModel = new UTItemSearchViewModel();
  if (exclusion) {
    searchViewModel.searchCriteria.update(exclusion.searchCriteria);
  } else {
    exclusion = new SbcTemplateFilter(searchViewModel.searchCriteria);
    this.viewModel.exclusions.push(exclusion);
  }
  const exclusionContainer = createElement("div", {
    className: "item-exclusions-container tile col-1-1",
  });
  const exclusionFiltersContainer = createElement("div", {
    className: "exclusions-filters-container",
  });
  const itemSearchView = createSbcTemplateItemSearchView(searchViewModel);
  this.exclusionViews.push(itemSearchView);
  itemSearchView.onFilterChange.observe(
    this,
    (observable, filterType, filterValue, onFilterChangeArgument4) => {
      searchViewModel.updateFromFilterChange(filterType, filterValue, onFilterChangeArgument4);
      itemSearchView.setFilters(searchViewModel);
      exclusion.updateCriteria(searchViewModel.searchCriteria);
    },
  );
  const removeButton = new UTStandardButtonControl();
  removeButton.init();
  removeButton.setText(translate("remove"));
  removeButton.addTarget(
    this,
    () => {
      const exclusionIndex = this.exclusionViews.findIndex((view) => view.id === itemSearchView.id);
      removeFromParentNode(exclusionContainer);
      this.exclusionViews.splice(exclusionIndex, 1);
      this.viewModel.exclusions.splice(exclusionIndex, 1);
      this.onExclusionRemoved.notify();
      if (this.exclusionViews.length === 0) {
        hideElements(this._exclusionsTitle);
      }
    },
    EventType.TAP,
  );
  appendElements(exclusionFiltersContainer, itemSearchView);
  appendElements(exclusionContainer, exclusionFiltersContainer, removeButton);
  appendElements(this._exclusionsContainer, exclusionContainer);
};

SbcTemplateEditorView.prototype.addFilter = function (filter) {
  const searchViewModel = new UTItemSearchViewModel();
  let searchSettings = filter ? filter.searchSettings : new SbcTemplateSearchSettings();
  if (filter) {
    searchViewModel.searchCriteria.update(filter.searchCriteria);
  } else {
    filter = new SbcTemplateFilter(searchViewModel.searchCriteria, searchSettings);
    this.viewModel.filters.push(filter);
    searchSettings = filter.searchSettings;
  }
  const filterContainer = createElement("div", {
    className: "item-search-container tile col-1-1",
  });
  const searchViewFiltersContainer = createElement("div", {
    className: "search-view-filters-container",
  });
  appendElements(filterContainer, searchViewFiltersContainer);
  const dropdownsContainer = createElement("div", {
    className: "dropdowns-container",
  });
  appendElements(
    dropdownsContainer,
    (function (searchViewModel, filter) {
      const sortDropDown = new UTDropDownControl();
      let selectedSortId;
      sortDropDown.init();
      sortDropDown.setOptions(factories.DataProvider.getSortTypeDP());
      sortDropDown.addTarget(
        this,
        (control, eventType, selectedOption) => {
          searchViewModel.searchCriteria.sort = selectedOption.value;
          switch (selectedOption.id) {
            case SearchSortID.VALUE_DESC:
            case SearchSortID.VALUE_ASC:
              searchViewModel.searchCriteria.sortBy = SearchSortType.VALUE;
              break;
            case SearchSortID.RATING_DESC:
            case SearchSortID.RATING_ASC:
              searchViewModel.searchCriteria.sortBy = SearchSortType.RATING;
              break;
            case SearchSortID.RECENCY_DESC:
              searchViewModel.searchCriteria.sortBy = SearchSortType.RECENCY;
          }
          filter.updateCriteria(searchViewModel.searchCriteria);
        },
        EventType.CHANGE,
      );
      switch (searchViewModel.searchCriteria.sortBy) {
        case SearchSortType.VALUE:
          selectedSortId =
            searchViewModel.searchCriteria.sort === "asc"
              ? SearchSortID.VALUE_ASC
              : SearchSortID.VALUE_DESC;
          break;
        case SearchSortType.RATING:
          selectedSortId =
            searchViewModel.searchCriteria.sort === "asc"
              ? SearchSortID.RATING_ASC
              : SearchSortID.RATING_DESC;
          break;
        case SearchSortType.RECENCY:
          selectedSortId = SearchSortID.RECENCY_DESC;
      }
      sortDropDown.setIndexById(selectedSortId);
      return sortDropDown;
    })(searchViewModel, filter),
    (function (searchSettings) {
      const searchSourceDropDown = new UTDropDownControl();
      searchSourceDropDown.init();
      searchSourceDropDown.setOptions([
        {
          id: 1,
          label:
            translate("search.searchmode.storage") + " / " + translate("search.searchmode.club"),
          value: searchSourceStorageThenClub,
        },
        {
          id: 2,
          label:
            translate("search.searchmode.club") + " / " + translate("search.searchmode.storage"),
          value: searchSourceClubThenStorage,
        },
        {
          id: 3,
          label: "" + translate("search.searchmode.storage"),
          value: searchSourceStorage,
        },
        {
          id: 4,
          label: "" + translate("search.searchmode.club"),
          value: searchSourceClub,
        },
      ]);
      searchSourceDropDown.addTarget(
        this,
        (control, eventType, selectedOption) => {
          searchSettings.setSearchSource(parseInt(selectedOption.value));
        },
        EventType.CHANGE,
      );
      if (!searchSettings.searchSource) {
        searchSettings.searchSource = searchSourceStorageThenClub;
      }
      searchSourceDropDown.setIndexByValue(parseInt(searchSettings.searchSource));
      return searchSourceDropDown;
    })(searchSettings),
  );
  appendElements(searchViewFiltersContainer, dropdownsContainer);
  appendElements(
    searchViewFiltersContainer,
    (function (searchViewModel, searchSettings, filter) {
      const searchOptionsToggles = new UTToggleControlGroupView();
      searchOptionsToggles.init();
      searchOptionsToggles.addToggleCell(
        enums.UISortOptionType.UNTRADEABLE,
        translate("search.sort.header"),
      );
      searchOptionsToggles.addTarget(
        this,
        (control, eventType, eventData) => {
          if (eventData.id === enums.UISortOptionType.UNTRADEABLE) {
            searchViewModel.searchCriteria.untradeables = eventData.checked
              ? SearchUntradeables.ONLY
              : SearchUntradeables.DEFAULT;
            filter.updateCriteria(searchViewModel.searchCriteria);
          } else if (eventData.id === "sbcStorage") {
            searchSettings.setSbcStorage(eventData.checked);
          }
        },
        EventType.CHANGE,
      );
      searchOptionsToggles.layoutSubviews();
      if (searchViewModel.searchCriteria.untradeables === SearchUntradeables.ONLY) {
        searchOptionsToggles.toggleById(enums.UISortOptionType.UNTRADEABLE);
      }
      if (searchSettings.sbcStorage) {
        searchOptionsToggles.toggleById("sbcStorage");
      }
      return searchOptionsToggles;
    })(searchViewModel, searchSettings, filter),
  );
  appendElements(
    searchViewFiltersContainer,
    new EnhancedSearchFiltersControl(searchSettings, isPhone()),
  );
  const itemSearchView = createSbcTemplateItemSearchView(searchViewModel);
  this.searchViews.push(itemSearchView);
  itemSearchView.onFilterChange.observe(
    this,
    (observable, filterType, filterValue, onFilterChangeArgument4) => {
      searchViewModel.updateFromFilterChange(filterType, filterValue, onFilterChangeArgument4);
      itemSearchView.setFilters(searchViewModel);
      filter.updateCriteria(searchViewModel.searchCriteria);
    },
  );
  const duplicateButton = new UTStandardButtonControl();
  duplicateButton.init();
  duplicateButton.setText(translate("duplicate"));
  duplicateButton.addTarget(
    this,
    () => {
      const copy = filter.clone();
      this.viewModel.filters.push(copy);
      this.addFilter(copy);
    },
    EventType.TAP,
  );
  const removeButton = new UTStandardButtonControl();
  removeButton.init();
  removeButton.setText(translate("remove"));
  removeButton.addTarget(
    this,
    () => {
      const filterIndex = this.searchViews.findIndex((view) => view.id === itemSearchView.id);
      removeFromParentNode(filterContainer);
      this.searchViews.splice(filterIndex, 1);
      this.viewModel.filters.splice(filterIndex, 1);
      this.onFilterRemoved.notify();
    },
    EventType.TAP,
  );
  const moveUpButton = new UTStandardButtonControl();
  moveUpButton.init();
  addClasses(moveUpButton, "order-up");
  moveUpButton.getRootElement().innerHTML = "&uarr;";
  moveUpButton.addTarget(
    this,
    () => {
      const filterIndex = this.searchViews.findIndex((view) => view.id === itemSearchView.id);
      if (filterIndex > 0) {
        const previousView = this.searchViews[filterIndex - 1];
        this.searchViews[filterIndex - 1] = itemSearchView;
        this.searchViews[filterIndex] = previousView;
        const previousFilter = this.viewModel.filters[filterIndex - 1];
        this.viewModel.filters[filterIndex - 1] = this.viewModel.filters[filterIndex];
        this.viewModel.filters[filterIndex] = previousFilter;
        insertBefore(filterContainer, this._filtersContainer.children[filterIndex - 1]);
      }
    },
    EventType.TAP,
  );
  const moveDownButton = new UTStandardButtonControl();
  moveDownButton.init();
  addClasses(moveDownButton, "order-down");
  moveDownButton.getRootElement().innerHTML = "&darr;";
  moveDownButton.addTarget(
    this,
    () => {
      const filterIndex = this.searchViews.findIndex((view) => view.id == itemSearchView.id);
      if (filterIndex < this.searchViews.length - 1) {
        const nextView = this.searchViews[filterIndex + 1];
        this.searchViews[filterIndex + 1] = itemSearchView;
        this.searchViews[filterIndex] = nextView;
        const nextFilter = this.viewModel.filters[filterIndex + 1];
        this.viewModel.filters[filterIndex + 1] = this.viewModel.filters[filterIndex];
        this.viewModel.filters[filterIndex] = nextFilter;
        insertAfter(filterContainer, this._filtersContainer.children[filterIndex + 1]);
      }
    },
    EventType.TAP,
  );
  const orderButtonsContainer = createElement("div", {
    className: "order-buttons-container",
  });
  appendElements(orderButtonsContainer, moveUpButton, moveDownButton);
  appendElements(filterContainer, orderButtonsContainer);
  const actionsContainer = createElement("div", {
    className: "actions-container",
  });
  appendElements(actionsContainer, duplicateButton, removeButton);
  addClasses(removeButton, "remove-button");
  appendElements(searchViewFiltersContainer, itemSearchView);
  appendElements(searchViewFiltersContainer, actionsContainer);
  appendElements(this._filtersContainer, filterContainer);
};

SbcTemplateEditorView.prototype._generate = function () {
  upsertStylesheet("sbc-template-builder", sbcTemplateBuilderStyles);
  const root = createElement("div", {
    className: "sbc-template-builder-container ut-content",
  });
  if (!this.isGlobalTemplate) {
    const globalTemplatesContainer = createElement("div", {
      className: "global-templates-container",
    });
    const useGlobalTemplateButton = new UTStandardButtonControl();
    useGlobalTemplateButton.init();
    useGlobalTemplateButton.setText(translate("use"));
    const editGlobalTemplateButton = new UTStandardButtonControl();
    editGlobalTemplateButton.init();
    editGlobalTemplateButton.setText(translate("edit"));
    this._globalTemplatesDropDown = new UTDropDownControl();
    this._globalTemplatesDropDown.init();
    this._globalTemplatesDropDown.addTarget(
      this,
      (control, eventType, selectedOption) => {
        this.onGlobalTemplateChanged.notify(selectedOption.value);
        if (selectedOption.value && selectedOption.value.length > 0) {
          showElements(useGlobalTemplateButton);
          showElements(editGlobalTemplateButton);
          hideElements(this._addFilterButton);
          hideElements(this._saveButton);
        } else {
          hideElements(useGlobalTemplateButton);
          hideElements(editGlobalTemplateButton);
          showElements(this._addFilterButton);
          showElements(this._saveButton);
        }
        this.clearFilters();
      },
      EventType.CHANGE,
    );
    useGlobalTemplateButton.addTarget(
      this,
      () => {
        this.onGlobalTemplateUseClicked.notify(this._globalTemplatesDropDown.getValue());
      },
      EventType.TAP,
    );
    editGlobalTemplateButton.addTarget(
      this,
      () => {
        const globalTemplate = this.viewModel.globalTemplates.find(
          (template) => template.id === this._globalTemplatesDropDown.getValue(),
        );
        if (globalTemplate) {
          this.clearFilters();
          for (let filter of globalTemplate.filters) {
            this.viewModel.filters.push(filter);
          }
          this.update(this.viewModel, true, true);
          showElements(this._addFilterButton);
          showElements(this._saveButton);
        }
      },
      EventType.TAP,
    );
    hideElements(useGlobalTemplateButton);
    hideElements(editGlobalTemplateButton);
    appendElements(
      globalTemplatesContainer,
      this._globalTemplatesDropDown,
      useGlobalTemplateButton,
      editGlobalTemplateButton,
    );
    appendElements(root, globalTemplatesContainer);
  }
  const buttonContainer = createElement("div", {
    className: "button-container",
  });
  this._saveButton = new UTStandardButtonControl();
  this._saveButton.init();
  this._saveButton.setText(translate("save"));
  this._saveButton.addTarget(
    this,
    () => {
      this.onSaveClicked.notify();
    },
    EventType.TAP,
  );
  addClasses(this._saveButton, "primary");
  this._excludeButton = new UTStandardButtonControl();
  this._excludeButton.init();
  this._excludeButton.setText(translate("exclude"));
  this._excludeButton.addTarget(
    this,
    () => {
      this.addExclusion();
    },
    EventType.TAP,
  );
  this._addFilterButton = new UTStandardButtonControl();
  this._addFilterButton.init();
  this._addFilterButton.setText(translate("add"));
  this._addFilterButton.addTarget(
    this,
    () => {
      this.addFilter();
    },
    EventType.TAP,
  );
  this._filtersContainer = createElement("div", {
    className: "filters-container",
  });
  appendElements(root, buttonContainer);
  appendElements(buttonContainer, this._addFilterButton, this._excludeButton, this._saveButton);
  appendElements(root, this._filtersContainer);
  this._exclusionsContainer = createElement("div", {
    className: "exclusions-container",
  });
  this._exclusionsTitle = createElement(
    "h3",
    {},
    translate("plugins.sbcTemplateBuilder.exclusions.title"),
  );
  appendElements(this._exclusionsContainer, this._exclusionsTitle);
  hideElements(this._exclusionsTitle);
  appendElements(root, this._exclusionsContainer);
  if (this.viewModel.filters) {
    for (let filter of this.viewModel.filters) {
      this.addFilter(filter);
    }
  }
  if (this.viewModel.exclusions) {
    for (let exclusion of this.viewModel.exclusions) {
      this.addExclusion(exclusion);
    }
  }
  this.__root = root;
};
