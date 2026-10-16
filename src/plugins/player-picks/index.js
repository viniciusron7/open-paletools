/**
 * Player Picks plugin (`playerPicksPlugin`, order 25), installed by the plugin list in
 * src/bootstrap/boot.js: on desktop replaces EA's player-picks carousel with `PalePicksView`
 * (./pale-picks-view.js), can auto-select the best-rated picks, and adds a "redeem with hideout"
 * button that covers the picks with a draggable image.
 *
 * Hooks (installed in `run()`):
 * - `UTPlayerPicksViewController.prototype._getViewInstanceFromData`: returns `PalePicksView`
 *   when not on a phone and `plugins.playerPicks.enabled`; always sets `view._controller = this`.
 * - `UTPlayerPicksViewController.prototype.viewDidAppear` (after original): re-inserts stylesheet
 *   `paletools-player-picks`.
 * - `UTDefaultActionPanelView.prototype._generate` / `render` (after original): the
 *   `redeem-item-hideout` button after `_redeemButton`, created once per panel when
 *   `hideout.enabled`; it triggers `enums.UIItemActionEvent.REDEEM`.
 * - `UTPlayerPicksView.prototype.setCarouselItems` and `PalePicksView.prototype.setCarouselItems`
 *   (after original): `enhancePlayerPicksCarousel`.
 *
 * Invariants:
 * - `isPlayerPicksHideoutRedeemPending` is set by the hideout button and consumed (reset) by the
 *   next `setCarouselItems`, which then adds `has-hideout` and a draggable `.hideout` overlay per
 *   pick (desktop only); images come from `paletoolsImages` or `hideout.custom` (a data URL).
 * - `maxRating` selects the top `_controller.availablePicks` items by rating (non-duplicates
 *   first on ties) by triggering `CAROUSEL_SCROLLED` + `SELECT_CURRENT_PICK` on the view.
 * - Settings `plugins.playerPicks.{enabled, maxRating.enabled, hideout.enabled, hideout.type,
 *   hideout.custom}`; hideout types are paletools, capitan, creador and custom.
 *
 * Known issues (kept as-is):
 * - `render` tests the `hideout` object (always truthy) instead of `hideout.enabled`.
 * - Changing the hideout type does not call `persistConfiguration()`.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { addClasses, appendElements, createElement, insertAfter } from "../../core/dom.js";
import { getValueAtPath, setValueAtPath } from "../../core/objects.js";
import { translate } from "../../i18n/translations.js";
import { PalePicksView } from "./pale-picks-view.js";
import { fileReadMode } from "../../ui/controls/file-reader.js";
import { LabelWithFileInputControl } from "../../ui/controls/label-with-file-input-control.js";
import { makeElementDraggable } from "../../ui/draggable.js";
import { paletoolsImages } from "../../ui/images.js";
import { appendDropdown, appendToggle, translateLabel } from "../../ui/settings-controls.js";
import { removeStylesheet, upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import playerPicksCss from "./player-picks.css";

let playerPicksPluginDefinition;

const playerPicksSettings = configuration.plugins.playerPicks;

let isPlayerPicksHideoutRedeemPending = false;

playerPicksPluginDefinition = {
  run: function () {
    const originalGetViewInstanceFromData =
      UTPlayerPicksViewController.prototype._getViewInstanceFromData;
    UTPlayerPicksViewController.prototype._getViewInstanceFromData = function (...args) {
      let view;
      view =
        isPhone() || !playerPicksSettings.enabled
          ? originalGetViewInstanceFromData.call(this, ...args)
          : new PalePicksView();
      view._controller = this;
      return view;
    };
    const originalViewDidAppear = UTPlayerPicksViewController.prototype.viewDidAppear;
    UTPlayerPicksViewController.prototype.viewDidAppear = function (...args) {
      originalViewDidAppear.call(this, ...args);
      removeStylesheet("paletools-player-picks");
      upsertStylesheet("paletools-player-picks", playerPicksCss);
    };
    const originalGenerate = UTDefaultActionPanelView.prototype._generate;
    UTDefaultActionPanelView.prototype._generate = function (...args) {
      originalGenerate.call(this, ...args);
      if (!this.hideoutGenerated && playerPicksSettings.hideout.enabled) {
        this._redeemButtonWithHideout = new UTGroupButtonControl();
        addClasses(this._redeemButtonWithHideout, "redeem-item-hideout");
        this._redeemButtonWithHideout.addTarget(
          this,
          () => {
            isPlayerPicksHideoutRedeemPending = true;
            this._triggerActions(enums.UIItemActionEvent.REDEEM);
          },
          EventType.TAP,
        );
        insertAfter(this._redeemButtonWithHideout, this._redeemButton);
        this._redeemButtonWithHideout.init();
        this.hideoutGenerated = true;
      }
    };
    const originalRender = UTDefaultActionPanelView.prototype.render;
    UTDefaultActionPanelView.prototype.render = function (...args) {
      originalRender.call(this, ...args);
      const item = args[0];
      if (this._redeemButtonWithHideout) {
        this._redeemButtonWithHideout.setDisplay(
          item.isPlayerPickItem() && playerPicksSettings.hideout,
        );
        this._redeemButtonWithHideout.setText(translate("plugins.playerPicks.hideout.button.text"));
      }
    };
    const originalPlayerPicksViewSetCarouselItems = UTPlayerPicksView.prototype.setCarouselItems;
    UTPlayerPicksView.prototype.setCarouselItems = function (...args) {
      originalPlayerPicksViewSetCarouselItems.call(this, ...args);
      enhancePlayerPicksCarousel(this, args);
    };
    const originalPalePicksViewSetCarouselItems = PalePicksView.prototype.setCarouselItems;
    function enhancePlayerPicksCarousel(picksView, carouselArgs) {
      if (playerPicksSettings.maxRating.enabled) {
        const pickItems = carouselArgs[0];
        const bestPickIndexes = pickItems
          .map((item, index) => ({
            index: index,
            rating: item.rating,
            duplicateId: item.duplicateId,
          }))
          .sort((left, right) =>
            left.rating === right.rating
              ? left.duplicateId === 0
                ? -1
                : right.duplicateId === 0
                  ? 1
                  : 0
              : right.rating - left.rating,
          )
          .slice(0, picksView._controller.availablePicks)
          .map((candidate) => candidate.index);
        for (let pickIndex of bestPickIndexes) {
          picksView._triggerActions(UTPlayerPicksView.Event.CAROUSEL_SCROLLED, {
            item: pickItems[pickIndex],
            index: pickIndex,
          });
          picksView._triggerActions(UTPlayerPicksView.Event.SELECT_CURRENT_PICK);
        }
      }
      const pickViews = picksView.palePickViews || picksView._carouselItemsContainer.carouselItems;
      for (let pickView of pickViews) {
        if (
          !isPhone() &&
          playerPicksSettings.hideout.enabled &&
          isPlayerPicksHideoutRedeemPending
        ) {
          addClasses(pickView, "has-hideout");
          const hideoutOverlay = createElement("div");
          switch (playerPicksSettings.hideout.type) {
            case "paletools":
              hideoutOverlay.style.backgroundImage = "url(" + paletoolsImages.logosvgtext + ")";
              hideoutOverlay.style.backgroundSize = "85%";
              break;
            case "capitan":
              hideoutOverlay.style.backgroundImage = "url(" + paletoolsImages.captain + ")";
              hideoutOverlay.style.backgroundSize = "85%";
              break;
            case "creador":
              hideoutOverlay.style.backgroundImage = "url(" + paletoolsImages.paleJesus + ")";
              hideoutOverlay.style.backgroundSize = "115%";
              break;
            case "custom":
              hideoutOverlay.style.backgroundImage =
                "url(" + playerPicksSettings.hideout.custom + ")";
              hideoutOverlay.style.backgroundSize = "100%";
          }
          appendElements(pickView, hideoutOverlay);
          addClasses(hideoutOverlay, "hideout");
          makeElementDraggable(hideoutOverlay);
        }
      }
      isPlayerPicksHideoutRedeemPending = false;
    }
    PalePicksView.prototype.setCarouselItems = function (...args) {
      originalPalePicksViewSetCarouselItems.call(this, ...args);
      enhancePlayerPicksCarousel(this, args);
    };
  },
  order: 25,
  settings: {
    name: "player-picks",
    title: "plugins.playerPicks.settings.title",
    menu: function () {
      const menuContainer = document.createElement("div");
      function appendSettingToggle(settingPath) {
        appendToggle(
          menuContainer,
          "plugins.playerPicks." + settingPath,
          getValueAtPath(playerPicksSettings, settingPath),
          (isEnabled) => {
            setValueAtPath(playerPicksSettings, settingPath, isEnabled);
            persistConfiguration();
          },
        );
      }
      appendToggle(
        menuContainer,
        "plugins.playerPicks.palePicks",
        playerPicksSettings.enabled,
        (isEnabled) => {
          playerPicksSettings.enabled = isEnabled;
          persistConfiguration();
        },
      );
      appendSettingToggle("maxRating.enabled");
      appendSettingToggle("hideout.enabled");
      appendDropdown(
        menuContainer,
        "plugins.playerPicks.hideout.type",
        [
          {
            label: "Paletools",
            value: "paletools",
          },
          {
            label: "Capitan del Espacio",
            value: "capitan",
          },
          {
            label: "El Creador",
            value: "creador",
          },
          {
            label: "Custom",
            value: "custom",
          },
        ],
        playerPicksSettings.hideout.type || "paletools",
        (hideoutType) => {
          playerPicksSettings.hideout.type = hideoutType;
          if (hideoutType === "custom") {
            showElements(customHideoutUploader);
          } else {
            hideElements(customHideoutUploader);
          }
        },
      );
      const customHideoutUploader = (function (
        container,
        unusedArgument2,
        onFileUploaded,
        unusedArgument4,
        readMode,
      ) {
        const fileUploadControl = new LabelWithFileInputControl(true, readMode);
        fileUploadControl.init();
        fileUploadControl.setLabel(translateLabel("plugins.playerPicks.hideout.custom"));
        if (onFileUploaded) {
          fileUploadControl.onFileUploaded(onFileUploaded);
        }
        appendElements(container, fileUploadControl);
        return fileUploadControl;
      })(
        menuContainer,
        0,
        (custom) => {
          playerPicksSettings.hideout.custom = custom;
          persistConfiguration();
        },
        0,
        fileReadMode.DATAURL,
      );
      if (playerPicksSettings.hideout.type !== "custom") {
        hideElements(customHideoutUploader);
      }
      return menuContainer;
    },
  },
};

export const playerPicksPlugin = playerPicksPluginDefinition;
