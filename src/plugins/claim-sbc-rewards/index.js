/**
 * Claim SBC rewards plugin (order 20, disabled by default), installed by the plugin list in
 * src/bootstrap/boot.js: after a successful SBC submission it accepts the following reward
 * screen(s) automatically.
 *
 * Hooks (installed in `run()`):
 * - `_onChallengeSubmitted` of `UTSBCSquadOverviewViewController`,
 *   `UTSBCSquadDetailPanelViewController` and `UTSBCSquadSplitViewController`: when enabled and
 *   `args[1].success`, sets the pending count to 2 if `args[1].data.setCompleted`, else 1, then
 *   calls the original.
 * - `UTGameRewardsViewController.init` (after the original): while the count is positive, closes
 *   the active popup (`gPopupClickShield.closeActivePopup()`), calls `onButtonTapped()` and
 *   decrements the count.
 *
 * Invariants:
 * - One pending count, local to `run()`, is shared by the three controllers; it is set before the
 *   original submit handler runs.
 * - Configuration `plugins.claimSbcRewards.enabled`; settings page `claim-sbc-rewards`.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { appendToggle } from "../../ui/settings-controls.js";

let claimSbcRewardsPluginDefinition;

const claimSbcRewardsSettings = configuration.plugins.claimSbcRewards;

function createClaimSbcRewardsMenu() {
  const container = document.createElement("div");
  appendToggle(container, "enabled", claimSbcRewardsSettings.enabled, (isEnabled) => {
    claimSbcRewardsSettings.enabled = isEnabled;
    persistConfiguration();
  });
  return container;
}

claimSbcRewardsPluginDefinition = {
  run: function () {
    let pendingRewardClaimCount = 0;
    const originalSquadOverviewOnChallengeSubmitted =
      UTSBCSquadOverviewViewController.prototype._onChallengeSubmitted;
    UTSBCSquadOverviewViewController.prototype._onChallengeSubmitted = function (...args) {
      if (claimSbcRewardsSettings.enabled && args[1].success) {
        pendingRewardClaimCount = args[1].data.setCompleted ? 2 : 1;
      }
      originalSquadOverviewOnChallengeSubmitted.call(this, ...args);
    };
    const originalSquadDetailPanelOnChallengeSubmitted =
      UTSBCSquadDetailPanelViewController.prototype._onChallengeSubmitted;
    UTSBCSquadDetailPanelViewController.prototype._onChallengeSubmitted = function (...args) {
      if (claimSbcRewardsSettings.enabled && args[1].success) {
        pendingRewardClaimCount = args[1].data.setCompleted ? 2 : 1;
      }
      originalSquadDetailPanelOnChallengeSubmitted.call(this, ...args);
    };
    const originalSquadSplitOnChallengeSubmitted =
      UTSBCSquadSplitViewController.prototype._onChallengeSubmitted;
    UTSBCSquadSplitViewController.prototype._onChallengeSubmitted = function (...args) {
      if (claimSbcRewardsSettings.enabled && args[1].success) {
        pendingRewardClaimCount = args[1].data.setCompleted ? 2 : 1;
      }
      originalSquadSplitOnChallengeSubmitted.call(this, ...args);
    };
    const originalInit = UTGameRewardsViewController.prototype.init;
    UTGameRewardsViewController.prototype.init = function (...args) {
      originalInit.call(this, ...args);
      if (claimSbcRewardsSettings.enabled && pendingRewardClaimCount > 0) {
        gPopupClickShield.closeActivePopup();
        this.onButtonTapped();
        pendingRewardClaimCount--;
      }
    };
  },
  order: 20,
  menu: createClaimSbcRewardsMenu,
  settings: {
    name: "claim-sbc-rewards",
    title: "plugins.claimSbcRewards.settings.title",
    menu: createClaimSbcRewardsMenu,
  },
};

export const claimSbcRewardsPlugin = claimSbcRewardsPluginDefinition;
