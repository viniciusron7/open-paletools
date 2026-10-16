/**
 * `EnhancedSearchFiltersControl(model, renderContainers)`: control editing an
 * `SbcTemplateSearchSettings` (min/max rating, max players, players from the same club and the
 * ignore-positions and league/nation toggles); one per filter step of the template editor view.
 *
 * Invariants:
 * - It is not linked with `JSUtils.inherits`: it only calls `UTControl.call(this)` and defines
 *   its own `getRootElement`. Nothing here calls `init()` or `_generate`, so it relies on the
 *   base constructor to generate it; `_model` and `_renderContainers` must be set before that
 *   call.
 * - Edits go straight to the model setters; toggle ids `ignore-positions`,
 *   `important-leagues-only`, `unimportant-leagues-only`, `important-nations-only`,
 *   `unimportant-nations-only`.
 * - CSS classes `enhaced-search-filters` (sic) and `sbc-ratings-container` are styled by the
 *   template builder stylesheet (`min-rating`, `max-rating`, `max-players`,
 *   `max-players-from-club` and `sbc-settings` have no rule); translations
 *   `controls.enhacedSearchFilters.*`.
 *
 * Known issues (kept as-is):
 * - `typeof renderContainers === undefined` is always false, so the intended default `true` never
 *   applies (the only caller passes `isPhone()`).
 * - `destroyGeneratedElements` calls the undeclared global `remove(...)`, which throws a
 *   ReferenceError after the child controls are destroyed, so `__root` is never cleared.
 */
import { addClasses, appendElements, createElement } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { SbcTemplateSearchSettings } from "./models.js";
import { GridLayout } from "../../ui/components/grid-layout.js";
import { LabelWithTextInputControl } from "../../ui/controls/label-with-text-input-control.js";

const EnhancedSearchFiltersControlImpl = function (model, renderContainers) {
  this._renderContainers = typeof renderContainers === undefined || renderContainers;
  this._model = model || new SbcTemplateSearchSettings();
  UTControl.call(this);
};

EnhancedSearchFiltersControlImpl.prototype.renderContainers = function (renderContainers) {
  this._renderContainers = renderContainers;
};

EnhancedSearchFiltersControlImpl.prototype._generate = function () {
  if (!this.generated) {
    const root = createElement("div", {
      className: "enhaced-search-filters",
    });
    this._ratingTitle = createElement("h4");
    this._ratingTitle.textContent = translate("controls.enhacedSearchFilters.ratings.title");
    appendElements(root, this._ratingTitle);
    this._minRating = new LabelWithTextInputControl();
    this._minRating.init();
    addClasses(this._minRating, "min-rating");
    this._minRating.setInputType("number");
    this._minRating.setLabel(translate("controls.enhacedSearchFilters.ratings.min.label"));
    this._minRating.onChange((inputElement) => {
      this._model.setMinRating(inputElement.value);
    });
    this._maxRating = new LabelWithTextInputControl();
    this._maxRating.init();
    addClasses(this._maxRating, "max-rating");
    this._maxRating.setInputType("number");
    this._maxRating.setLabel(translate("controls.enhacedSearchFilters.ratings.max.label"));
    this._maxRating.onChange((inputElement) => {
      this._model.setMaxRating(inputElement.value);
    });
    if (this._renderContainers) {
      const ratingsContainer = document.createElement("div");
      addClasses(ratingsContainer, "sbc-ratings-container");
      appendElements(ratingsContainer, this._minRating, this._maxRating);
      appendElements(root, ratingsContainer);
    } else {
      appendElements(root, this._minRating, this._maxRating);
    }
    this._settingsTitle = document.createElement("h4");
    this._settingsTitle.textContent = translate("controls.enhacedSearchFilters.settings.title");
    root.appendChild(this._settingsTitle);
    this._maxPlayers = new LabelWithTextInputControl();
    this._maxPlayers.init();
    addClasses(this._maxPlayers, "max-players");
    this._maxPlayers.setInputType("number");
    this._maxPlayers.setLabel(translate("controls.enhacedSearchFilters.settings.maxPlayers.label"));
    this._maxPlayers.onChange((inputElement) => {
      this._model.setMaxPlayers(inputElement.value);
    });
    this._playersFromSameClub = new LabelWithTextInputControl();
    this._playersFromSameClub.init();
    addClasses(this._playersFromSameClub, "max-players-from-club");
    this._playersFromSameClub.setInputType("number");
    this._playersFromSameClub.setLabel(
      translate("controls.enhacedSearchFilters.settings.playersFromSameClub.label"),
    );
    this._playersFromSameClub.onChange((inputElement) => {
      this._model.setPlayersFromSameClub(inputElement.value);
    });
    this._searchToggles = new UTToggleControlGroupView();
    this._searchToggles.init();
    this._searchToggles.addToggleCell(
      "ignore-positions",
      translate("controls.enhacedSearchFilters.search.ignorePlayersPos"),
    );
    this._searchToggles.addToggleCell(
      "important-leagues-only",
      translate("controls.enhacedSearchFilters.search.importantLeaguesOnly"),
    );
    this._searchToggles.addToggleCell(
      "unimportant-leagues-only",
      translate("controls.enhacedSearchFilters.search.unimportantLeaguesOnly"),
    );
    this._searchToggles.addToggleCell(
      "important-nations-only",
      translate("controls.enhacedSearchFilters.search.importantNationsOnly"),
    );
    this._searchToggles.addToggleCell(
      "unimportant-nations-only",
      translate("controls.enhacedSearchFilters.search.unimportantNationsOnly"),
    );
    this._searchToggles.addTarget(
      this,
      (control, eventType, eventData) => {
        switch (eventData.id) {
          case "ignore-positions":
            this._model.setIgnorePositions(eventData.checked);
            break;
          case "important-leagues-only":
            this._model.setImportantLeaguesOnly(eventData.checked);
            break;
          case "unimportant-leagues-only":
            this._model.setUnimportantLeaguesOnly(eventData.checked);
            break;
          case "important-nations-only":
            this._model.setImportantNationsOnly(eventData.checked);
            break;
          case "unimportant-nations-only":
            this._model.setUnimportantNationsOnly(eventData.checked);
        }
      },
      EventType.CHANGE,
    );
    this._searchToggles.layoutSubviews();
    if (this._renderContainers) {
      const settingsTable = new GridLayout(root, {
        className: "sbc-settings",
      });
      appendElements(settingsTable.addRow().addColumn(), this._maxPlayers);
      appendElements(settingsTable.addRow().addColumn(), this._playersFromSameClub);
      appendElements(settingsTable.addRow().addColumn(), this._searchToggles);
      appendElements(root, settingsTable);
    } else {
      appendElements(root, this._maxPlayers, this._playersFromSameClub, this._searchToggles);
    }
    this.update(this._model);
    this.__root = root;
    this.generated = true;
  }
};

EnhancedSearchFiltersControlImpl.prototype.update = function (model) {
  this._model = model;
  if (this._model) {
    this._minRating.setInputValue(this._model.minRating);
    this._maxRating.setInputValue(this._model.maxRating);
    this._maxPlayers.setInputValue(this._model.maxPlayers);
    this._playersFromSameClub.setInputValue(this._model.playersFromSameClub);
    if (this._model.ignorePlayerPos) {
      this._searchToggles.toggleById("ignore-positions");
    }
    if (this._model.importantLeaguesOnly) {
      this._searchToggles.toggleById("important-leagues-only");
    }
    if (this._model.unimportantLeaguesOnly) {
      this._searchToggles.toggleById("unimportant-leagues-only");
    }
    if (this._model.importantNationsOnly) {
      this._searchToggles.toggleById("important-nations-only");
    }
    if (this._model.unimportantNationsOnly) {
      this._searchToggles.toggleById("unimportant-nations-only");
    }
  }
};

EnhancedSearchFiltersControlImpl.prototype.destroyGeneratedElements = function () {
  this._minRating.destroy();
  this._maxRating.destroy();
  this._maxPlayers.destroy();
  this._playersFromSameClub.destroy();
  this._searchToggles.destroy();
  remove(this.__root);
  this.__root = null;
};

EnhancedSearchFiltersControlImpl.prototype.getRootElement = function () {
  return this.__root;
};

export const EnhancedSearchFiltersControl = EnhancedSearchFiltersControlImpl;
