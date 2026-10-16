/**
 * Decimal rating plugin `decimalRatingPlugin` (order 10), installed by the plugin list in
 * src/bootstrap/boot.js: adds `UTSquadEntity.prototype.getDecimalRating` (squad rating with two
 * decimals) and shows it in the SBC squad overview summary panel.
 *
 * Hooks (installed in `run()`):
 * - Adds `UTSquadEntity.prototype.getDecimalRating` regardless of the flags; the summary banner
 *   of add-multiple-players-to-squad also calls it.
 * - `UTSBCSquadOverviewView.prototype.setSquad` (original first): when
 *   `configuration.enabled && decimalRating.enabled` and `_summaryPanel` exists, calls
 *   `setChemistryAndRating(chemistry, decimalRating)`.
 *
 * Invariants:
 * - Computation: field players only for SBC squads (field + subs otherwise); the divisor starts
 *   at `UTSquadEntity.FIELD_PLAYERS` plus valid subs; players above the average add their excess
 *   (half for subs), using a float or a floored average depending on the server flag
 *   `SQUAD_RATING_FLOAT_CALCULATION_ENABLED`; result clamped to 0-99 and rounded to 2 decimals
 *   with `Number.EPSILON`.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { appendToggle } from "../../ui/settings-controls.js";

let decimalRatingPluginDefinition;

const decimalRatingSettings = configuration.plugins.decimalRating;

decimalRatingPluginDefinition = {
  run: function () {
    const originalSetSquad = UTSBCSquadOverviewView.prototype.setSquad;
    UTSBCSquadOverviewView.prototype.setSquad = function (...args) {
      originalSetSquad.call(this, ...args);
      if (configuration.enabled && decimalRatingSettings.enabled && this._summaryPanel) {
        const squad = args[0];
        this._summaryPanel.setChemistryAndRating(squad.getChemistry(), squad.getDecimalRating());
      }
    };
    UTSquadEntity.prototype.getDecimalRating = function () {
      var squadSlots = this.isSBC() ? this.getFieldPlayers() : this.getFieldAndSubPlayers();
      var isFloatRatingEnabled = services.Configuration.checkFeatureEnabled(
        UTServerSettingsRepository.KEY.SQUAD_RATING_FLOAT_CALCULATION_ENABLED,
      );
      var ratingTotal = 0;
      var ratedPlayerCount = UTSquadEntity.FIELD_PLAYERS;
      squadSlots.forEach(function (slot, index) {
        var item = slot.item;
        if (item.isValid()) {
          ratingTotal += item.rating;
          if (UTSquadEntity.FIELD_PLAYERS <= index) {
            ratedPlayerCount++;
          }
        }
      });
      if (isFloatRatingEnabled) {
        var averageRating = ratingTotal;
        var adjustedRatingTotal = averageRating;
        if (0 < ratedPlayerCount) {
          averageRating /= ratedPlayerCount;
        }
        averageRating = Math.min(averageRating, 99);
        squadSlots.forEach(function (slot, index) {
          var item = slot.item;
          if (item.isValid()) {
            if (item.rating <= averageRating) {
              return;
            }
            adjustedRatingTotal +=
              index < UTSquadEntity.FIELD_PLAYERS
                ? item.rating - averageRating
                : 0.5 * (item.rating - averageRating);
          }
        });
        ratingTotal = Math.round(adjustedRatingTotal);
      } else {
        var flooredAverageRating = Math.min(Math.floor(ratingTotal / ratedPlayerCount), 99);
        squadSlots.forEach(function (slot, index) {
          var item = slot.item;
          if (item.isValid()) {
            if (item.rating <= flooredAverageRating) {
              return;
            }
            ratingTotal +=
              index < UTSquadEntity.FIELD_PLAYERS
                ? item.rating - flooredAverageRating
                : Math.floor(0.5 * (item.rating - flooredAverageRating));
          }
        });
      }
      let rating = Math.min(Math.max(ratingTotal / ratedPlayerCount, 0), 99);
      return Math.round(100 * (rating + Number.EPSILON)) / 100;
    };
  },
  order: 10,
  settings: {
    name: "decimalRating",
    title: "plugins.decimalRating.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", decimalRatingSettings.enabled, (isEnabled) => {
        decimalRatingSettings.enabled = isEnabled;
        persistConfiguration();
      });
      return container;
    },
  },
};

export const decimalRatingPlugin = decimalRatingPluginDefinition;
