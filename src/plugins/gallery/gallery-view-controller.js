/**
 * `GalleryViewController` (extends `AlbumViewController`), pushed by `openGallery`: loads a
 * gallery set's players (cached per criteria), adds owner info, manages the selected cards
 * (manual, auto-fill, clear) and computes grade, bonuses and tokens for the view.
 *
 * Invariants:
 * - `init` delegates to `AlbumViewController.prototype.init` (which calls the overridden
 *   `_restoreSelection` and sets `initialized`) before observing the gallery observables;
 *   `dealloc` unobserves them before the album `dealloc`.
 * - Shares the `requestId`/`active` guards of the album controller.
 *   `_requestItems(autoSelect, clearCache)`: a set change auto-selects, refresh clears
 *   `galleryCriteriaSearchCache`.
 * - Search results are filtered again with the set criteria (set 113: foil subtype 0 or 1);
 *   `selectedCards` is pruned to the loaded definition ids after each load.
 * - Grade: base = sum of the unique selected card scores (at most `requiredItems`); each bonus
 *   tag applies its rules in sequence and adds `floor(matchedScore * tierPercent / 100)`; the
 *   grade and tokens count only for a complete selection, tokens summing every reached grade.
 */
import { searchConceptItemsPaged } from "../../club/concept-items.js";
import { configuration } from "../../config/configuration.js";
import { translate } from "../../i18n/translations.js";
import { addOwnersToAlbumEntries, createAlbumEntries } from "../album/album-data.js";
import { AlbumViewController } from "../album/album-view-controller.js";
import {
  createGallerySearchCriteria,
  findGallerySet,
  galleryBonusTags,
  galleryCriteriaSearchCache,
  getCachedGalleryPromise,
  getGallerySetCriteria,
  registerGalleryCacheInvalidation,
} from "./gallery-data.js";
import {
  applyGalleryBonusRule,
  getGalleryItemScore,
  pickBestGalleryCardIds,
} from "./gallery-grading.js";
import { GalleryView } from "./gallery-view.js";
import { hideLoadingShield, showLoadingShield } from "../../webapp/loading-shield.js";

const translateGalleryControllerText = (translationKey) =>
  translate("plugins.gallery." + translationKey);

const GalleryViewControllerImpl = function () {
  AlbumViewController.call(this);
  this.selectedSet = null;
  this.selectedCards = new Set();
  this.sortBy = "gradingScore";
  this.cardFilter = "all";
};

JSUtils.inherits(GalleryViewControllerImpl, AlbumViewController);

GalleryViewControllerImpl.prototype._getViewInstanceFromData = function () {
  return new GalleryView();
};

GalleryViewControllerImpl.prototype.getNavigationTitle = function () {
  return translateGalleryControllerText("settings.title");
};

GalleryViewControllerImpl.prototype._getGradingScore = function (item) {
  return getGalleryItemScore(item).score;
};

GalleryViewControllerImpl.prototype.init = function () {
  if (this.initialized) {
    return;
  }
  AlbumViewController.prototype.init.call(this);
  const view = this.getView();
  view.onSetChanged.observe(this, this._setChanged);
  view.onSelectionChanged.observe(this, this._selectionChanged);
  view.onAutoFill.observe(this, this._autoFill);
  view.onClearSelection.observe(this, this._clearSelection);
  view.onRefresh.observe(this, this._refresh);
  view.onCardFilterChanged.observe(this, this._cardFilterChanged);
};

GalleryViewControllerImpl.prototype._restoreSelection = function () {
  const selection = this.getView().getSelection();
  this.selectedSet = findGallerySet(selection.setId) || null;
  this.sortBy = selection.sortBy;
  this.cardFilter = selection.cardFilter;
};

GalleryViewControllerImpl.prototype._getVisibleEntries = function () {
  return this.albumEntries.filter(
    (entry) =>
      this.cardFilter === "all" ||
      (this.cardFilter === "tracked" ? Boolean(entry.tracked) : !entry.tracked),
  );
};

GalleryViewControllerImpl.prototype._cardFilterChanged = function (
  observable,
  { filter: cardFilter },
) {
  if (["all", "tracked", "untracked"].includes(cardFilter)) {
    this.cardFilter = cardFilter;
    if (this.active) {
      this._renderAlbum();
    }
  }
};

GalleryViewControllerImpl.prototype._setChanged = function (observable, { setId: setId }) {
  this.selectedSet = findGallerySet(setId) || null;
  this.selectedCards.clear();
  this._requestItems(true);
};

GalleryViewControllerImpl.prototype._requestItems = async function (
  shouldAutoSelect = false,
  shouldClearCache = false,
) {
  if (!this.active) {
    return;
  }
  const requestId = ++this.requestId;
  const view = this.getView();
  this.albumEntries = [];
  this.clubViewModel.resetCollection([]);
  this.updateItemList([], true);
  view.setGallerySet(this.selectedSet);
  if (!configuration.enabled || !configuration.plugins.gallery.enabled) {
    view.setStatus(translateGalleryControllerText("disabled"));
    return void hideLoadingShield();
  }
  if (!this.selectedSet) {
    view.setStatus(translateGalleryControllerText("selectSet"));
    return void hideLoadingShield();
  }
  const selectedSet = this.selectedSet;
  view.setStatus(translateGalleryControllerText("loading"));
  showLoadingShield();
  try {
    if (requestId !== this.requestId) {
      return;
    }
    const searchResult = await (async function (gallerySet, clearCache = false) {
      registerGalleryCacheInvalidation();
      if (clearCache) {
        galleryCriteriaSearchCache.clear();
      }
      const foundItems = [];
      for (const criteria of getGallerySetCriteria(gallerySet)) {
        const cacheKey = JSON.stringify(criteria);
        foundItems.push(
          ...(await getCachedGalleryPromise(galleryCriteriaSearchCache, cacheKey, () =>
            searchConceptItemsPaged(createGallerySearchCriteria(criteria), Number.MAX_VALUE),
          )),
        );
      }
      const matchingItems = foundItems.filter((item) =>
        (function (candidateItem, targetSet) {
          return targetSet.id === 113
            ? [0, 1].includes(candidateItem.getFoilSubtype?.())
            : getGallerySetCriteria(targetSet).some(
                (criteria) =>
                  (criteria.club === undefined || Number(candidateItem.teamId) === criteria.club) &&
                  (criteria.league === undefined ||
                    Number(candidateItem.leagueId) === criteria.league) &&
                  (!criteria.rarities ||
                    criteria.rarities.includes(Number(candidateItem.rareflag))),
              );
        })(item, gallerySet),
      );
      return {
        entries: createAlbumEntries(matchingItems),
        availableOnly: false,
      };
    })(selectedSet, shouldClearCache);
    const albumEntries = await addOwnersToAlbumEntries(searchResult.entries);
    const { availableOnly: isAvailableOnly } = searchResult;
    if (requestId !== this.requestId) {
      return;
    }
    this.albumEntries = albumEntries;
    view.setAlbumEntries(albumEntries);
    view.setAvailableOnly(isAvailableOnly);
    if (shouldAutoSelect) {
      this.selectedCards = new Set(pickBestGalleryCardIds(selectedSet, albumEntries));
    }
    const loadedDefinitionIds = new Set(albumEntries.map((entry) => entry.item.definitionId));
    this.selectedCards = new Set(
      [...this.selectedCards].filter((definitionId) => loadedDefinitionIds.has(definitionId)),
    );
    this._updateGrade();
    this._renderAlbum();
  } catch {
    if (requestId === this.requestId) {
      view.setLoadError(translateGalleryControllerText("error"));
    }
  } finally {
    if (requestId === this.requestId) {
      hideLoadingShield();
    }
  }
};

GalleryViewControllerImpl.prototype._updateGrade = function () {
  if (!this.selectedSet) {
    return;
  }
  const selectedItems = this.albumEntries
    .filter((entry) => this.selectedCards.has(entry.item.definitionId))
    .map((entry) => entry.item);
  this.getView().setSelection(this.selectedCards, this.selectedSet.requiredItems);
  this.getView().setGrade(
    (function (gallerySet, cardItems) {
      const uniqueItems = [
        ...new Map(cardItems.map((item) => [item.definitionId, item])).values(),
      ].slice(0, gallerySet.requiredItems);
      const baseScore = uniqueItems.reduce(
        (total, item) => total + getGalleryItemScore(item).score,
        0,
      );
      const bonuses = galleryBonusTags.map((bonusTag) => {
        let matchedItems = uniqueItems;
        for (const rule of bonusTag.rules) {
          matchedItems = applyGalleryBonusRule(matchedItems, rule);
        }
        const sortedTiers = bonusTag.tiers
          .slice()
          .sort((left, right) => left.minItems - right.minItems);
        const achievedTier = sortedTiers
          .filter((tier) => matchedItems.length >= tier.minItems)
          .pop();
        const matchedScore = matchedItems.reduce(
          (total, item) => total + getGalleryItemScore(item).score,
          0,
        );
        const percent = achievedTier?.bonusPercent || 0;
        return {
          ...bonusTag,
          count: matchedItems.length,
          matchedScore: matchedScore,
          percent: percent,
          points: Math.floor((matchedScore * percent) / 100),
          nextTier: sortedTiers.find((tier) => tier.minItems > matchedItems.length),
        };
      });
      const bonusScore = bonuses.reduce((total, bonus) => total + bonus.points, 0);
      const totalScore = baseScore + bonusScore;
      const complete = uniqueItems.length === gallerySet.requiredItems;
      const sortedGrades = gallerySet.grades
        .slice()
        .sort((left, right) => left.requiredScore - right.requiredScore);
      const achievedGrade = sortedGrades.filter((grade) => totalScore >= grade.requiredScore).pop();
      const nextGrade = sortedGrades.find((grade) => grade.requiredScore > totalScore);
      return {
        baseScore: baseScore,
        bonusScore: bonusScore,
        totalScore: totalScore,
        bonuses: bonuses,
        complete: complete,
        count: uniqueItems.length,
        grade: complete ? achievedGrade?.name : null,
        scoreGrade: achievedGrade?.name,
        nextGrade: nextGrade,
        remaining: nextGrade ? nextGrade.requiredScore - totalScore : 0,
        multiplier: baseScore ? totalScore / baseScore : 1,
        tokens: complete
          ? sortedGrades
              .filter((grade) => totalScore >= grade.requiredScore)
              .reduce((total, grade) => total + grade.tokens, 0)
          : 0,
        estimatedItems: uniqueItems.filter((item) => getGalleryItemScore(item).estimated).length,
      };
    })(this.selectedSet, selectedItems),
  );
};

GalleryViewControllerImpl.prototype._selectionChanged = function (
  observable,
  { definitionId: definitionId },
) {
  if (
    this.albumEntries.find((entry) => entry.item.definitionId === definitionId) &&
    this.selectedSet
  ) {
    if (this.selectedCards.has(definitionId)) {
      this.selectedCards.delete(definitionId);
    } else if (this.selectedCards.size < this.selectedSet.requiredItems) {
      this.selectedCards.add(definitionId);
    }
    this._updateGrade();
  }
};

GalleryViewControllerImpl.prototype._autoFill = function () {
  if (this.selectedSet) {
    this.selectedCards = new Set(pickBestGalleryCardIds(this.selectedSet, this.albumEntries));
    this._updateGrade();
  }
};

GalleryViewControllerImpl.prototype._clearSelection = function () {
  this.selectedCards.clear();
  this._updateGrade();
};

GalleryViewControllerImpl.prototype._refresh = function () {
  this._requestItems(false, true);
};

GalleryViewControllerImpl.prototype.dealloc = function () {
  const view = this.getView();
  for (const observable of [
    view.onSetChanged,
    view.onSelectionChanged,
    view.onAutoFill,
    view.onClearSelection,
    view.onRefresh,
    view.onCardFilterChanged,
  ]) {
    observable.unobserve(this);
  }
  AlbumViewController.prototype.dealloc.call(this);
};

export const GalleryViewController = GalleryViewControllerImpl;
