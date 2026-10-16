/**
 * What's New plugin (`whatsNewPlugin`, order 3), installed by the plugin list in
 * src/bootstrap/boot.js: on the home hub, periodically compares SBC sets, evolution (academy)
 * slots and objective groups with the ids seen before, shows a dialog with the new ones and a
 * home-hub tile with the last result.
 *
 * Hooks (installed in `run()`):
 * - `UTHomeHubViewController.prototype.viewDidAppear` (after original): runs the scan, then fills
 *   the tile in a `.then()`.
 * - `UTHomeHubView.prototype._generate` (after original): when `whatsnew.enabled`, once per view
 *   (`_paletoolsGenerated`) appends a hidden `UTTileView` to `div:first-child`; also defines
 *   `UTHomeHubView.prototype.getWhatsNewTile()`.
 *
 * Invariants:
 * - Persisted per persona in localStorage: `whatsnew` = `{sbcs, objectives, evolutions,
 *   lastRun}` (seen ids) and `whatsnew_last` = the names shown last. The first run only records
 *   the ids.
 * - A scan runs without `lastRun`, after today's update time (local `updateHours`, or 18:00 UTC
 *   when unset) if `lastRun` is earlier, or once `interval` has elapsed (`intervalPeriod` hours,
 *   minutes, otherwise seconds).
 * - `whatsNewEvolutionSlotsCache` is in memory, keyed by slot id, with a 3600 s TTL.
 * - Markup root `#whats-new`, tile content class `ut-tile-whatsnew`, stylesheet id
 *   `paletools-whats-new`; settings `plugins.whatsnew.{enabled, updateHours, interval,
 *   intervalPeriod}`.
 *
 * Known issues (kept as-is):
 * - The scan and dialog run whenever `configuration.enabled`, even with `whatsnew.enabled` off;
 *   the `.then()` then calls `setContent` on the missing tile and throws once `whatsnew_last`
 *   exists.
 * - `updateHours` is stored as a string; hours 0-9 build `YYYY-MM-DDTh:00:00`, an Invalid Date,
 *   so for them only the interval clause can trigger a scan.
 * - The evolution generator yields the cached slots and then always re-requests the academy hub,
 *   so the cache never saves a request.
 * - `new StoredIdList(() => "hiddenEvolutions")` is created and discarded (dead statement).
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { addClasses, appendElements, queryElement } from "../../core/dom.js";
import { ExpiringCache } from "../../core/expiring-cache.js";
import { StoredIdList, paletoolsStorage } from "../../core/storage.js";
import { translate } from "../../i18n/translations.js";
import { LabelWithTextInputAndDropdownControl } from "../../ui/controls/label-with-text-input-and-dropdown-control.js";
import { showDialog } from "../../ui/dialog.js";
import { appendDropdown, appendToggle, translateLabel } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { observableToPromise } from "../../webapp/observable.js";
import whatsNewCss from "./whats-new.css";

var whatsNewEvolutionSlotsCache = new ExpiringCache(3600);

let whatsNewPluginDefinition;

new StoredIdList(() => "hiddenEvolutions");

const whatsNewSettings = configuration.plugins.whatsnew;

whatsNewPluginDefinition = {
  run: function () {
    upsertStylesheet("paletools-whats-new", whatsNewCss);
    const originalViewDidAppear = UTHomeHubViewController.prototype.viewDidAppear;
    UTHomeHubViewController.prototype.viewDidAppear = function (...args) {
      originalViewDidAppear.call(this, ...args);
      if (configuration.enabled) {
        (async function () {
          let isFirstRun = false;
          let seenState = paletoolsStorage.get("whatsnew");
          if (!seenState) {
            isFirstRun = true;
            seenState = {
              sbcs: [],
              objectives: [],
              evolutions: [],
            };
          }
          if (whatsNewSettings.updateHours) {
            if (
              !(function (lastRun) {
                const intervalMs =
                  whatsNewSettings.intervalPeriod === "hours"
                    ? 60 * whatsNewSettings.interval * 60 * 1000
                    : whatsNewSettings.intervalPeriod === "minutes"
                      ? 60 * whatsNewSettings.interval * 1000
                      : 1000 * whatsNewSettings.interval;
                if (!lastRun) {
                  return true;
                }
                const now = new Date();
                const today = now.toISOString().split("T")[0];
                const lastRunDate = lastRun ? new Date(parseInt(lastRun, 10)) : null;
                const updateHours = whatsNewSettings.updateHours;
                const todayUpdateTime = new Date(today + "T" + updateHours + ":00:00");
                return (
                  (now.getHours() >= updateHours &&
                    (!lastRunDate || lastRunDate < todayUpdateTime)) ||
                  !!(lastRunDate && now - lastRunDate >= intervalMs)
                );
              })(seenState.lastRun)
            ) {
              return;
            }
          } else if (
            !(function (lastRun) {
              const intervalMs =
                whatsNewSettings.intervalPeriod === "hours"
                  ? 60 * whatsNewSettings.interval * 60 * 1000
                  : whatsNewSettings.intervalPeriod === "minutes"
                    ? 60 * whatsNewSettings.interval * 1000
                    : 1000 * whatsNewSettings.interval;
              if (!lastRun) {
                return true;
              }
              const now = new Date();
              const utcHours = now.getUTCHours();
              const today = now.toISOString().split("T")[0];
              const lastRunDate = lastRun ? new Date(parseInt(lastRun, 10)) : null;
              const todayUpdateTime = new Date(today + "T18:00:00Z");
              return (
                (utcHours >= 18 && (!lastRunDate || lastRunDate < todayUpdateTime)) ||
                !!(lastRunDate && now - lastRunDate >= intervalMs)
              );
            })(seenState.lastRun)
          ) {
            return;
          }
          let sbcs = {};
          let evolutions = {};
          let objectives = {};
          let setsResponse = await observableToPromise(services.SBC.requestSets());
          if (setsResponse.success) {
            for (let sbcSet of setsResponse.data.sets) {
              if (!seenState.sbcs.includes(sbcSet.id)) {
                seenState.sbcs.push(sbcSet.id);
                sbcs[sbcSet.id] = sbcSet.name;
              }
            }
          }
          for await (let evolutionSlot of (async function* () {
            if (!whatsNewEvolutionSlotsCache.isEmpty()) {
              for (let cachedSlot of whatsNewEvolutionSlotsCache.all()) {
                yield cachedSlot;
              }
            }
            let academyHubResponse = await observableToPromise(
              services.Academy.requestAcademyHub({
                count: 20,
              }),
            );
            if (academyHubResponse.success) {
              for (let category of academyHubResponse.data.categories) {
                let slotsResponse = await observableToPromise(
                  services.Academy.requestSlotsByCategory({
                    categoryId: category.id,
                    count: category.count,
                  }),
                );
                if (slotsResponse.success) {
                  for (let slot of slotsResponse.data.slots) {
                    whatsNewEvolutionSlotsCache.set(slot.id, slot);
                    yield slot;
                  }
                }
              }
            }
          })()) {
            if (!seenState.evolutions.includes(evolutionSlot.id)) {
              seenState.evolutions.push(evolutionSlot.id);
              evolutions[evolutionSlot.id] = evolutionSlot.slotName;
            }
          }
          let categoriesResponse = await observableToPromise(
            services.Objectives.requestCategories(),
          );
          if (categoriesResponse.success) {
            for (let category of categoriesResponse.response.categories) {
              for (let group of category.groups.values()) {
                if (!seenState.objectives.includes(group.compositeId)) {
                  seenState.objectives.push(group.compositeId);
                  objectives[group.compositeId] = group.title;
                }
              }
            }
          }
          if (
            !((seenState.lastRun = new Date().valueOf()),
            paletoolsStorage.set("whatsnew", seenState, true),
            (sbcs = Object.values(sbcs)),
            (objectives = Object.values(objectives)),
            (evolutions = Object.values(evolutions)),
            (sbcs.length === 0 && objectives.length === 0 && evolutions.length === 0) || isFirstRun)
          ) {
            let whatsNewMarkup = buildWhatsNewMarkup(sbcs, objectives, evolutions);
            showDialog(
              [
                {
                  labelEnum: enums.UIDialogOptions.OK,
                },
              ],
              translate("plugins.whatsnew.settings.title"),
              whatsNewMarkup,
            );
            paletoolsStorage.set(
              "whatsnew_last",
              {
                sbcs: sbcs,
                evolutions: evolutions,
                objectives: objectives,
              },
              true,
            );
          }
        })().then(() => {
          const lastWhatsNew = paletoolsStorage.get("whatsnew_last");
          if (!lastWhatsNew) {
            return;
          }
          const whatsNewMarkup = buildWhatsNewMarkup(
            lastWhatsNew.sbcs,
            lastWhatsNew.objectives,
            lastWhatsNew.evolutions,
          );
          const tileContent = document.createElement("div");
          addClasses(tileContent, "ut-tile-whatsnew");
          tileContent.innerHTML = whatsNewMarkup;
          const whatsNewTile = this.getView().getWhatsNewTile();
          whatsNewTile.setContent(tileContent);
          whatsNewTile.show();
        });
      }
    };
    const originalGenerate = UTHomeHubView.prototype._generate;
    function buildWhatsNewMarkup(sbcNames, objectiveNames, evolutionNames) {
      let markup = '<div id="whats-new">';
      if (sbcNames.length > 0) {
        markup += "<h1>" + translate("nav.label.sbc") + "</h1>";
        markup += "<ul>";
        for (let sbcName of Object.values(sbcNames)) {
          markup += "<li>" + sbcName + "</li>";
        }
        markup += "</ul>";
      }
      if (objectiveNames.length > 0) {
        markup += "<h1>" + translate("academy.slot.subtitle.objectives") + "</h1><ul>";
        for (let objectiveName of Object.values(objectiveNames)) {
          markup += "<li>" + objectiveName + "</li>";
        }
        markup += "</ul>";
      }
      if (evolutionNames.length > 0) {
        markup += "<h1>" + translate("academy.tile.title") + "</h1><ul>";
        for (let evolutionName of Object.values(evolutionNames)) {
          markup += "<li>" + evolutionName + "</li>";
        }
        markup += "</ul>";
      }
      markup += "</div>";
      return markup;
    }
    UTHomeHubView.prototype._generate = function (...args) {
      originalGenerate.call(this, ...args);
      if (!this._paletoolsGenerated && whatsNewSettings.enabled) {
        this._whatsNewTile = new UTTileView();
        this._whatsNewTile.hide();
        addClasses(this._whatsNewTile, "col-1-1");
        appendElements(queryElement("div:first-child", this), this._whatsNewTile);
        this._whatsNewTile.setTitle(translate("plugins.whatsnew.settings.title"));
        this._paletoolsGenerated = true;
      }
    };
    UTHomeHubView.prototype.getWhatsNewTile = function () {
      return this._whatsNewTile;
    };
  },
  order: 3,
  settings: {
    name: "whatsnew",
    title: "plugins.whatsnew.settings.title",
    menu: function () {
      const menuContainer = document.createElement("div");
      appendToggle(menuContainer, "enabled", whatsNewSettings.enabled, (isEnabled) => {
        whatsNewSettings.enabled = isEnabled;
        persistConfiguration();
      });
      appendDropdown(
        menuContainer,
        "plugins.whatsnew.settings.updateHours",
        [
          {
            value: "",
            label: "",
          },
          ...Array.from(
            {
              length: 24,
            },
            (unusedArgument1, hour) => ({
              value: hour,
              label: hour,
            }),
          ),
        ],
        whatsNewSettings.updateHours,
        (updateHours) => {
          whatsNewSettings.updateHours = updateHours;
          persistConfiguration();
        },
      );
      (function (container, unusedArgument2, controlOptions) {
        if (
          (controlOptions = controlOptions || {
            input: {},
            dropdown: {},
            inputFirst: true,
          }).inputFirst === undefined
        ) {
          controlOptions.inputFirst = true;
        }
        controlOptions.input = controlOptions.input || {};
        controlOptions.dropdown = controlOptions.dropdown || {};
        const intervalControl = new LabelWithTextInputAndDropdownControl(controlOptions.inputFirst);
        intervalControl.setLabel(translateLabel("plugins.whatsnew.settings.interval"));
        if (controlOptions.input.type) {
          intervalControl.setInputType(controlOptions.input.type);
        }
        if (controlOptions.input.value) {
          intervalControl.setInputValue(controlOptions.input.value);
        }
        if (controlOptions.input.onChange) {
          intervalControl.onInputChange(controlOptions.input.onChange);
        }
        if (controlOptions.dropdown.options) {
          intervalControl.setDropDownOptions(controlOptions.dropdown.options);
        }
        if (controlOptions.dropdown.value) {
          intervalControl.setDropDownValue(controlOptions.dropdown.value);
        }
        if (controlOptions.dropdown.onChange) {
          intervalControl.onDropDownChange(controlOptions.dropdown.onChange);
        }
        appendElements(container, intervalControl);
      })(menuContainer, 0, {
        input: {
          value: whatsNewSettings.interval,
          type: "number",
          onChange: (input) => {
            whatsNewSettings.interval = parseInt(input.value);
            persistConfiguration();
          },
        },
        dropdown: {
          value: whatsNewSettings.intervalPeriod,
          options: [
            {
              label: translate("hours"),
              value: "hours",
            },
            {
              label: translate("minutes"),
              value: "minutes",
            },
            {
              label: translate("seconds"),
              value: "seconds",
            },
          ],
          onChange: (intervalPeriod) => {
            whatsNewSettings.intervalPeriod = intervalPeriod;
            persistConfiguration();
          },
        },
      });
      return menuContainer;
    },
  },
};

export const whatsNewPlugin = whatsNewPluginDefinition;
