/**
 * Player action module (default and auction panels): a button that opens the current player's
 * fut.gg page.
 *
 * Invariants:
 * - URL `https://www.fut.gg/players/<slug>/<APP_YEAR_SHORT>-<definitionId>`, slug = full name
 *   lowercased, diacritics removed, spaces replaced by '-'; opened with `getPageWindow().open`;
 *   setting `playerActions.futggSearch`; class `paletools-element`.
 *
 * Known issues (kept as-is):
 * - `dealloc` calls `panel.onFutggSearch.dealloc()`, but nothing sets `onFutggSearch`.
 */
import { configuration } from "../../config/configuration.js";
import { removeDiacritics } from "../../core/diacritics.js";
import { appendElements } from "../../core/dom.js";
import { getPageWindow } from "../../core/page-window.js";
import { translate } from "../../i18n/translations.js";

const futggSearchActionSettings = configuration.plugins.playerActions;

export const futggSearchActionModule = {
  canRun: (panelViewType) =>
    panelViewType === UTDefaultActionPanelView || panelViewType === UTAuctionActionPanelView,
  generate: (panelView, getActionsContainer) => {
    if (futggSearchActionSettings.futggSearch) {
      panelView._futggSearchButton = new UTGroupButtonControl();
      panelView._futggSearchButton.init();
      panelView._futggSearchButton.setText(translate("plugins.playerActions.futggSearch"));
      panelView._futggSearchButton.addTarget(
        panelView,
        () => {
          if (panelView._currentItem) {
            getPageWindow().open(
              "https://www.fut.gg/players/" +
                removeDiacritics(
                  panelView._currentItem.getStaticData().getFullName().toLowerCase(),
                ).replaceAll(" ", "-") +
                "/" +
                APP_YEAR_SHORT +
                "-" +
                panelView._currentItem.definitionId,
            );
          }
        },
        EventType.TAP,
      );
      panelView._futggSearchButton.getRootElement().classList.add("paletools-element");
      appendElements(getActionsContainer(panelView), panelView._futggSearchButton.getRootElement());
    }
  },
  destroyGeneratedElements: (panelView) => {
    if (panelView._futggSearchButton) {
      panelView._futggSearchButton.destroy();
    }
  },
  dealloc: (panelView) => {
    if (panelView.onFutggSearch) {
      panelView.onFutggSearch.dealloc();
    }
  },
};
