/**
 * My Packs plugin (`myPacksPlugin`, order 10), installed by the plugin list in
 * src/bootstrap/boot.js: enhances the store's My Packs category with pack grouping (counter
 * badge), a pack-name filter dropdown, a text search, pack locking and a button that opens the
 * selected pack with the packs opener (`showPacksOpenerDialog` of
 * src/plugins/packs-opener/index.js, called with `myPacksSettings` and `isMyPack = true`).
 *
 * Hooks (installed in `run()`):
 * - `UTStoreViewController.prototype.setCategory` (after original, `PurchaseDisplayGroup.MYPACKS`
 *   only): fills the filter dropdown, sorts grouped views, wires the dropdown to the open/lock
 *   buttons and re-applies the saved search.
 * - `UTStoreView.prototype.setupPack` (after original): `data-*` attributes, lock toggle, groups.
 * - `UTStoreView.prototype._generate`: resets `packsOpenerStorePacksCache` BEFORE the original,
 *   then builds the controls once per view (`_myPacksGenerated`), before `this.__description`.
 * - `UTStoreView.prototype.setPacks`: resets `this._packGroups` BEFORE the original.
 *
 * Invariants:
 * - `packsOpenerStorePacksCache` is a `@mutable` export of src/plugins/packs-opener/index.js;
 *   this module assigns it (`= null`) so the opener re-requests `services.Store.getPacks()`.
 *   Assigning an imported binding only works because the build concatenates all modules into one
 *   scope (native ES modules would throw); keep the reset ahead of the original `_generate`.
 * - Pack views carry `data-id`, `data-title`, `data-tradeable`, `data-locked`,
 *   `data-group-first` and `data-group` (expanded/collapsed); filter, sort and visibility logic
 *   read them back.
 * - DOM ids `filter-packs`, `search-packs` and classes `pack-locked`, `pack-counter`,
 *   `pack-lockunlock`, `packs-settings-container`, `pack-actions` are styled by mypacks.css
 *   (stylesheet id `paletools-mypacks`); `show-hide-lock-packs` (the show/hide-locked button) is
 *   only assigned and queried by the code, not styled.
 * - The search text lives in sessionStorage (`paletoolsStorage` key `searchPacksText`); each
 *   search also calls `persistConfiguration()`. Locked ids: src/plugins/my-packs/locked-packs.js.
 * - Settings `plugins.myPacks.{enabled, group, search, filter, packOpener, lock}` and
 *   `visibility.locked` (flipped and persisted by the show/hide-locked button).
 *
 * Known issues (kept as-is):
 * - With `myPacks.filter` off, `setCategory` and the search `keyup` handler dereference the
 *   missing `__packsDropDown` and throw; with `lock` off, choosing a pack throws in the
 *   lock-button change handler.
 * - `setCategory` adds two more dropdown `onChange` callbacks on every visit (they pile up).
 * - The group sort tests `dataset.tradeable` for truthiness, but it holds the strings
 *   "true"/"false", so the tradeable-first ordering is not applied (inconsistent comparator).
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { removeDiacritics } from "../../core/diacritics.js";
import {
  accessAttribute,
  addClasses,
  appendElements,
  createElement,
  getParentNode,
  hasClass,
  insertBefore,
  isElementHidden,
  queryElement,
  queryElements,
  removeClasses,
  removeFromParentElement,
} from "../../core/dom.js";
import { listenForEvent } from "../../core/events.js";
import { getValueAtPath, setValueAtPath } from "../../core/objects.js";
import { paletoolsStorage } from "../../core/storage.js";
import { translate } from "../../i18n/translations.js";
import {
  getMyPacksLockedPackIds,
  isMyPacksPackLocked,
  saveMyPacksLockedPackIds,
} from "./locked-packs.js";
import { packsOpenerStorePacksCache, showPacksOpenerDialog } from "../packs-opener/index.js";
import { DropdownControl } from "../../ui/controls/dropdown-control.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import mypacksCss from "./mypacks.css";

let myPacksPluginDefinition;

const myPacksSettings = configuration.plugins.myPacks;

const myPacksSearchTextStorageKey = "searchPacksText";

myPacksPluginDefinition = {
  run: function () {
    function restorePackViewVisibility(packView) {
      if (packView) {
        packView.dataset.tradable;
        const isLocked = packView.dataset.locked === "true";
        if (!myPacksSettings.visibility.locked && isLocked) {
          return;
        }
        if (packView.dataset.groupFirst || packView.dataset.group === "expanded") {
          showElements(packView);
        } else {
          hideElements(packView);
        }
      }
    }
    function filterPackViews(filterValue, isPackIdFilter = false) {
      if (!isPackIdFilter) {
        paletoolsStorage.set(myPacksSearchTextStorageKey, filterValue, false);
      }
      persistConfiguration();
      if (filterValue) {
        filterValue = removeDiacritics(filterValue).toLowerCase();
        for (const titleElement of queryElements(".ut-store-pack-details-view--title")) {
          const normalizedTitle = removeDiacritics(titleElement.textContent.toLowerCase());
          const packView = getParentNode(titleElement);
          if (isPackIdFilter) {
            if (packView.dataset.id == filterValue || packView.dataset.id == "6" + filterValue) {
              showElements(packView);
            } else {
              hideElements(packView);
            }
          } else if (normalizedTitle.indexOf(filterValue) > -1) {
            showElements(packView);
          } else {
            hideElements(packView);
          }
        }
      } else {
        for (const titleElement of queryElements(".ut-store-pack-details-view--title")) {
          if (titleElement) {
            restorePackViewVisibility(getParentNode(titleElement));
          }
        }
      }
    }
    function sortGroupedPackViews(packs) {
      if (!myPacksSettings.group || packs.length === 0 || !packs[0].isMyPack) {
        return;
      }
      const contentContainer = queryElement(".ut-store-hub-view--content");
      const packViews = queryElements(".ut-store-pack-details-view");
      removeFromParentElement(packViews);
      packViews.sort((left, right) => {
        const leftTitle = left.dataset.title;
        const rightTitle = right.dataset.title;
        const leftTradeable = left.dataset.tradeable;
        const rightTradeable = right.dataset.tradeable;
        const leftGroupFirst = left.dataset.groupFirst;
        const rightGroupFirst = right.dataset.groupFirst;
        const leftId = parseInt(left.dataset.id);
        const rightId = parseInt(right.dataset.id);
        return leftTitle === rightTitle
          ? leftId === rightId
            ? leftTradeable === rightTradeable
              ? leftGroupFirst
                ? -1
                : rightGroupFirst
                  ? 1
                  : 0
              : leftTradeable
                ? -1
                : rightTradeable
                  ? 1
                  : 0
            : leftId < rightId
              ? -1
              : leftId > rightId
                ? 1
                : 0
          : leftTitle.localeCompare(rightTitle);
      });
      appendElements(contentContainer, ...packViews);
    }
    function togglePackLock(packId) {
      const packViews = queryElements('.ut-store-pack-details-view[data-id="' + packId + '"]');
      if (isMyPacksPackLocked(packId)) {
        (function (packId) {
          if (!packId) {
            return;
          }
          packId = parseInt(packId);
          const lockedPackIds = getMyPacksLockedPackIds();
          const lockedIndex = lockedPackIds.indexOf(packId);
          if (lockedIndex > -1) {
            lockedPackIds.splice(lockedIndex, 1);
            saveMyPacksLockedPackIds(lockedPackIds);
          }
        })(packId);
        removeClasses(packViews, "pack-locked");
        accessAttribute(packViews, "data-locked", "false");
      } else {
        (function (packId) {
          if (!packId) {
            return;
          }
          packId = parseInt(packId);
          const lockedPackIds = getMyPacksLockedPackIds();
          if (-1 === lockedPackIds.indexOf(packId)) {
            lockedPackIds.push(packId);
            lockedPackIds.sort();
            saveMyPacksLockedPackIds(lockedPackIds);
          }
        })(packId);
        addClasses(packViews, "pack-locked");
        accessAttribute(packViews, "data-locked", "true");
      }
      if (getMyPacksLockedPackIds().length === 0) {
        hideElements(queryElement("#show-hide-lock-packs"));
      } else {
        showElements(queryElement("#show-hide-lock-packs"));
      }
    }
    const originalSetCategory = UTStoreViewController.prototype.setCategory;
    UTStoreViewController.prototype.setCategory = function (...args) {
      originalSetCategory.call(this, ...args);
      if (!configuration.enabled || !myPacksSettings.enabled) {
        return;
      }
      if (!this.viewmodel.hasMyPacks) {
        return;
      }
      if (args[0] !== PurchaseDisplayGroup.MYPACKS) {
        return;
      }
      const packs = this.viewmodel.myPacks.values();
      var storeView;
      (function (packs, storeView) {
        if (!myPacksSettings.filter) {
          return;
        }
        const packCountsByName = {};
        for (let pack of packs) {
          const packName = translate(pack.packName);
          if (packCountsByName[packName]) {
            packCountsByName[packName][pack.tradable ? "tradeable" : "untradeable"]++;
          } else {
            packCountsByName[packName] = {
              id: pack.id,
              tradeable: pack.tradable ? 1 : 0,
              untradeable: pack.tradable ? 0 : 1,
            };
          }
        }
        const packNames = Object.keys(packCountsByName);
        packNames.sort();
        storeView.__packsDropDown.clear();
        storeView.__packsDropDown.addOption(
          translate("plugins.myPacks.filter.default") + " (" + packs.length + ")",
          "",
        );
        for (const packName of packNames) {
          const packCounts = packCountsByName[packName];
          storeView.__packsDropDown.addOption(
            packName + " (" + (packCounts.tradeable + packCounts.untradeable) + ")",
            "" + packCounts.id,
          );
        }
      })(packs, this.getView());
      sortGroupedPackViews(packs);
      (storeView = this.getView()).__packsDropDown.onChange((selectedPackId) => {
        if (selectedPackId) {
          showElements(storeView.__autoOpenPacksButton);
        } else {
          hideElements(storeView.__autoOpenPacksButton);
        }
      });
      (function (storeView) {
        storeView.__packsDropDown.onChange((selectedPackId) => {
          if (selectedPackId) {
            showElements(storeView.__lockPacksButton);
            if (isMyPacksPackLocked(selectedPackId)) {
              storeView.__lockPacksButton.setText(translate("plugins.myPacks.unlock.label"));
            } else {
              storeView.__lockPacksButton.setText(translate("plugins.myPacks.lock.label"));
            }
          } else {
            hideElements(storeView.__lockPacksButton);
          }
        });
      })(this.getView());
      if (myPacksSettings.search) {
        filterPackViews(paletoolsStorage.get(myPacksSearchTextStorageKey));
      }
    };
    const originalSetupPack = UTStoreView.prototype.setupPack;
    UTStoreView.prototype.setupPack = function (...args) {
      if (!configuration.enabled || !myPacksSettings.enabled) {
        return originalSetupPack.call(this, ...args);
      }
      if (!args[0].isMyPack) {
        return originalSetupPack.call(this, ...args);
      }
      const packView = originalSetupPack.call(this, ...args);
      if (packView instanceof UTStorePackDetailsView) {
        const pack = args[0];
        accessAttribute(packView, "data-id", translate(pack.id));
        accessAttribute(packView, "data-title", translate(pack.packName));
        accessAttribute(packView, "data-tradeable", pack.tradable ? "true" : "false");
        if (myPacksSettings.lock) {
          const lockToggle = createElement("div", {
            className: "pack-lockunlock",
          });
          appendElements(packView, lockToggle);
          if (isMyPacksPackLocked(pack.id)) {
            accessAttribute(packView, "data-locked", "true");
            addClasses(packView, "pack-locked");
            if (!myPacksSettings.visibility.locked) {
              hideElements(packView);
            }
          }
          listenForEvent(lockToggle, "click", () => {
            togglePackLock(pack.id);
          });
        }
        if (myPacksSettings.group) {
          const groupKey = pack.tradable ? pack.id + "_tradeable" : pack.id + "_untradeable";
          if (this._packGroups[groupKey]) {
            this._packGroups[groupKey].push(packView);
            hideElements(packView);
            const packCounter = queryElement(".pack-counter", this._packGroups[groupKey][0]);
            packCounter.textContent = packCounter.dataset.packsCount =
              this._packGroups[groupKey].length;
          } else {
            this._packGroups[groupKey] = [packView];
            const packCounter = createElement(
              "div",
              {
                className: "pack-counter",
              },
              "1",
            );
            packCounter.dataset.packsCount = 1;
            appendElements(packView, packCounter);
            accessAttribute(packView, "data-group-first", "true");
            listenForEvent(packCounter, "click", () => {
              for (let index = 1; index < this._packGroups[groupKey].length; index++) {
                const groupedPackView = this._packGroups[groupKey][index];
                if (isElementHidden(groupedPackView)) {
                  accessAttribute(groupedPackView, "data-group", "expanded");
                  showElements(groupedPackView);
                } else {
                  accessAttribute(groupedPackView, "data-group", "collapsed");
                  hideElements(groupedPackView);
                }
              }
            });
          }
        }
      }
      return packView;
    };
    const originalGenerate = UTStoreView.prototype._generate;
    UTStoreView.prototype._generate = function () {
      packsOpenerStorePacksCache = null;
      originalGenerate.call(this);
      if (!configuration.enabled || !myPacksSettings.enabled) {
        return;
      }
      if (this._myPacksGenerated) {
        return;
      }
      upsertStylesheet("paletools-mypacks", mypacksCss);
      const settingsContainer = createElement("div", {
        className: "packs-settings-container",
      });
      const packActions = createElement("div", {
        className: "pack-actions",
      });
      if (myPacksSettings.filter) {
        this.__packsDropDown = new DropdownControl();
        this.__packsDropDown.init();
        this.__packsDropDown.onChange((selectedPackId) => {
          filterPackViews(selectedPackId, true);
        });
        this.__packsDropDown.getRootElement().id = "filter-packs";
        appendElements(settingsContainer, this.__packsDropDown);
        if (myPacksSettings.packOpener) {
          this.__autoOpenPacksButton = new UTStandardButtonControl();
          this.__autoOpenPacksButton.init();
          this.__autoOpenPacksButton.setText(translate("plugins.myPacks.packOpener.label"));
          this.__autoOpenPacksButton.addTarget(
            this,
            () => {
              showPacksOpenerDialog(
                parseInt(this.__packsDropDown.getValue()),
                myPacksSettings,
                true,
              );
            },
            EventType.TAP,
          );
          appendElements(packActions, this.__autoOpenPacksButton);
          hideElements(this.__autoOpenPacksButton);
        }
      }
      appendElements(settingsContainer, packActions);
      if (myPacksSettings.search) {
        this.__searchInput = new UTTextInputControl();
        this.__searchInput.init();
        this.__searchInput.setPlaceholder(translate("plugins.myPacks.filter.label"));
        this.__searchInput.getRootElement().id = "search-packs";
        const savedSearchText = paletoolsStorage.get(myPacksSearchTextStorageKey);
        if (savedSearchText) {
          this.__searchInput.setValue(savedSearchText);
        }
        listenForEvent(this.__searchInput, "keyup", (event) => {
          this.__packsDropDown.setValue("");
          filterPackViews(event.target.value);
        });
        appendElements(settingsContainer, this.__searchInput);
      }
      if (myPacksSettings.lock) {
        if (this.__packsDropDown) {
          this.__lockPacksButton = new UTStandardButtonControl();
          this.__lockPacksButton.init();
          this.__lockPacksButton.addTarget(
            this,
            () => {
              const selectedPackId = parseInt(this.__packsDropDown.getValue());
              togglePackLock(selectedPackId);
              if (isMyPacksPackLocked(selectedPackId)) {
                this.__lockPacksButton.setText(translate("plugins.myPacks.unlock.label"));
              } else {
                this.__lockPacksButton.setText(translate("plugins.myPacks.lock.label"));
              }
            },
            EventType.TAP,
          );
          appendElements(packActions, this.__lockPacksButton);
          hideElements(this.__lockPacksButton);
          const showHideLockedButton = new UTStandardButtonControl();
          showHideLockedButton.init();
          accessAttribute(showHideLockedButton, "id", "show-hide-lock-packs");
          showHideLockedButton.setText(
            (myPacksSettings.visibility.locked ? translate("hide") : translate("show")) +
              " " +
              translate("plugins.myPacks.locked.label"),
          );
          showHideLockedButton.addTarget(
            this,
            () => {
              (function (selector, visibilityKey) {
                if (myPacksSettings.visibility[visibilityKey]) {
                  myPacksSettings.visibility[visibilityKey] =
                    !myPacksSettings.visibility[visibilityKey];
                  hideElements(queryElements(selector));
                } else {
                  myPacksSettings.visibility[visibilityKey] =
                    !myPacksSettings.visibility[visibilityKey];
                  for (let packView of queryElements(selector)) {
                    restorePackViewVisibility(packView);
                  }
                }
                persistConfiguration();
              })(".pack-locked", "locked");
              showHideLockedButton.setText(
                (myPacksSettings.visibility.locked ? translate("hide") : translate("show")) +
                  " " +
                  translate("plugins.myPacks.locked.label"),
              );
            },
            EventType.TAP,
          );
          appendElements(settingsContainer, showHideLockedButton);
          if (getMyPacksLockedPackIds().length === 0) {
            hideElements(showHideLockedButton);
          }
        }
        listenForEvent(this, "dblclick", (event) => {
          if (
            hasClass(event.target, "pack-locked") &&
            isMyPacksPackLocked(event.target.dataset.id)
          ) {
            togglePackLock(event.target.dataset.id);
          }
        });
      }
      insertBefore(settingsContainer, this.__description);
      this._myPacksGenerated = true;
    };
    const originalSetPacks = UTStoreView.prototype.setPacks;
    UTStoreView.prototype.setPacks = function (...args) {
      this._packGroups = {};
      originalSetPacks.call(this, ...args);
      if (!configuration.enabled || !myPacksSettings.enabled) {
        return;
      }
      const packs = args[0];
      if (packs.length !== 0) {
        if (packs[0].isMyPack) {
          if (myPacksSettings.filter) {
            this.__packsDropDown.setValue("");
            showElements(this.__searchInput);
            showElements(this.__packsDropDown);
          }
          if (myPacksSettings.group) {
            sortGroupedPackViews(packs);
          }
        } else {
          hideElements(this.__searchInput);
          hideElements(this.__packsDropDown);
        }
      }
    };
  },
  order: 10,
  settings: {
    name: "my-packs",
    title: "plugins.myPacks.settings.title",
    menu: function () {
      const container = document.createElement("div");
      function addSettingToggle(settingKey, labelKey) {
        if (!labelKey) {
          labelKey = settingKey;
        }
        appendToggle(
          container,
          labelKey,
          getValueAtPath(myPacksSettings, settingKey),
          (isEnabled) => {
            setValueAtPath(myPacksSettings, settingKey, isEnabled);
            persistConfiguration();
          },
        );
      }
      addSettingToggle("enabled", "enabled");
      addSettingToggle("group", "plugins.myPacks.settings.group");
      addSettingToggle("search", "plugins.myPacks.settings.search");
      addSettingToggle("filter", "plugins.myPacks.settings.filter");
      addSettingToggle("packOpener", "plugins.myPacks.settings.packOpener");
      addSettingToggle("lock", "plugins.myPacks.settings.lock");
      return container;
    },
  },
};

export const myPacksPlugin = myPacksPluginDefinition;
