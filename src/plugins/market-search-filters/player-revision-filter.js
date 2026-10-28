/**
 * `PlayerRevisionFilter`: the Revision filter of the Transfer Market search filters (added in
 * 27.2.1, setting `marketSearchFilters.revisionFilters`). A `<details>` element listing every
 * card revision of the selected player (large item views) plus an "All revisions" option; picking
 * one calls `onSelected(item | null)`, which the market-search-filters plugin turns into a Player
 * ID filter.
 *
 * Invariants:
 * - `load(definitionId)` fetches the revisions with `searchConceptItemsPaged` (concept items of
 *   `defId`, all pages), de-duplicates them by definitionId and sorts by definitionId; with one
 *   revision or less nothing is shown. Options are added one per macrotask (`setTimeout(0)`).
 * - Every `clear()` increments `generation`: a load that finishes after a newer clear/load, or
 *   after `isEnabled()` turned false, stops without touching the view.
 * - On a failed load the filter shows `controls.playerRevisions.revisionError` in place of the
 *   options.
 * - Cards are rendered from a copy of the item with `concept` / `isConceptPlayer` false; `clear`
 *   and `destroy` destroy the card views and drop the option click handlers.
 * - The stylesheet `paletools-player-revision-filter` is upserted by every constructor call.
 */
import { appendElements, createElement } from "../../core/dom.js";
import { searchConceptItemsPaged } from "../../club/concept-items.js";
import { translate } from "../../i18n/translations.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import playerRevisionFilterCss from "./player-revision-filter.css";

const translatePlayerRevisionsText = (translationKey) =>
  translate("controls.playerRevisions." + translationKey);

export class PlayerRevisionFilter {
  constructor(isEnabled, onSelected) {
    upsertStylesheet("paletools-player-revision-filter", playerRevisionFilterCss);
    this.isEnabled = isEnabled;
    this.onSelected = onSelected;
    this.generation = 0;
    this.cards = [];
    this.options = [];
    this.items = [];
    this.root = createElement("details", {
      className: "player-revision-filter",
    });
    this.summary = createElement("summary");
    this.list = createElement("div", {
      className: "player-revision-filter-options",
    });
    appendElements(this.root, this.summary, this.list);
    this.root.hidden = true;
  }
  ["getRootElement"]() {
    return this.root;
  }
  ["getSelectedPlayer"]() {
    return this.items.find((item) => item.definitionId === this.selectedDefinitionId) || null;
  }
  ["setSelectedPlayer"](definitionId) {
    this.selectedDefinitionId = Number(definitionId) || null;
    this.syncSelection();
  }
  ["clear"]() {
    this.generation++;
    this.playerId = null;
    this.selectedDefinitionId = null;
    this.items = [];
    this.cards.forEach((card) => card.destroy());
    this.cards = [];
    this.options.forEach((option) => {
      option.onclick = null;
    });
    this.options = [];
    this.list.replaceChildren();
    this.root.open = false;
    this.root.hidden = true;
  }
  async ["load"](playerId) {
    playerId = Number(playerId);
    if (!(this.isEnabled() && playerId > 0)) {
      return void this.clear();
    }
    if (this.playerId === playerId) {
      return void this.syncSelection();
    }
    this.clear();
    this.playerId = playerId;
    const generation = this.generation;
    const isCurrent = () => generation === this.generation && this.isEnabled();
    try {
      const searchCriteria = new UTSearchCriteriaDTO();
      searchCriteria.type = SearchType.PLAYER;
      searchCriteria.defId = playerId.toString();
      searchCriteria.offset = 0;
      const revisions = await searchConceptItemsPaged(searchCriteria, Number.MAX_SAFE_INTEGER);
      if (!isCurrent()) {
        return;
      }
      this.items = [...new Map(revisions.map((item) => [item.definitionId, item])).values()].sort(
        (left, right) => left.definitionId - right.definitionId,
      );
      if (this.items.length <= 1) {
        return;
      }
      this.addOption(null);
      for (let index = 0; index < this.items.length; index++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!isCurrent()) {
          return;
        }
        this.addOption(this.items[index]);
      }
      this.syncSelection();
      this.root.hidden = false;
    } catch {
      if (!isCurrent()) {
        return;
      }
      this.clear();
      this.summary.textContent = translatePlayerRevisionsText("revision");
      const errorMessage = createElement("p", {
        role: "status",
      });
      errorMessage.textContent = translatePlayerRevisionsText("revisionError");
      appendElements(this.list, errorMessage);
      this.root.hidden = false;
    }
  }
  ["label"](item) {
    return item
      ? item.rating +
          " — " +
          translate("item.raretype" + item.rareflag) +
          (item.hasHyperCosmetics?.() ? " — " + translatePlayerRevisionsText("holographic") : "")
      : translatePlayerRevisionsText("allRevisions");
  }
  ["addOption"](item) {
    const option = createElement("button", {
      type: "button",
      className: "player-revision-filter-option",
    });
    option.setAttribute("aria-label", this.label(item));
    if (item) {
      const card = UTItemViewFactory.createLargeItem(item);
      card.init();
      const displayedItem = Object.assign(Object.create(Object.getPrototypeOf(item)), item, {
        concept: false,
        isConceptPlayer: false,
      });
      this.cards.push(card);
      card.render(displayedItem);
      appendElements(option, card);
    } else {
      option.textContent = translatePlayerRevisionsText("allRevisions");
    }
    option.onclick = (event) => {
      event.stopPropagation();
      if (this.isEnabled()) {
        this.setSelectedPlayer(item?.definitionId);
        this.onSelected(item);
        this.root.open = false;
      }
    };
    this.options.push(option);
    appendElements(this.list, option);
  }
  ["syncSelection"]() {
    const selectedPlayer = this.getSelectedPlayer();
    this.summary.textContent =
      translatePlayerRevisionsText("revision") + ": " + this.label(selectedPlayer);
    this.options.forEach((option, index) => {
      option.setAttribute(
        "aria-pressed",
        String(index === (selectedPlayer ? this.items.indexOf(selectedPlayer) + 1 : 0)),
      );
    });
  }
  ["destroy"]() {
    this.clear();
    this.root.remove();
  }
}
