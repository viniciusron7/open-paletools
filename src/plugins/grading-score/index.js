/**
 * Grading score plugin `gradingScorePlugin` (order 10001), installed by the plugin list in
 * src/bootstrap/boot.js: shows each item's `sbsScore` on item cells, large player cards and squad
 * slots, plus pitch/bench/reserve/total sums on SBC squad overviews.
 *
 * Hooks (after-hooks via `hookPrototypeMethod`, registered in `run()`):
 * - `_generate` of `UTItemTableCellView`, `UTLargePlayerItemView` and `UTSquadSlotView` add a
 *   hidden `__gradingScore` through `addItemValue` (patched in by src/webapp/patches.js).
 * - `UTSquadOverviewView._generate` builds `__gradingScoresContainer` with pitch/bench/reserve/
 *   total `ItemValueDisplay`s for `UTSBCSquadOverviewView` instances.
 * - `UTSBCSquadOverviewView.setSquad`/`updateSlot`, `UTPaginatedItemListView._renderItems`,
 *   `UTSectionedItemListView.render`, `UTStoreRevealModalListView.addItems` and
 *   `UTLargePlayerItemView.renderItem` fill the values.
 *
 * Invariants:
 * - Every hook checks `configuration.enabled && gradingScore.enabled` at call time; stylesheet
 *   `paletools-grading-score` is inserted only if enabled when `run()` executes.
 * - Slot index 0-10 counts as pitch, 11-17 as bench, the rest as reserve; manager slots are
 *   skipped by `updateSlot`.
 *
 * Known issues (kept as-is):
 * - `__gradingScoreSquad` is created but never appended or updated.
 * - A slot whose item has no `sbsScore` is hidden but keeps its previous value, which
 *   `updateSquadGradingTotals` still adds to the sums.
 * - Views generated while the plugin was off lack `__gradingScore` / the totals; once it is
 *   enabled at runtime, re-rendering such a view makes the hooks throw.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { appendElements, createElement } from "../../core/dom.js";
import { hookPrototypeMethod } from "../../core/prototype-override.js";
import { translate } from "../../i18n/translations.js";
import { ItemValueDisplay } from "../../ui/components/item-value-display.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import gradingScoreCss from "./grading-score.css";

let gradingScorePluginDefinition;

const gradingScoreSettings = configuration.plugins.gradingScore;

gradingScorePluginDefinition = {
  run: function () {
    function updateSquadGradingTotals(squadView) {
      let totalScore = 0;
      let pitchScore = 0;
      let benchScore = 0;
      let reserveScore = 0;
      for (let slotView of squadView.slotViews) {
        const slotIndex = slotView.getIndex();
        const score = parseInt(slotView.__gradingScore.getValue());
        if (score) {
          totalScore += score;
          if (slotIndex >= 0 && slotIndex <= 10) {
            pitchScore += score;
          } else if (slotIndex >= 11 && slotIndex <= 17) {
            benchScore += score;
          } else {
            reserveScore += score;
          }
        }
      }
      squadView.__gradingScoreTotal.setValue(totalScore);
      squadView.__gradingScorePitch.setValue(pitchScore);
      squadView.__gradingScoreBench.setValue(benchScore);
      squadView.__gradingScoreReserve.setValue(reserveScore);
      showElements(squadView.__gradingScoresContainer);
    }
    function renderGradingScores(getViews, getItem) {
      for (let view of getViews()) {
        const sbsScore = getItem(view).sbsScore;
        if (sbsScore) {
          view.__gradingScore.setValue(sbsScore);
          showElements(view.__gradingScore);
        } else {
          hideElements(view.__gradingScore);
        }
      }
    }
    if (configuration.enabled && gradingScoreSettings.enabled) {
      upsertStylesheet("paletools-grading-score", gradingScoreCss);
    }
    hookPrototypeMethod(
      [UTItemTableCellView, UTLargePlayerItemView, UTSquadSlotView],
      "_generate",
      null,
      function () {
        if (configuration.enabled && gradingScoreSettings.enabled) {
          this.__gradingScore = this.addItemValue(0, "grading-score");
          hideElements(this.__gradingScore);
        }
      },
    );
    hookPrototypeMethod(UTSquadOverviewView, "_generate", null, function (...args) {
      if (
        configuration.enabled &&
        gradingScoreSettings.enabled &&
        this instanceof UTSBCSquadOverviewView
      ) {
        this.__gradingScoresContainer = createElement("div", {
          className: "item-values-container squad-value squad-grading",
        });
        this.__gradingScoreSquad = new ItemValueDisplay(0, "grading-score");
        appendElements(this.__squadValuesContainer, this.__gradingScoresContainer);
        this.__gradingScorePitch = new ItemValueDisplay(0, "grading-score pitch");
        this.__gradingScorePitch.setCaption(translate("pitch"));
        this.__gradingScoreBench = new ItemValueDisplay(0, "grading-score bench");
        this.__gradingScoreBench.setCaption(translate("dock.label.substitutes"));
        this.__gradingScoreReserve = new ItemValueDisplay(0, "grading-score reserve");
        this.__gradingScoreReserve.setCaption(translate("dock.label.reserves"));
        this.__gradingScoreTotal = new ItemValueDisplay(0, "grading-score total");
        this.__gradingScoreTotal.setCaption(translate("extendedPlayerInfo.total"));
        appendElements(
          this.__gradingScoresContainer,
          this.__gradingScorePitch,
          this.__gradingScoreBench,
          this.__gradingScoreReserve,
          this.__gradingScoreTotal,
        );
        hideElements(this.__gradingScoresContainer);
      }
    });
    hookPrototypeMethod(UTSBCSquadOverviewView, "setSquad", null, function (...args) {
      if (configuration.enabled && gradingScoreSettings.enabled) {
        renderGradingScores(
          () => this.slotViews,
          (slotView) => args[0].getSlot(slotView.getIndex()).getItem(),
        );
        updateSquadGradingTotals(this);
      }
    });
    hookPrototypeMethod(UTSBCSquadOverviewView, "updateSlot", null, function (...args) {
      if (!configuration.enabled || !gradingScoreSettings.enabled) {
        return;
      }
      const slot = args[0];
      if (!slot._isManager) {
        renderGradingScores(
          () => [this.getSlotByIndex(slot.getIndex())],
          (slotView) => slot.getItem(),
        );
        updateSquadGradingTotals(this);
      }
    });
    hookPrototypeMethod(UTPaginatedItemListView, "_renderItems", null, function (unusedArgument1) {
      if (configuration.enabled && gradingScoreSettings.enabled) {
        renderGradingScores(
          () => this.listRows,
          (row) => row.data,
        );
      }
    });
    hookPrototypeMethod(UTSectionedItemListView, "render", null, function () {
      if (configuration.enabled && gradingScoreSettings.enabled) {
        renderGradingScores(
          () => this.listRows,
          (row) => row.data,
        );
      }
    });
    hookPrototypeMethod(UTStoreRevealModalListView, "addItems", null, function () {
      if (configuration.enabled && gradingScoreSettings.enabled) {
        renderGradingScores(
          () => this.listRows,
          (row) => row.data,
        );
      }
    });
    hookPrototypeMethod(UTLargePlayerItemView, "renderItem", null, function (...args) {
      if (configuration.enabled && gradingScoreSettings.enabled) {
        renderGradingScores(
          () => [this],
          (view) => args[0],
        );
      }
    });
  },
  order: 10001,
  settings: {
    name: "gradingScore",
    title: "plugins.gradingScore.settings.title",
    menu: function () {
      const menuContainer = document.createElement("div");
      appendToggle(menuContainer, "enabled", gradingScoreSettings.enabled, (isEnabled) => {
        gradingScoreSettings.enabled = isEnabled;
        persistConfiguration();
      });
      return menuContainer;
    },
  },
};

export const gradingScorePlugin = gradingScorePluginDefinition;
