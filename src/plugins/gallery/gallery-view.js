/**
 * `GalleryView` (extends `AlbumView`), instantiated by `GalleryViewController`: category / set /
 * card-filter / sort dropdowns, toolbar (auto-fill, clear, refresh), per-card score and
 * include/exclude buttons, and a grading panel (grade badge, breakdown, thresholds, bonus tags,
 * rating table).
 *
 * Invariants:
 * - It calls `AlbumView.call(this)` (for the album observables that `AlbumViewController.init`
 *   observes) but its `_generate`/`destroyGeneratedElements` call
 *   `UTClubSearchResultsView.prototype` directly to skip the album league/club controls; they
 *   must not call the AlbumView versions.
 * - `_generate` builds the category options from `galleryCategories`, so the gallery data must be
 *   loaded before the view is generated (`openGallery` ensures it).
 * - The selection `{categoryId, setId, cardFilter, sortBy}` is persisted to
 *   `configuration.plugins.gallery.lastSelection`.
 * - Card-filter and sort labels stay hidden until a set is chosen (`this.setFilters`);
 *   `toolbarButtons[2]` is the refresh button that `setLoadError` re-enables.
 * - Card listeners are pushed to `cardListeners` so `AlbumView.clearCardListeners` removes them.
 * - CSS hooks: `rank-<grade lowercased>`, `gallery-achieved`, `gallery-selected`, `gallery-tag`.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { addClasses, appendElements, createElement, prependElements } from "../../core/dom.js";
import { listenForEvent } from "../../core/events.js";
import { translate } from "../../i18n/translations.js";
import { AlbumView } from "../album/album-view.js";
import { galleryCategories } from "./gallery-data.js";
import { getGalleryItemScore } from "./gallery-grading.js";
import { galleryPointsByRating } from "./points-by-rating.js";
import { hideElements, showElements } from "../../ui/visibility.js";

const translateGalleryViewText = (translationKey) => translate("plugins.gallery." + translationKey);

const formatGalleryNumber = (amount) => Number(amount).toLocaleString();

const createGalleryTextElement = (tagName, textContent, className) => {
  const element = createElement(
    tagName,
    className
      ? {
          className: className,
        }
      : {},
  );
  element.textContent = textContent;
  return element;
};

const GalleryViewImpl = function () {
  AlbumView.call(this);
  this.onSetChanged = new EAObservable();
  this.onSelectionChanged = new EAObservable();
  this.onAutoFill = new EAObservable();
  this.onClearSelection = new EAObservable();
  this.onRefresh = new EAObservable();
  this.onCardFilterChanged = new EAObservable();
  this.selectedCards = new Set();
  this.selectionButtons = new Map();
};

function createGalleryTable(headers, rows) {
  const table = createElement("table");
  const tableHead = createElement("thead");
  const headerRow = createElement("tr");
  headers.forEach((header) => {
    const headerCell = createGalleryTextElement("th", header);
    headerCell.scope = "col";
    appendElements(headerRow, headerCell);
  });
  appendElements(tableHead, headerRow);
  const tableBody = createElement("tbody");
  rows.forEach(({ cells: cells, active: isActive }) => {
    const row = createElement(
      "tr",
      isActive
        ? {
            className: "gallery-achieved",
          }
        : {},
    );
    cells.forEach((cell) => appendElements(row, createGalleryTextElement("td", cell)));
    appendElements(tableBody, row);
  });
  appendElements(table, tableHead, tableBody);
  return table;
}

JSUtils.inherits(GalleryViewImpl, AlbumView);

GalleryViewImpl.prototype._generate = function () {
  UTClubSearchResultsView.prototype._generate.call(this);
  if (this.galleryGenerated) {
    return;
  }
  addClasses(this.__root, "album-view", "gallery-view");
  hideElements(this.__root);
  const filtersContainer = createElement("div", {
    className: "album-filters",
  });
  this.setFilters = [];
  const addFilterDropdown = (labelKey, dropdownOptions) => {
    const label = createGalleryTextElement("label", translateGalleryViewText(labelKey));
    if (!(labelKey !== "cardFilter" && labelKey !== "sortBy")) {
      this.setFilters.push(label);
      hideElements(label);
    }
    const dropdown = new UTDropDownControl();
    dropdown.init();
    dropdown.setOptions(dropdownOptions);
    appendElements(label, dropdown);
    appendElements(filtersContainer, label);
    return dropdown;
  };
  const createPlaceholderOption = (labelKey) => ({
    id: -1,
    value: -1,
    label: translateGalleryViewText(labelKey),
  });
  this.category = addFilterDropdown("category", [
    createPlaceholderOption("selectCategory"),
    ...galleryCategories.map((category) => ({
      id: category.id,
      value: category.id,
      label: category.name,
    })),
  ]);
  this.set = addFilterDropdown("set", [createPlaceholderOption("selectSet")]);
  this.cardFilter = addFilterDropdown(
    "cardFilter",
    ["all", "tracked", "untracked"].map((filterKey) => ({
      id: filterKey,
      value: filterKey,
      label: translateGalleryViewText("cardFilter." + filterKey),
    })),
  );
  this.sortBy = addFilterDropdown(
    "sortBy",
    ["gradingScore", "tracked", "rating", "name"].map((sortKey) => ({
      id: sortKey,
      value: sortKey,
      label: translate("plugins.album.sort." + sortKey),
    })),
  );
  const lastSelection = configuration.plugins.gallery.lastSelection || {};
  this.category.setIndex(
    Math.max(
      0,
      galleryCategories.findIndex((category) => category.id === lastSelection.categoryId) + 1,
    ),
  );
  const selectedCategory = galleryCategories.find(
    (category) => category.id === Number(this.category.getValue()),
  );
  this.set.setOptions([
    createPlaceholderOption("selectSet"),
    ...(selectedCategory?.sets || []).map((gallerySet) => ({
      id: gallerySet.id,
      value: gallerySet.id,
      label: gallerySet.name,
    })),
  ]);
  this.set.setIndex(
    Math.max(
      0,
      (selectedCategory?.sets || []).findIndex(
        (gallerySet) => gallerySet.id === lastSelection.setId,
      ) + 1,
    ),
  );
  this.cardFilter.setIndex(
    Math.max(0, ["all", "tracked", "untracked"].indexOf(lastSelection.cardFilter)),
  );
  this.sortBy.setIndex(
    Math.max(0, ["gradingScore", "tracked", "rating", "name"].indexOf(lastSelection.sortBy)),
  );
  this.cardFilter.addTarget(this, this._cardFilterChanged, EventType.CHANGE);
  this.category.addTarget(this, this._categoryChanged, EventType.CHANGE);
  this.set.addTarget(this, this._setChanged, EventType.CHANGE);
  this.sortBy.addTarget(this, this._sortChanged, EventType.CHANGE);
  this.status = createGalleryTextElement("p", translateGalleryViewText("selectSet"));
  this.status.setAttribute("role", "status");
  this.description = createGalleryTextElement("p", "", "gallery-description");
  this.scope = createGalleryTextElement("p", "", "gallery-scope");
  const toolbar = createElement("div", {
    className: "gallery-toolbar",
  });
  this.toolbarButtons = [];
  for (const [labelKey, observableName] of [
    ["autoFill", "onAutoFill"],
    ["clear", "onClearSelection"],
    ["refresh", "onRefresh"],
  ]) {
    const button = createGalleryTextElement(
      "button",
      translateGalleryViewText(labelKey),
      "btn-standard mini",
    );
    button.type = "button";
    button.addEventListener("click", () => this[observableName].notify());
    this.toolbarButtons.push(button);
    appendElements(toolbar, button);
  }
  const header = createElement("div", {
    className: "album-header",
  });
  appendElements(header, filtersContainer, this.description, toolbar, this.status, this.scope);
  this.panel = createElement("aside", {
    className: "gallery-panel",
    "aria-label": translateGalleryViewText("grading"),
  });
  this.panel.setAttribute("aria-live", "polite");
  appendElements(this.panel, createGalleryTextElement("p", translateGalleryViewText("selectSet")));
  prependElements(this.__root, header);
  appendElements(this.__root, this.panel);
  addClasses(this._list.__itemList, "album-grid");
  this.galleryGenerated = true;
};

GalleryViewImpl.prototype.getSelection = function () {
  return {
    categoryId: Number(this.category.getValue()),
    setId: Number(this.set.getValue()),
    cardFilter: this.cardFilter.getValue(),
    sortBy: this.sortBy.getValue(),
  };
};

GalleryViewImpl.prototype._saveSelection = function () {
  configuration.plugins.gallery.lastSelection = this.getSelection();
  persistConfiguration();
};

GalleryViewImpl.prototype._cardFilterChanged = function () {
  this._saveSelection();
  this.onCardFilterChanged.notify({
    filter: this.cardFilter.getValue(),
  });
};

GalleryViewImpl.prototype._categoryChanged = function () {
  const selectedCategory = galleryCategories.find(
    (category) => category.id === Number(this.category.getValue()),
  );
  this.set.setOptions([
    {
      id: -1,
      value: -1,
      label: translateGalleryViewText("selectSet"),
    },
    ...(selectedCategory?.sets || []).map((gallerySet) => ({
      id: gallerySet.id,
      value: gallerySet.id,
      label: gallerySet.name,
    })),
  ]);
  this.set.setIndex(0);
  this._setChanged();
};

GalleryViewImpl.prototype._setChanged = function () {
  this._saveSelection();
  this.onSetChanged.notify({
    setId: Number(this.set.getValue()),
  });
};

GalleryViewImpl.prototype.setGallerySet = function (gallerySet) {
  this.gallerySet = gallerySet;
  this.setFilters.forEach((filterLabel) =>
    gallerySet ? showElements(filterLabel) : hideElements(filterLabel),
  );
  this.description.textContent = gallerySet?.description || "";
  this.scope.textContent = "";
  this.panel.replaceChildren(
    createGalleryTextElement("p", translateGalleryViewText(gallerySet ? "loading" : "selectSet")),
  );
  this.toolbarButtons.forEach((button) => {
    button.disabled = true;
  });
};

GalleryViewImpl.prototype.setLoadError = function (message) {
  this.setStatus(message);
  this.panel.replaceChildren(createGalleryTextElement("p", message));
  this.toolbarButtons[2].disabled = false;
};

GalleryViewImpl.prototype.setAvailableOnly = function (isAvailableOnly) {
  this.scope.textContent = isAvailableOnly ? translateGalleryViewText("availableOnly") : "";
  this.toolbarButtons.forEach((button) => {
    button.disabled = false;
  });
};

GalleryViewImpl.prototype.setItems = function (listItems, ...otherArguments) {
  this.selectionButtons.clear();
  AlbumView.prototype.setItems.call(this, listItems, ...otherArguments);
  for (const row of this._list.getRows()) {
    const item = row.getData();
    const albumEntry = this.albumEntries.get(item.definitionId);
    const itemScore = getGalleryItemScore(item);
    const scoreLabel = createGalleryTextElement(
      "p",
      translateGalleryViewText(albumEntry.status) +
        " · " +
        formatGalleryNumber(itemScore.score) +
        " " +
        translateGalleryViewText("points") +
        (itemScore.estimated ? " *" : ""),
      "gallery-card-score",
    );
    const button = createGalleryTextElement(
      "button",
      translateGalleryViewText("include"),
      "btn-standard mini gallery-select",
    );
    button.type = "button";
    const clickListener = (event) => {
      event.stopPropagation();
      this.onSelectionChanged.notify({
        definitionId: item.definitionId,
      });
    };
    listenForEvent(button, "click", clickListener);
    this.cardListeners.push([button, clickListener]);
    this.selectionButtons.set(item.definitionId, {
      button: button,
      row: row,
    });
    appendElements(row, scoreLabel, button);
  }
  this.setSelection(this.selectedCards, this.requiredItems);
};

GalleryViewImpl.prototype.setEmptyListMessage = function () {
  this.selectionButtons.clear();
  this.clearCards();
  this.setStatus(translateGalleryViewText("empty"));
};

GalleryViewImpl.prototype.setSelection = function (selectedCards, requiredItems) {
  this.selectedCards = new Set(selectedCards);
  this.requiredItems = requiredItems;
  for (const [definitionId, { button: button, row: row }] of this.selectionButtons) {
    const isSelected = selectedCards.has(definitionId);
    button.textContent = translateGalleryViewText(isSelected ? "exclude" : "include");
    button.disabled = !isSelected && selectedCards.size >= requiredItems;
    button.setAttribute("aria-pressed", String(isSelected));
    row.getRootElement().classList.toggle("gallery-selected", isSelected);
  }
};

GalleryViewImpl.prototype.setGrade = function (grading) {
  const gallerySet = this.gallerySet;
  if (!gallerySet) {
    return;
  }
  this.panel.replaceChildren();
  const summary = createElement("section", {
    className: "gallery-grade-summary",
  });
  const rankBadge = createElement("div", {
    className: "rank" + (grading.grade ? " rank-" + grading.grade.toLowerCase() : ""),
  });
  appendElements(
    rankBadge,
    createElement("div", {
      className: "rank__inner",
    }),
    createGalleryTextElement("span", grading.grade || "—", "rank__letter"),
  );
  appendElements(
    summary,
    createGalleryTextElement("h2", gallerySet.name),
    createGalleryTextElement("p", translateGalleryViewText("calculatedGrade")),
    rankBadge,
    createGalleryTextElement(
      "p",
      formatGalleryNumber(grading.totalScore) + " " + translateGalleryViewText("points"),
      "gallery-total",
    ),
    createGalleryTextElement(
      "p",
      grading.count + " / " + gallerySet.requiredItems + " " + translateGalleryViewText("selected"),
    ),
  );
  appendElements(
    summary,
    createElement("progress", {
      max: gallerySet.requiredItems,
      value: grading.count,
      "aria-label": translateGalleryViewText("selected"),
    }),
  );
  if (!grading.complete) {
    appendElements(summary, createGalleryTextElement("p", translateGalleryViewText("incomplete")));
  }
  appendElements(
    summary,
    createGalleryTextElement(
      "p",
      grading.nextGrade
        ? formatGalleryNumber(grading.remaining) +
            " " +
            translateGalleryViewText("toGrade") +
            " " +
            grading.nextGrade.name
        : translateGalleryViewText("topThreshold"),
    ),
  );
  appendElements(
    summary,
    createGalleryTable(
      [translateGalleryViewText("breakdown"), translateGalleryViewText("points")],
      [
        {
          cells: [translateGalleryViewText("baseScore"), formatGalleryNumber(grading.baseScore)],
        },
        {
          cells: [
            translateGalleryViewText("bonusScore"),
            "+" + formatGalleryNumber(grading.bonusScore),
          ],
        },
        {
          cells: [translateGalleryViewText("multiplier"), "×" + grading.multiplier.toFixed(3)],
        },
        {
          cells: [
            translateGalleryViewText("tokens"),
            grading.tokens + " / " + gallerySet.maxTokens,
          ],
        },
      ],
    ),
  );
  appendElements(
    this.panel,
    summary,
    createGalleryTextElement("h3", translateGalleryViewText("thresholds")),
    createGalleryTable(
      [
        translateGalleryViewText("grade"),
        translateGalleryViewText("requiredScore"),
        translateGalleryViewText("remaining"),
        translateGalleryViewText("rewards"),
      ],
      gallerySet.grades.map((gradeLevel) => ({
        active: grading.complete && grading.totalScore >= gradeLevel.requiredScore,
        cells: [
          gradeLevel.name,
          formatGalleryNumber(gradeLevel.requiredScore),
          formatGalleryNumber(Math.max(0, gradeLevel.requiredScore - grading.totalScore)),
          [
            gradeLevel.tokens ? gradeLevel.tokens + " " + translateGalleryViewText("tokens") : "",
            ...gradeLevel.rewards.map((reward) => reward.count + " × " + reward.label),
          ]
            .filter(Boolean)
            .join(" · ") || "—",
        ],
      })),
    ),
  );
  appendElements(
    this.panel,
    createGalleryTextElement("h3", translateGalleryViewText("bonuses")),
    createGalleryTextElement("p", translateGalleryViewText("bonusExplanation"), "gallery-note"),
  );
  const tagsContainer = createElement("div", {
    className: "gallery-tags",
  });
  for (const bonus of grading.bonuses) {
    const bonusDetails = createElement("details", {
      className: bonus.percent ? "gallery-tag active" : "gallery-tag",
    });
    appendElements(
      bonusDetails,
      createGalleryTextElement(
        "summary",
        bonus.name +
          " · " +
          bonus.count +
          " · +" +
          bonus.percent +
          "% · +" +
          formatGalleryNumber(bonus.points),
      ),
      createGalleryTextElement("p", bonus.description),
      createGalleryTextElement(
        "p",
        translateGalleryViewText("matchedScore") + ": " + formatGalleryNumber(bonus.matchedScore),
      ),
      createGalleryTextElement(
        "p",
        bonus.tiers
          .map(
            (tier) =>
              tier.minItems +
              " " +
              translateGalleryViewText("cards") +
              " → +" +
              tier.bonusPercent +
              "%",
          )
          .join(" / "),
      ),
    );
    if (bonus.nextTier) {
      appendElements(
        bonusDetails,
        createGalleryTextElement(
          "p",
          bonus.nextTier.minItems - bonus.count + " " + translateGalleryViewText("toNextBonus"),
        ),
      );
    }
    appendElements(tagsContainer, bonusDetails);
  }
  appendElements(
    this.panel,
    tagsContainer,
    createGalleryTextElement("p", translateGalleryViewText("estimateNote"), "gallery-note"),
  );
  if (grading.estimatedItems) {
    appendElements(
      this.panel,
      createGalleryTextElement(
        "p",
        grading.estimatedItems + " " + translateGalleryViewText("estimatedItems"),
        "gallery-note",
      ),
    );
  }
  const ratingReference = createElement("details", {
    className: "gallery-reference",
  });
  appendElements(
    ratingReference,
    createGalleryTextElement("summary", translateGalleryViewText("ratingTable")),
    createGalleryTable(
      [translateGalleryViewText("rating"), translateGalleryViewText("points")],
      Object.entries(galleryPointsByRating)
        .reverse()
        .map(([rating, points]) => ({
          cells: [rating, formatGalleryNumber(points)],
        })),
    ),
  );
  appendElements(this.panel, ratingReference);
};

GalleryViewImpl.prototype.destroyGeneratedElements = function () {
  this.clearCards();
  this.selectionButtons.clear();
  for (const [dropdown, handler] of [
    [this.cardFilter, this._cardFilterChanged],
    [this.category, this._categoryChanged],
    [this.set, this._setChanged],
    [this.sortBy, this._sortChanged],
  ]) {
    dropdown.removeTarget(this, handler, EventType.CHANGE);
    dropdown.destroy();
  }
  UTClubSearchResultsView.prototype.destroyGeneratedElements.call(this);
};

export const GalleryView = GalleryViewImpl;
