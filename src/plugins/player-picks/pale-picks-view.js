/**
 * `PalePicksView`: replacement for EA's `UTPlayerPicksView` (built with `__extends` on
 * `EATargetActionView`) that shows every pick option at once as large item cards with per-card
 * remove buttons. Instantiated by src/plugins/player-picks/index.js, which also wraps its
 * `setCarouselItems`.
 *
 * Invariants:
 * - It must expose the method surface `UTPlayerPicksViewController` calls on its view (toggle*,
 *   set*, render/clear picks, carousel selection); `toggleSelectButton`, `carouselFocus`,
 *   `setActiveIndexState` and `removeActiveIndexState` are deliberate no-ops.
 * - It reports back only through `_triggerActions(UTPlayerPicksView.Event.*)` (EXIT, CONTINUE,
 *   BACK, CONFIRM_PICK, SELECT_CURRENT_PICK, CAROUSEL_SCROLLED, CANCEL_SELECTION) and reads
 *   `this._controller` (`availablePicks`, `selectedPicks`, `getCurrentPick()`, `isAtMaxPicks()`),
 *   which the plugin sets in `_getViewInstanceFromData`.
 * - `_generate` creates the buttons, so `init()` calls the base `init` before configuring them;
 *   `dealloc` removes the same TAP targets before the base `dealloc`.
 * - Clicking a card with `availablePicks === 1` first cancels the current pick; otherwise it
 *   selects only while not at max picks. `palePickViews` and `itemViews` are index-aligned with
 *   the pick items; selection, deselection and the hideout overlay rely on that.
 * - Classes `ut-player-picks-view-extended` and `player-pick-view` are styled by
 *   player-picks.css.
 */
import {
  addClasses,
  appendElements,
  createElement,
  queryElement,
  removeClasses,
} from "../../core/dom.js";
import { listenForEvent } from "../../core/events.js";
import { translate } from "../../i18n/translations.js";
import { hideElements, showElements } from "../../ui/visibility.js";

let PalePicksViewImpl = (function (BaseView) {
  function PalePicksViewConstructor() {
    let view = BaseView.call(this) || this;
    view.playerPickViews = [];
    return view;
  }
  __extends(PalePicksViewConstructor, BaseView);
  PalePicksViewConstructor.prototype.init = function () {
    BaseView.prototype.init.call(this);
    [
      {
        btn: this._itemInfoSwitchBtn,
        init: true,
        text: null,
        action: null,
        event: null,
        enabled: true,
      },
      {
        btn: this._exitBtn,
        init: true,
        text: null,
        action: this.onExitTapped,
        event: EventType.TAP,
      },
      {
        btn: this._selectBtn,
        init: true,
        text: translate("common.dialog.select"),
        action: this.eSelectButtonTapped,
        event: EventType.TAP,
        enabled: false,
      },
      {
        btn: this._continueBtn,
        init: true,
        text: translate("common.dialog.continue"),
        action: this.eContinueButtonTapped,
        event: EventType.TAP,
        enabled: false,
      },
      {
        btn: this._backBtn,
        init: true,
        text: translate("common.dialog.back"),
        action: this.eBackButtonTapped,
        event: EventType.TAP,
      },
      {
        btn: this._confirmBtn,
        init: true,
        text: translate("common.dialog.confirm"),
        action: this.eConfirmButtonTapped,
        event: EventType.TAP,
      },
    ].forEach(
      ({
        btn: button,
        init: shouldInit,
        text: buttonText,
        action: action,
        event: eventType,
        enabled: isInteractive,
      }) => {
        if (shouldInit) {
          button.init();
        }
        if (buttonText !== null) {
          button.setText(buttonText);
        }
        if (isInteractive !== undefined) {
          button.setInteractionState(isInteractive);
        }
        if (action && eventType) {
          button.addTarget(this, action, eventType);
        }
      },
    );
    this.setTitle(translate("playerpicks.modal.title.multiple"));
    this.setDescription(translate("playerpicks.modal.description.multiple"));
    this.setOwnershipDescription(translate("playerpicks.modal.option.owned"));
    this.setItemSelectedDescription(translate("playerpicks.modal.option.selected"));
  };
  PalePicksViewConstructor.prototype.dealloc = function () {
    this.playerPickViews.forEach((pickView) => pickView.dealloc());
    [
      [this._exitBtn, this.onExitTapped],
      [this._selectBtn, this.eSelectButtonTapped],
      [this._continueBtn, this.eContinueButtonTapped],
      [this._backBtn, this.eBackButtonTapped],
      [this._confirmBtn, this.eConfirmButtonTapped],
    ].forEach(([button, action]) => button.removeTarget(this, action, EventType.TAP));
    BaseView.prototype.dealloc.call(this);
  };
  PalePicksViewConstructor.prototype.setTitle = function (title) {
    this.__title.textContent = title;
  };
  PalePicksViewConstructor.prototype.setDescription = function (description) {
    this.__description.textContent = description;
  };
  PalePicksViewConstructor.prototype.setOwnershipDescription = function (ownershipDescription) {
    this.__ownershipDescription.textContent = ownershipDescription;
  };
  PalePicksViewConstructor.prototype.setItemSelectedDescription = function (selectedDescription) {
    this.__itemSelectedDescription.textContent = selectedDescription;
  };
  PalePicksViewConstructor.prototype.toggleSelectButton = function (isVisible) {};
  PalePicksViewConstructor.prototype.toggleConfirmButton = function (isVisible) {
    this._confirmBtn.setDisplay(isVisible);
    this._confirmBtn.setInteractionState(isVisible);
  };
  PalePicksViewConstructor.prototype.toggleBackButton = function (isVisible) {
    this._backBtn.setDisplay(isVisible);
  };
  PalePicksViewConstructor.prototype.toggleContinueButton = function (isVisible) {
    this._continueBtn.setDisplay(isVisible);
  };
  PalePicksViewConstructor.prototype.toggleChooseContainer = function (isVisible) {
    this.__chooseContainer.style.display = isVisible ? "block" : "none";
  };
  PalePicksViewConstructor.prototype.toggleChosenContainer = function (isVisible) {
    this.__chosenContainer.style.display = isVisible ? "block" : "none";
  };
  PalePicksViewConstructor.prototype.toggleSelectedDescription = function (isVisible) {
    this.__itemSelectedDescription.style.display = isVisible ? "block" : "none";
  };
  PalePicksViewConstructor.prototype.setCarouselItems = function (pickItems) {
    this.itemViews = [];
    this.palePickViews = [];
    pickItems.map((item, index) => {
      const pickContainer = createElement("div", {
        className: "player-pick-view",
      });
      const ownershipLabel = createElement("div", {
        className: "ownership-container",
      });
      if (item.isDuplicate()) {
        ownershipLabel.textContent = this.__ownershipDescription.textContent;
      } else {
        ownershipLabel.innerHTML = "&nbsp;";
      }
      const removeButton = new UTStandardButtonControl();
      removeButton.init();
      removeButton.setText(translate("infopanel.button.remove"));
      hideElements(removeButton);
      addClasses(removeButton, "mini", "remove-pick");
      removeButton.addTarget(
        this,
        () => {
          this._triggerActions(UTPlayerPicksView.Event.CANCEL_SELECTION, {
            item: item,
          });
          hideElements(removeButton);
        },
        EventType.TAP,
      );
      const largeItem = UTItemViewFactory.createLargeItem(item);
      largeItem.init();
      largeItem.render(item);
      appendElements(pickContainer, ownershipLabel, largeItem, removeButton);
      appendElements(this._carouselItemsContainer, pickContainer);
      this.palePickViews.push(pickContainer);
      listenForEvent(largeItem, "click", () => {
        if (this._controller.availablePicks === 1) {
          if (this._controller.selectedPicks.length > 0) {
            this._triggerActions(UTPlayerPicksView.Event.CANCEL_SELECTION, {
              item: this._controller.getCurrentPick(),
            });
          }
          this._triggerActions(UTPlayerPicksView.Event.CAROUSEL_SCROLLED, {
            item: item,
            index: index,
          });
          this._triggerActions(UTPlayerPicksView.Event.SELECT_CURRENT_PICK);
        } else if (!this._controller.isAtMaxPicks()) {
          this._triggerActions(UTPlayerPicksView.Event.CAROUSEL_SCROLLED, {
            item: item,
            index: index,
          });
          this._triggerActions(UTPlayerPicksView.Event.SELECT_CURRENT_PICK);
        }
      });
      this.itemViews.push(largeItem);
    });
    this.layoutSubviews();
  };
  PalePicksViewConstructor.prototype.renderSelectedPicks = function (selectedPicks) {
    this.clearPlayersPickViews();
    const isPhoneLayout = isPhone();
    selectedPicks.forEach((pick) => {
      const pickOptionView = new UTPlayerPickOptionView();
      pickOptionView.init();
      pickOptionView.createItem(pick, isPhoneLayout);
      pickOptionView.setInteractionState(true);
      this.playerPickViews.push(pickOptionView);
      this.addSubview(pickOptionView, this.__gridItems);
    });
    this.layoutSubviews();
  };
  PalePicksViewConstructor.prototype.clearPlayersPickViews = function () {
    this.playerPickViews.forEach((pickView) => pickView.dealloc());
    this.playerPickViews = [];
  };
  PalePicksViewConstructor.prototype.carouselFocus = function () {};
  PalePicksViewConstructor.prototype.setSelectedCarouselItem = function (index) {
    addClasses(this.itemViews[index], "selected");
    showElements(queryElement(".remove-pick", this.palePickViews[index]));
  };
  PalePicksViewConstructor.prototype.deselectCarouselItemByIndex = function (index) {
    removeClasses(this.itemViews[index], "selected");
    hideElements(queryElement(".remove-pick", this.palePickViews[index]));
  };
  PalePicksViewConstructor.prototype.setConfirmButtonInteractionState = function (isInteractive) {
    this._confirmBtn.setInteractionState(isInteractive);
  };
  PalePicksViewConstructor.prototype.setContinueButtonInteractionState = function (isInteractive) {
    this._continueBtn.setInteractionState(isInteractive);
  };
  PalePicksViewConstructor.prototype.onExitTapped = function () {
    this._triggerActions(UTPlayerPicksView.Event.EXIT);
  };
  PalePicksViewConstructor.prototype.eSelectButtonTapped = function () {
    this._triggerActions(UTPlayerPicksView.Event.SELECT_CURRENT_PICK);
  };
  PalePicksViewConstructor.prototype.eContinueButtonTapped = function () {
    this._triggerActions(UTPlayerPicksView.Event.CONTINUE);
  };
  PalePicksViewConstructor.prototype.eBackButtonTapped = function () {
    this._triggerActions(UTPlayerPicksView.Event.BACK);
  };
  PalePicksViewConstructor.prototype.eConfirmButtonTapped = function () {
    this._triggerActions(UTPlayerPicksView.Event.CONFIRM_PICK);
  };
  PalePicksViewConstructor.prototype.setActiveIndexState = function (index) {};
  PalePicksViewConstructor.prototype.removeActiveIndexState = function () {};
  PalePicksViewConstructor.prototype.setSelectedCounterText = function (selectedCount, maxCount) {
    this.__selectedCounter.textContent = translate("common.fraction", [
      selectedCount.toString(),
      maxCount.toString(),
    ]);
  };
  PalePicksViewConstructor.prototype.toggleSelectedTextDisplay = function (isSelected) {
    DOMKit.toggleClass(this.__itemSelectedDescription, "selected", isSelected);
  };
  PalePicksViewConstructor.prototype.updateItemStateText = function (isOwned, isUntradeable) {
    DOMKit.toggleClass(this.__ownershipDescription, "owned", isOwned);
    DOMKit.toggleClass(this.__ownershipDescription, "untradeable", isUntradeable);
  };
  PalePicksViewConstructor.prototype.getItemInfoSwitchButton = function () {
    return this._itemInfoSwitchBtn;
  };
  PalePicksViewConstructor.prototype.handleCancelSelection = function (
    sender,
    eventType,
    eventData,
  ) {
    this._triggerActions(UTPlayerPicksView.Event.CANCEL_SELECTION, {
      item: eventData.item,
    });
  };
  PalePicksViewConstructor.prototype.bubbleEvent = function (sender, eventType, eventData) {
    this._triggerActions(eventType, eventData);
  };
  PalePicksViewConstructor.prototype._generate = function () {
    if (!this._generated) {
      var root = document.createElement("div");
      root.classList.add("ut-player-picks-view", "ut-player-picks-view-extended");
      var header = document.createElement("header");
      this._itemInfoSwitchBtn = new UTItemInfoChangeButtonControl();
      this._itemInfoSwitchBtn.getRootElement().classList.add("ut-player-picks-view--info-change");
      header.appendChild(this._itemInfoSwitchBtn.getRootElement());
      this._exitBtn = new UTImageButtonControl();
      this._exitBtn.getRootElement().classList.add("exit-btn");
      header.appendChild(this._exitBtn.getRootElement());
      this.__title = document.createElement("h1");
      this.__title.classList.add("title");
      header.appendChild(this.__title);
      this.__description = document.createElement("p");
      this.__description.classList.add("description");
      header.appendChild(this.__description);
      this.__selectedCounter = document.createElement("p");
      this.__selectedCounter.classList.add("selected-counter");
      header.appendChild(this.__selectedCounter);
      root.appendChild(header);
      this.__chooseContainer = document.createElement("section");
      this.__chooseContainer.classList.add("content-container");
      this.__ownershipDescription = document.createElement("p");
      this.__ownershipDescription.classList.add("ownership-description");
      this.__chooseContainer.appendChild(this.__ownershipDescription);
      this._carouselItemsContainer = document.createElement("div");
      this.__chooseContainer.appendChild(this._carouselItemsContainer);
      this.__itemSelectedDescription = document.createElement("p");
      this.__itemSelectedDescription.classList.add("item-selected-description");
      this.__chooseContainer.appendChild(this.__itemSelectedDescription);
      this.__carouselIndicatorDots = document.createElement("ul");
      this.__carouselIndicatorDots.classList.add("carousel-indicator-dots");
      this.__chooseContainer.appendChild(this.__carouselIndicatorDots);
      this._selectBtn = new UTStandardButtonControl();
      this._selectBtn.getRootElement().classList.add("mini");
      this._selectBtn.getRootElement().classList.add("select-btn");
      this._selectBtn.getRootElement().classList.add("primary");
      this.__chooseContainer.appendChild(this._selectBtn.getRootElement());
      root.appendChild(this.__chooseContainer);
      this.__chosenContainer = document.createElement("section");
      this.__chosenContainer.classList.add("content-container");
      this.__gridItems = document.createElement("div");
      this.__gridItems.classList.add("grid-scrollable");
      this.__chosenContainer.appendChild(this.__gridItems);
      root.appendChild(this.__chosenContainer);
      var footer = document.createElement("footer");
      this._continueBtn = new UTStandardButtonControl();
      this._continueBtn.getRootElement().classList.add("mini");
      this._continueBtn.getRootElement().classList.add("primary");
      footer.appendChild(this._continueBtn.getRootElement());
      this._backBtn = new UTStandardButtonControl();
      this._backBtn.getRootElement().classList.add("back-btn");
      this._backBtn.getRootElement().classList.add("mini");
      footer.appendChild(this._backBtn.getRootElement());
      this._confirmBtn = new UTStandardButtonControl();
      this._confirmBtn.getRootElement().classList.add("mini");
      this._confirmBtn.getRootElement().classList.add("primary");
      footer.appendChild(this._confirmBtn.getRootElement());
      root.appendChild(footer);
      this.__root = root;
      this._generated = true;
    }
  };
  PalePicksViewConstructor.prototype.destroyGeneratedElements = function () {
    DOMKit.remove(this.__root);
    this.__root = null;
    this._itemInfoSwitchBtn.destroy();
    this._exitBtn.destroy();
    this.__title = null;
    this.__description = null;
    this.__selectedCounter = null;
    this.__chooseContainer = null;
    this.__ownershipDescription = null;
    this.__itemSelectedDescription = null;
    this.__carouselIndicatorDots = null;
    this._selectBtn.destroy();
    this.__chosenContainer = null;
    this.__gridItems = null;
    this._continueBtn.destroy();
    this._backBtn.destroy();
    this._confirmBtn.destroy();
  };
  PalePicksViewConstructor.prototype.getRootElement = function () {
    return this.__root;
  };
  return PalePicksViewConstructor;
})(EATargetActionView);

export const PalePicksView = PalePicksViewImpl;
