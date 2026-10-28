/**
 * `NumericSpinnerControl`: numeric spinner (`div.ut-numeric-input-spinner-control` with an EA
 * decrement button, `UTNumberInputControl` and increment button) with press-and-hold repeat;
 * used by the Auto Snipe view, the packs opener and the SBC auto-solver dialog. Since 27.2.1 the
 * release evaluates it right after the Auto Snipe runner, before the Auto Snipe view, and the
 * manifest keeps that position.
 *
 * Invariants:
 * - Unlike the other controls it really subclasses `UTControl`: the prototype is
 *   `Object.create(UTControl.prototype)` with `.constructor` restored, done at module evaluation
 *   (needs the `UTControl` global). `_generate` uses its own `_generated` flag.
 * - Callers must call `init()`, which wires the buttons and the input (placeholder translation
 *   `post.spinnerDefaultValue`).
 * - Holding a button repeats every `startInterval` (250 ms) for the first 4 steps, then every
 *   `speedInterval` (50 ms); increase and decrease exclude each other through
 *   `increaseTimeout`/`decreaseTimeout`. Timers are cleared only by `endIncrease`/`endDecrease`
 *   (TOUCHEND, TOUCHCANCEL or a limit reached), not by `destroyGeneratedElements`.
 * - Button releases fire CHANGE `{value}` through a 500 ms debounce created in `init()`; input
 *   edits fire CHANGE immediately.
 */
import { removeFromParentNode } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";

const NumericSpinnerControlImpl = function () {
  UTControl.call(this);
  this.decreaseTimeout = 0;
  this.duration = 0;
  this.increaseTimeout = 0;
  this.speedInterval = 50;
  this.startInterval = 250;
};

(NumericSpinnerControlImpl.prototype = Object.create(UTControl.prototype)).constructor =
  NumericSpinnerControlImpl;

NumericSpinnerControlImpl.prototype._generate = function () {
  if (!this._generated) {
    const root = document.createElement("div");
    root.classList.add("ut-numeric-input-spinner-control");
    this._decrementBtn = new UTStandardButtonControl();
    this._decrementBtn.getRootElement().classList.add("decrement-value");
    this._decrementBtn.getRootElement().classList.add("text");
    root.appendChild(this._decrementBtn.getRootElement());
    this._valueInput = new UTNumberInputControl();
    root.appendChild(this._valueInput.getRootElement());
    this._incrementBtn = new UTStandardButtonControl();
    this._incrementBtn.getRootElement().classList.add("increment-value");
    this._incrementBtn.getRootElement().classList.add("text");
    root.appendChild(this._incrementBtn.getRootElement());
    this.__root = root;
    this._generated = true;
  }
};

NumericSpinnerControlImpl.prototype.init = function () {
  const debouncedTriggerActions = JSUtils.debounce(this._triggerActions.bind(this), 500);
  UTControl.prototype.init.call(this);
  this._valueInput.init();
  this._valueInput.setPlaceholder(translate("post.spinnerDefaultValue"));
  this._valueInput.addTarget(this, this.eInputChanged, EventType.CHANGE);
  this._decrementBtn.init();
  this._decrementBtn.addTarget(
    this,
    () => {
      this.beginDecrease();
      this.setInteractionState(true);
    },
    EventType.TOUCHSTART,
  );
  this._decrementBtn.addTarget(
    this,
    () => {
      this.endDecrease();
      debouncedTriggerActions(EventType.CHANGE, {
        value: this.getValue(),
      });
      this.setInteractionState(true);
    },
    EventType.TOUCHEND,
  );
  this._decrementBtn.addTarget(
    this,
    () => {
      this.endDecrease();
      debouncedTriggerActions(EventType.CHANGE, {
        value: this.getValue(),
      });
      this.setInteractionState(true);
    },
    EventType.TOUCHCANCEL,
  );
  this._incrementBtn.init();
  this._incrementBtn.addTarget(
    this,
    () => {
      this.beginIncrease();
      this.setInteractionState(true);
    },
    EventType.TOUCHSTART,
  );
  this._incrementBtn.addTarget(
    this,
    () => {
      this.endIncrease();
      debouncedTriggerActions(EventType.CHANGE, {
        value: this.getValue(),
      });
      this.setInteractionState(true);
    },
    EventType.TOUCHEND,
  );
  this._incrementBtn.addTarget(
    this,
    () => {
      this.endIncrease();
      debouncedTriggerActions(EventType.CHANGE, {
        value: this.getValue(),
      });
      this.setInteractionState(true);
    },
    EventType.TOUCHCANCEL,
  );
};

NumericSpinnerControlImpl.prototype.reset = function () {
  this._valueInput.reset();
};

NumericSpinnerControlImpl.prototype.setInteractionState = function (isInteractive) {
  UTControl.prototype.setInteractionState.call(this, isInteractive);
  this._valueInput.setInteractionState(isInteractive);
  this.updateIncrementDecrementButtonInteractionStates();
};

NumericSpinnerControlImpl.prototype.getInput = function () {
  return this._valueInput;
};

NumericSpinnerControlImpl.prototype.getValue = function () {
  return this._valueInput.value;
};

NumericSpinnerControlImpl.prototype.setValue = function (newValue) {
  this._valueInput.value = newValue;
  this.updateIncrementDecrementButtonInteractionStates();
};

NumericSpinnerControlImpl.prototype.getMinValue = function () {
  return this._valueInput.getMinValue();
};

NumericSpinnerControlImpl.prototype.setMinValue = function (minValue) {
  this._valueInput.setMinValue(minValue);
};

NumericSpinnerControlImpl.prototype.getMaxValue = function () {
  return this._valueInput.getMaxValue();
};

NumericSpinnerControlImpl.prototype.setMaxValue = function (maxValue) {
  this._valueInput.setMaxValue(maxValue);
};

NumericSpinnerControlImpl.prototype.setLimits = function (minValue, maxValue) {
  const currentValue = this.getValue();
  this._valueInput.setMinValue(minValue);
  this._valueInput.setMaxValue(maxValue);
  this._decrementBtn.setInteractionState(minValue < currentValue);
  this._incrementBtn.setInteractionState(currentValue < maxValue);
};

NumericSpinnerControlImpl.prototype.focus = function () {
  this._valueInput.focus();
};

NumericSpinnerControlImpl.prototype.blur = function () {
  this._valueInput.blur();
};

NumericSpinnerControlImpl.prototype.setPlaceholder = function (placeholder) {
  this._valueInput.placeholder = placeholder;
};

NumericSpinnerControlImpl.prototype.updateIncrementDecrementButtonInteractionStates = function () {
  this._decrementBtn.setInteractionState(this.getValue() > this._valueInput.getMinValue());
  this._incrementBtn.setInteractionState(this.getValue() < this._valueInput.getMaxValue());
};

NumericSpinnerControlImpl.prototype.increment = function () {
  this.setValue(this.getValue() + 1);
};

NumericSpinnerControlImpl.prototype.decrement = function () {
  this.setValue(this.getValue() - 1);
};

NumericSpinnerControlImpl.prototype.beginIncrease = function () {
  if (!this.decreaseTimeout) {
    if (this.getValue() < this.getMaxValue()) {
      this.increment();
      this.duration++;
      const delay = this.duration <= 4 ? this.startInterval : this.speedInterval;
      this.increaseTimeout = window.setTimeout(this.beginIncrease.bind(this), delay);
    } else {
      this.endIncrease();
    }
  }
};

NumericSpinnerControlImpl.prototype.beginDecrease = function () {
  if (!this.increaseTimeout) {
    if (this.getValue() > this.getMinValue()) {
      this.decrement();
      this.duration++;
      const delay = this.duration <= 4 ? this.startInterval : this.speedInterval;
      this.decreaseTimeout = window.setTimeout(this.beginDecrease.bind(this), delay);
    } else {
      this.endDecrease();
    }
  }
};

NumericSpinnerControlImpl.prototype.endIncrease = function () {
  window.clearTimeout(this.increaseTimeout);
  this.increaseTimeout = 0;
  this.duration = 0;
};

NumericSpinnerControlImpl.prototype.endDecrease = function () {
  window.clearTimeout(this.decreaseTimeout);
  this.decreaseTimeout = 0;
  this.duration = 0;
};

NumericSpinnerControlImpl.prototype.eInputChanged = function (sender, eventType, eventData) {
  this._triggerActions(EventType.CHANGE, {
    value: eventData.value,
  });
  this.setInteractionState(true);
};

NumericSpinnerControlImpl.prototype.destroyGeneratedElements = function () {
  removeFromParentNode(this.__root);
  this.__root = null;
  this._decrementBtn.destroy();
  this._valueInput.destroy();
  this._incrementBtn.destroy();
};

NumericSpinnerControlImpl.prototype.getRootElement = function () {
  return this.__root;
};

export const NumericSpinnerControl = NumericSpinnerControlImpl;
