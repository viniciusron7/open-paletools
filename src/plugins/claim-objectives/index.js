/**
 * Claim objectives plugin `claimObjectivesPlugin` (order 10), installed by the plugin list in
 * src/bootstrap/boot.js: adds a button to the objectives hub tile that claims every claimable
 * objective and completed group reward.
 *
 * Hooks:
 * - `UTObjectivesHubTileContentView.prototype._generate`, wrapped in `run()` (original first);
 *   the button is built once per view (`_paletoolsGenerated`).
 *
 * Invariants:
 * - The button stays hidden until `services.Objectives.requestCategories()` returns at least one
 *   group with `objectivesReadyToRedeem > 0`; it is hidden again after claiming.
 * - Claiming is strictly sequential: per group `requestGroup`, each claimable objective via
 *   `category.claimObjectiveRewards`, then `claimGroupRewards` when all objectives are completed,
 *   with `waitForDelay(100, 300)` between calls (rate limiting).
 * - `group.objectives.values().filter(...)` relies on iterator helpers.
 *
 * Known issues (kept as-is):
 * - `run()` never checks `claimObjectives.enabled` or `configuration.enabled`; the settings
 *   toggle has no effect.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { waitForDelay } from "../../core/async.js";
import { addClasses, appendElements } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import { observableToPromise } from "../../webapp/observable.js";

let claimObjectivesPluginDefinition;

const claimObjectivesSettings = configuration.plugins.claimObjectives;

claimObjectivesPluginDefinition = {
  run: function () {
    const originalGenerate = UTObjectivesHubTileContentView.prototype._generate;
    UTObjectivesHubTileContentView.prototype._generate = function (...args) {
      originalGenerate.call(this, ...args);
      const tileView = this;
      let claimableGroupsByCategoryId = {};
      let categories = null;
      if (!this._paletoolsGenerated) {
        this._reclaimRewardsButton = new UTStandardButtonControl();
        this._reclaimRewardsButton.init();
        addClasses(this._reclaimRewardsButton, "primary");
        this._reclaimRewardsButton.setText(translate("plugins.claimObjectives.button.text"));
        this._reclaimRewardsButton.addTarget(
          this,
          () => {
            (async function () {
              tileView._reclaimRewardsButton.setInteractionState(false);
              tileView._reclaimRewardsButton.setText(
                translate("plugins.claimObjectives.button.loading"),
              );
              for (let category of categories) {
                if (claimableGroupsByCategoryId[category.id]) {
                  for (let group of claimableGroupsByCategoryId[category.id]) {
                    await observableToPromise(
                      services.Objectives.requestGroup(category, group.compositeId),
                    );
                    for (let objective of group.objectives
                      .values()
                      .filter((objective) => objective.isClaimable())) {
                      await observableToPromise(
                        category.claimObjectiveRewards(group.compositeId, objective.id),
                      );
                      await waitForDelay(100, 300);
                    }
                    if (group.objectivesCompleted === group.objectivesNumber) {
                      await observableToPromise(category.claimGroupRewards(group.compositeId));
                      await waitForDelay(100, 300);
                    }
                    await waitForDelay(100, 300);
                  }
                }
              }
              hideElements(tileView._reclaimRewardsButton);
            })();
          },
          EventType.TAP,
        );
        appendElements(this, this._reclaimRewardsButton);
        hideElements(this._reclaimRewardsButton);
        (async function () {
          const categoriesResponse = await observableToPromise(
            services.Objectives.requestCategories(),
          );
          function getClaimableGroups(category) {
            const claimableGroups = [];
            for (let group of category.groups.values()) {
              if (group.objectivesReadyToRedeem > 0) {
                claimableGroups.push(group);
              }
            }
            return claimableGroups;
          }
          let hasClaimableGroups = false;
          categories = categoriesResponse.response.categories;
          for (let category of categories) {
            const claimableGroups = getClaimableGroups(category);
            if (claimableGroups.length > 0) {
              hasClaimableGroups = true;
              claimableGroupsByCategoryId[category.id] = claimableGroups;
            }
          }
          if (hasClaimableGroups) {
            showElements(tileView._reclaimRewardsButton);
          }
        })();
        this._paletoolsGenerated = true;
      }
    };
  },
  order: 10,
  settings: {
    name: "claimObjectives",
    title: "plugins.claimObjectives.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", claimObjectivesSettings.enabled, (isEnabled) => {
        claimObjectivesSettings.enabled = isEnabled;
        persistConfiguration();
      });
      return container;
    },
  },
};

export const claimObjectivesPlugin = claimObjectivesPluginDefinition;
