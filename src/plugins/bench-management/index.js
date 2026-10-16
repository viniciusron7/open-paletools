/**
 * Bench management plugin `benchManagementPlugin` (order 3), installed by the plugin list in
 * src/bootstrap/boot.js: adds "send to field", "send to field keeping positions" and "send to
 * club" buttons to the squad slot docks and moves bench/reserve players (SBC and club squads).
 *
 * Hooks (installed in `run()`):
 * - `UTSquadSlotDockView.prototype._generate` (original first): when
 *   `configuration.enabled && benchManagement.enabled`, creates the `EAObservable`s
 *   `onSendToFieldClick`, `onSendToFieldKeepPos`, `onSendToClubClick` and the three buttons, once
 *   per view (`_paletoolsGenerated`).
 * - `UTSquadOverviewViewController.prototype.viewDidAppear` (original first): observes those
 *   observables on `leftDock` and, when present, `rightDock`.
 *
 * Invariants:
 * - Keep both hooks together: the observables exist only after the dock `_generate` override.
 *   Observers are added on every `viewDidAppear` and never removed.
 * - Left dock sources: subs + reserves for SBC squads (`_challenge`), subs otherwise; right dock:
 *   reserves (plain send-to-field fills the field slots in reverse order).
 * - Targets are field slots without requirement or with `playerType === DEFAULT`; sources with
 *   `definitionId > 0` are capped at the number of targets. Keep-positions matches target
 *   `position.typeId` with `preferredPosition`, then `possiblePositions`, then any remaining
 *   slot.
 * - Persistence: `services.SBC.saveChallenge` for SBC squads, `squad.save()` otherwise; send to
 *   club notifies `squad.onDataUpdated`, send to field updates the pitch chemistry.
 * - `_paletoolsGenerated` is a generic flag name other plugins use on other EA classes.
 *
 * Known issues (kept as-is):
 * - `viewDidAppear` checks only `benchManagement.enabled`: docks generated with Paletools
 *   globally disabled (or before enabling the plugin) have no observables and `.observe` throws.
 * - In keep-positions mode the squad is saved twice (explicit save, then `saveControllerSquad`).
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { flattenArray } from "../../core/collections.js";
import { addClasses, appendElements, createElement, setStyles } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { appendToggle } from "../../ui/settings-controls.js";

let benchManagementPluginDefinition;

const benchManagementSettings = configuration.plugins.benchManagement;

benchManagementPluginDefinition = {
  run: function () {
    function saveControllerSquad(controller, shouldUpdateChemistry) {
      const squad = controller._challenge ? controller._challenge.squad : controller._squad;
      if (controller._challenge) {
        services.SBC.saveChallenge(controller._challenge);
      } else {
        squad.save();
      }
      if (shouldUpdateChemistry) {
        controller.getView().updatePitchChemistry(squad.getFieldPlayers());
      }
    }
    function sendSlotPlayersToClub(controller, slots) {
      const squad = controller._challenge ? controller._challenge.squad : controller._squad;
      if (!squad) {
        return;
      }
      if ((slots = slots(squad).filter((slot) => slot.getItem().definitionId > 0)).length === 0) {
        return;
      }
      const removedSlots = [];
      for (let slot of slots) {
        squad.removeItemFromSlot(slot.index);
        removedSlots.push(slot);
      }
      squad.onDataUpdated.notify({
        slots: slots,
        chemistry: squad.getChemistry(),
        rating: squad.getRating(),
        type: squad.getType(),
      });
      saveControllerSquad(controller);
    }
    function sendSlotPlayersToField(controller, sourceSlots, targetSlots, keepPositions) {
      const squad = controller._challenge ? controller._challenge.squad : controller._squad;
      if (!squad) {
        return;
      }
      targetSlots = targetSlots(squad).filter((slot) => {
        const requirement = slot.getRequirement();
        return !requirement || requirement.playerType === SBCPlayerRequirementType.DEFAULT;
      });
      if (
        (sourceSlots = sourceSlots(squad)
          .slice()
          .filter((slot) => slot.getItem().definitionId > 0)
          .slice(0, targetSlots.length)).length === 0
      ) {
        return;
      }
      if (!keepPositions) {
        for (let index = 0; index < sourceSlots.length; index++) {
          squad.swapPlayersByIndex(sourceSlots[index].index, targetSlots[index].index);
        }
        return void saveControllerSquad(controller, true);
      }
      const targetIndexesByPositionId = {};
      for (let slot of targetSlots) {
        if (!targetIndexesByPositionId[slot.position.typeId]) {
          targetIndexesByPositionId[slot.position.typeId] = [];
        }
        targetIndexesByPositionId[slot.position.typeId].push(slot.index);
      }
      const unmatchedSlots = [];
      const stillUnmatchedSlots = [];
      for (let slot of sourceSlots) {
        const preferredPosition = slot.getItem().preferredPosition;
        if (
          targetIndexesByPositionId[preferredPosition] &&
          targetIndexesByPositionId[preferredPosition].length > 0
        ) {
          squad.swapPlayersByIndex(
            slot.index,
            targetIndexesByPositionId[preferredPosition].shift(),
          );
        } else {
          unmatchedSlots.push(slot);
        }
      }
      for (let slot of unmatchedSlots) {
        let possiblePositionIndex = 0;
        for (
          ;
          possiblePositionIndex < slot.getItem().possiblePositions.length;
          possiblePositionIndex++
        ) {
          let possiblePosition = slot.getItem().possiblePositions[possiblePositionIndex];
          if (
            targetIndexesByPositionId[possiblePosition] &&
            targetIndexesByPositionId[possiblePosition].length > 0
          ) {
            squad.swapPlayersByIndex(
              slot.index,
              targetIndexesByPositionId[possiblePosition].shift(),
            );
            break;
          }
        }
        if (possiblePositionIndex >= slot.getItem().possiblePositions.length) {
          stillUnmatchedSlots.push(slot);
        }
      }
      const remainingTargetIndexes = flattenArray(Object.values(targetIndexesByPositionId));
      for (let slot of stillUnmatchedSlots) {
        if (remainingTargetIndexes.length === 0) {
          break;
        }
        squad.swapPlayersByIndex(slot.index, remainingTargetIndexes.shift());
      }
      if (controller._challenge) {
        services.SBC.saveChallenge(controller._challenge);
      } else {
        squad.save();
      }
      saveControllerSquad(controller, true);
    }
    const originalViewDidAppear = UTSquadOverviewViewController.prototype.viewDidAppear;
    UTSquadOverviewViewController.prototype.viewDidAppear = function (...args) {
      originalViewDidAppear.call(this, ...args);
      if (!benchManagementSettings.enabled) {
        return;
      }
      const squadOverviewView = this.getView();
      squadOverviewView.leftDock.onSendToFieldClick.observe(this, () => {
        sendSlotPlayersToField(
          this,
          (squad) => (this._challenge ? squad.getSubAndReservePlayers() : squad.getSubPlayers()),
          (squad) => squad.getFieldPlayers(),
        );
      });
      squadOverviewView.leftDock.onSendToFieldKeepPos.observe(this, () => {
        sendSlotPlayersToField(
          this,
          (squad) => (this._challenge ? squad.getSubAndReservePlayers() : squad.getSubPlayers()),
          (squad) => squad.getFieldPlayers(),
          true,
        );
      });
      squadOverviewView.leftDock.onSendToClubClick.observe(this, () => {
        sendSlotPlayersToClub(this, (squad) =>
          this._challenge ? squad.getSubAndReservePlayers() : squad.getSubPlayers(),
        );
      });
      if (squadOverviewView.rightDock) {
        squadOverviewView.rightDock.onSendToFieldClick.observe(this, () => {
          sendSlotPlayersToField(
            this,
            (squad) => squad.getReservePlayers(),
            (squad) => squad.getFieldPlayers().slice().reverse(),
          );
        });
        squadOverviewView.rightDock.onSendToFieldKeepPos.observe(this, () => {
          sendSlotPlayersToField(
            this,
            (squad) => squad.getReservePlayers(),
            (squad) => squad.getFieldPlayers(),
            true,
          );
        });
        squadOverviewView.rightDock.onSendToClubClick.observe(this, () => {
          sendSlotPlayersToClub(this, (squad) => squad.getReservePlayers());
        });
      }
    };
    const originalGenerate = UTSquadSlotDockView.prototype._generate;
    UTSquadSlotDockView.prototype._generate = function (...args) {
      originalGenerate.call(this, ...args);
      if (configuration.enabled && benchManagementSettings.enabled && !this._paletoolsGenerated) {
        this.onSendToFieldClick = new EAObservable();
        this.onSendToClubClick = new EAObservable();
        this.onSendToFieldKeepPos = new EAObservable();
        const sendToFieldButton = new UTStandardButtonControl();
        sendToFieldButton.init();
        sendToFieldButton.setText(translate("plugins.benchManagement.buttons.sendToField"));
        addClasses(sendToFieldButton, "primary", "mini");
        sendToFieldButton.addTarget(
          this,
          () => {
            this.onSendToFieldClick.notify();
          },
          EventType.TAP,
        );
        const sendToFieldKeepPositionButton = new UTStandardButtonControl();
        sendToFieldKeepPositionButton.init();
        sendToFieldKeepPositionButton.setText(
          translate("plugins.benchManagement.buttons.sendToFieldKeepPos"),
        );
        addClasses(sendToFieldKeepPositionButton, "primary", "mini");
        sendToFieldKeepPositionButton.addTarget(
          this,
          () => {
            this.onSendToFieldKeepPos.notify();
          },
          EventType.TAP,
        );
        const sendToClubButton = new UTStandardButtonControl();
        sendToClubButton.init();
        sendToClubButton.setText(translate("plugins.benchManagement.buttons.sendToClub"));
        addClasses(sendToClubButton, "primary", "mini");
        sendToClubButton.addTarget(
          this,
          () => {
            this.onSendToClubClick.notify();
          },
          EventType.TAP,
        );
        const buttonsContainer = createElement("div");
        setStyles(buttonsContainer, {
          display: "flex",
          gap: "10px",
          justifyContent: "center",
        });
        appendElements(
          buttonsContainer,
          sendToFieldButton,
          sendToFieldKeepPositionButton,
          sendToClubButton,
        );
        appendElements(this.__content, buttonsContainer);
        this._paletoolsGenerated = true;
      }
    };
  },
  order: 3,
  settings: {
    name: "bench-management",
    title: "plugins.benchManagement.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", benchManagementSettings.enabled, (isEnabled) => {
        benchManagementSettings.enabled = isEnabled;
        persistConfiguration();
      });
      return container;
    },
  },
};

export const benchManagementPlugin = benchManagementPluginDefinition;
