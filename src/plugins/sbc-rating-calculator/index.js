/**
 * SBC rating calculator plugin (order 6), installed by the plugin list in src/bootstrap/boot.js:
 * a button (`#sbc-rating-calculator-button`) on the SBC squad summary banner opens a dialog
 * listing, page by page, the ratings for the empty rated slots that reach the challenge's
 * TEAM_RATING (`SquadRatingCalculator`).
 *
 * Hooks (installed in `run()`):
 * - `UTSBCSquadOverviewViewController.initWithSBCSet` (after the original; when the plugin and
 *   Paletools are enabled) wires the button through the new
 *   `UTSBCSquadSummaryBannerView.prototype.onCalculateRatingTap`, or hides it when the challenge
 *   has no TEAM_RATING requirement.
 * - `UTSBCSquadSummaryBannerView._generate` (after the original) creates `_calculateRating` once
 *   (`_paletoolsGenerated`).
 *
 * Invariants:
 * - Rated slots are the first 11 slots without a requirement or with a DEFAULT player
 *   requirement; combinations cover those without a rated item. Their number is not capped.
 * - The range inputs default to target - `lowerBound` and target + `upperBound`
 *   (`plugins.sbcRatingCalculator`); the computation is deferred with `setTimeout(..., 0)`; 6
 *   tables per page on phone, 15 otherwise (fixed at `run()`).
 * - Dialog ids `sbc-rating-calculator`, `-options`, `-from`, `-to`, `-button-container`,
 *   `-container` and `-pager` are styled by stylesheet `paletools-sbc-rating-calculator`, which
 *   APP_ENABLED / APP_DISABLED add and remove; each banner also adds show/hide listeners for its
 *   button that are never removed.
 *
 * Known issues (kept as-is):
 * - `pages` is not reset when "calculate" is pressed again, so new tables join the old pages.
 * - When no combination reaches the target, `pages[0]` is undefined and rendering throws.
 * - On the last page (index > 0) both pager buttons stay visible; "next" moves past the end.
 * - Unparsable range inputs fall back to the raw `lowerBound`/`upperBound` offsets instead of
 *   target -/+ bound.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { addClasses, appendElements, createElement, queryElement } from "../../core/dom.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { translate } from "../../i18n/translations.js";
import { SquadRatingCalculator } from "../../sbc/squad-rating.js";
import { DataTable } from "../../ui/components/data-table.js";
import { showDialog } from "../../ui/dialog.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { removeStylesheet, upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import sbcRatingCalculatorCss from "./sbc-rating-calculator.css";

let sbcRatingCalculatorPluginDefinition;

const sbcRatingCalculatorSettings = configuration.plugins.sbcRatingCalculator;

function addSbcRatingCalculatorStyles() {
  upsertStylesheet("paletools-sbc-rating-calculator", sbcRatingCalculatorCss);
}

function createSbcRatingCalculatorSettingsMenu() {
  const container = document.createElement("div");
  appendToggle(container, "enabled", sbcRatingCalculatorSettings.enabled, (isEnabled) => {
    sbcRatingCalculatorSettings.enabled = isEnabled;
    persistConfiguration();
  });
  return container;
}

sbcRatingCalculatorPluginDefinition = {
  run: function () {
    const tablesPerPage = isPhone() ? 6 : 15;
    const originalInitWithSBCSet = UTSBCSquadOverviewViewController.prototype.initWithSBCSet;
    UTSBCSquadOverviewViewController.prototype.initWithSBCSet = function (...args) {
      originalInitWithSBCSet.call(this, ...args);
      if (!sbcRatingCalculatorSettings.enabled || !configuration.enabled) {
        return;
      }
      const sbcSet = args[0];
      const challengeId = args[1];
      const challenge = sbcSet.getChallenge(challengeId);
      const teamRatingRequirement = challenge.eligibilityRequirements.find(
        (requirement) => requirement.getFirstKey() === SBCEligibilityKey.TEAM_RATING,
      );
      if (teamRatingRequirement) {
        this.getView()
          .getSummaryPanel()
          .onCalculateRatingTap(() => {
            const ratedSlots = challenge.squad
              .getPlayers()
              .slice(0, 11)
              .filter(
                (slot) =>
                  slot.requirement === null ||
                  slot.requirement.playerType === SBCPlayerRequirementType.DEFAULT,
              );
            const ratedSlotCount = ratedSlots.length;
            const existingRatings = ratedSlots
              .filter((slot) => slot.getItem().rating > 0)
              .map((slot) => slot.getItem().rating);
            const targetRating = teamRatingRequirement.getValue(SBCEligibilityKey.TEAM_RATING)[0];
            const rangeStart = targetRating - sbcRatingCalculatorSettings.lowerBound;
            const rangeEnd = targetRating + sbcRatingCalculatorSettings.upperBound;
            showDialog(
              [
                {
                  labelEnum: enums.UIDialogOptions.OK,
                },
              ],
              translate("plugins.sbcRatingCalculator.dialog.title"),
              '\n                <div id="sbc-rating-calculator">\n                    <h3>' +
                translate("plugins.sbcRatingCalculator.dialog.ranges.title") +
                '</h3>\n                    <div id="sbc-rating-calculator-options">\n                        <div>\n                            <label>' +
                translate("from") +
                '</label>\n                            <input type="text" id="sbc-rating-calculator-from" value="' +
                rangeStart +
                '" />\n                        </div>\n                        <div>\n                            <label>' +
                translate("to") +
                '</label>\n                            <input type="text" id="sbc-rating-calculator-to" value="' +
                rangeEnd +
                '" />\n                        </div>\n                        <div id="sbc-rating-calculator-button-container"></div>\n                    </div>\n                    <div id="sbc-rating-calculator-container"></div>\n                    <div id="sbc-rating-calculator-pager"></div>\n                </div>',
            );
            const tablesContainer = queryElement("#sbc-rating-calculator-container");
            const previousButton = createElement(
              "div",
              {
                className: "prev",
              },
              translate("label.prev"),
            );
            const nextButton = createElement(
              "div",
              {
                className: "next",
              },
              translate("label.next"),
            );
            hideElements(previousButton);
            hideElements(nextButton);
            const pager = queryElement("#sbc-rating-calculator-pager");
            appendElements(pager, previousButton);
            appendElements(pager, nextButton);
            let currentPage = 0;
            listenForEvent(previousButton, "click", () => {
              if (currentPage > 0) {
                showPage(currentPage - 1);
              }
            });
            listenForEvent(nextButton, "click", () => {
              showPage(currentPage + 1);
            });
            const pages = [];
            function showPage(pageIndex) {
              currentPage = pageIndex;
              hideElements(previousButton);
              hideElements(nextButton);
              if (pageIndex > 0 && pages.length > 1) {
                showElements(previousButton);
                showElements(nextButton);
              } else if (pageIndex == 0 && pages.length > 1) {
                showElements(nextButton);
              } else if (pageIndex == pages.length - 1) {
                showElements(previousButton);
              }
              if (pages.length > pageIndex) {
                tablesContainer.innerHTML = "";
                for (let tableContainer of pages[pageIndex]) {
                  appendElements(tablesContainer, tableContainer);
                }
              }
            }
            const calculateButton = new UTStandardButtonControl();
            function calculateRatingCombinations() {
              tablesContainer.innerHTML = "";
              const candidateRatings = (function (start, end, step = 1) {
                return Array.from(
                  {
                    length: (end - start) / step + 1,
                  },
                  (unusedValue, index) => start + index * step,
                );
              })(
                parseInt(queryElement("#sbc-rating-calculator-from").value) ||
                  sbcRatingCalculatorSettings.lowerBound,
                parseInt(queryElement("#sbc-rating-calculator-to").value) ||
                  sbcRatingCalculatorSettings.upperBound,
              );
              const multisubsets = SquadRatingCalculator.getMultisubsets(
                candidateRatings,
                ratedSlotCount - existingRatings.length,
              );
              let iteratorResult = multisubsets.next();
              let pageIndex = 0;
              let tablesOnPage = 0;
              for (; !iteratorResult.done; ) {
                if (tablesOnPage == tablesPerPage) {
                  tablesOnPage = 0;
                  pageIndex++;
                }
                const missingRatings = iteratorResult.value;
                const squadRating = SquadRatingCalculator.getRating(
                  [...existingRatings, ...missingRatings],
                  ratedSlotCount,
                );
                if (squadRating < targetRating) {
                  iteratorResult = multisubsets.next();
                  continue;
                }
                const countByRating = missingRatings.reduce((counts, rating) => {
                  counts[rating] = (counts[rating] || 0) + 1;
                  return counts;
                }, {});
                const ratingTable = new DataTable({
                  headers: [
                    translate("plugins.sbcRatingCalculator.table.rating"),
                    translate("plugins.sbcRatingCalculator.table.count"),
                  ],
                  caption: "" + squadRating,
                });
                const tableContainer = createElement("div", {
                  className: "sbc-rating-calculator-table-container",
                });
                ratingTable.updateData(
                  Object.keys(countByRating).map((rating) => [rating, countByRating[rating]]),
                );
                appendElements(tableContainer, ratingTable);
                if (pages.length <= pageIndex) {
                  pages.push([]);
                }
                pages[pageIndex].push(tableContainer);
                iteratorResult = multisubsets.next();
                tablesOnPage++;
              }
              for (let tableContainer of pages[0]) {
                appendElements(tablesContainer, tableContainer);
              }
              if (pages.length > 1) {
                showElements(nextButton);
              }
            }
            calculateButton.init();
            calculateButton.setText(translate("plugins.sbcRatingCalculator.buttons.calculate"));
            calculateButton.addTarget(
              this,
              () => {
                setTimeout(calculateRatingCombinations, 0);
              },
              EventType.TAP,
            );
            addClasses(calculateButton, "mini");
            appendElements(
              queryElement("#sbc-rating-calculator-button-container"),
              calculateButton,
            );
          });
      } else {
        hideElements(this.getView().getSummaryPanel()._calculateRating);
      }
    };
    const originalGenerate = UTSBCSquadSummaryBannerView.prototype._generate;
    UTSBCSquadSummaryBannerView.prototype.onCalculateRatingTap = function (onTap) {
      this._calculateRating.addTarget(
        this,
        () => {
          onTap();
        },
        EventType.TAP,
      );
    };
    UTSBCSquadSummaryBannerView.prototype._generate = function (...args) {
      originalGenerate.call(this, ...args);
      if (sbcRatingCalculatorSettings.enabled && configuration.enabled) {
        if (!this._paletoolsGenerated) {
          this._calculateRating = new UTStandardButtonControl();
          this._calculateRating.init();
          this._calculateRating.setText(
            translate("plugins.sbcRatingCalculator.buttons.openDialog"),
          );
          this._calculateRating.getRootElement().id = "sbc-rating-calculator-button";
          addClasses(this._calculateRating, "mini");
          appendElements(this, this._calculateRating);
          this._paletoolsGenerated = true;
          listenForEvent(paletoolsEvents.APP_ENABLED, () => showElements(this._calculateRating));
          listenForEvent(paletoolsEvents.APP_DISABLED, () => hideElements(this._calculateRating));
        }
      }
    };
    addSbcRatingCalculatorStyles();
    listenForEvent(paletoolsEvents.APP_ENABLED, () => addSbcRatingCalculatorStyles());
    listenForEvent(paletoolsEvents.APP_DISABLED, () => {
      removeStylesheet("paletools-sbc-rating-calculator");
    });
  },
  order: 6,
  menu: createSbcRatingCalculatorSettingsMenu,
  settings: {
    name: "sbc-rating-calculator",
    title: "plugins.sbcRatingCalculator.settings.title",
    menu: createSbcRatingCalculatorSettingsMenu,
  },
};

export const sbcRatingCalculatorPlugin = sbcRatingCalculatorPluginDefinition;
