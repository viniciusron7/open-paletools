/**
 * Detects touch swipes on an element and calls the handlers registered with `on(name, handler)`
 * for `SWIPE_LEFT`, `SWIPE_RIGHT`, `SWIPE_UP` and `SWIPE_DOWN`; used by the sell-multiple plugin
 * (swipe left on a row).
 *
 * Invariants:
 * - A swipe fires on touchend when the dominant-axis distance exceeds `triggerPercent` (default
 *   0.3) of the element's `offsetWidth`; handlers get no data. The touch listeners are never
 *   removed.
 * - `on`/`off`/`trigger` throw for names other than the four above.
 *
 * Known issues (kept as-is):
 * - Up and down are inverted: a finger moving down (positive deltaY) fires `SWIPE_UP`.
 * - Vertical distance is also compared with `offsetWidth`.
 */
export const SwipeGestureDetector = class {
  constructor(element, swipeOptions = {}) {
    this.evtMap = {
      SWIPE_LEFT: [],
      SWIPE_UP: [],
      SWIPE_DOWN: [],
      SWIPE_RIGHT: [],
    };
    this.xDown = null;
    this.yDown = null;
    this.element = element;
    this.options = Object.assign(
      {
        triggerPercent: 0.3,
      },
      swipeOptions,
    );
    element.addEventListener("touchstart", (event) => this.handleTouchStart(event), false);
    element.addEventListener("touchend", (event) => this.handleTouchEnd(event), false);
  }
  ["on"](eventName, handler) {
    this.evtMap[eventName].push(handler);
  }
  ["off"](eventName, handler) {
    this.evtMap[eventName] = this.evtMap[eventName].filter(
      (registeredHandler) => registeredHandler !== handler,
    );
  }
  ["trigger"](eventName, eventData) {
    this.evtMap[eventName].map((handler) => handler(eventData));
  }
  ["handleTouchStart"](event) {
    this.xDown = event.touches[0].clientX;
    this.yDown = event.touches[0].clientY;
  }
  ["handleTouchEnd"](event) {
    const deltaX = event.changedTouches[0].clientX - this.xDown;
    const deltaY = event.changedTouches[0].clientY - this.yDown;
    if (
      Math.abs(Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY) / this.element.offsetWidth >
      this.options.triggerPercent
    ) {
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        if (deltaX < 0) {
          this.trigger("SWIPE_LEFT");
        } else {
          this.trigger("SWIPE_RIGHT");
        }
      } else if (deltaY > 0) {
        this.trigger("SWIPE_UP");
      } else {
        this.trigger("SWIPE_DOWN");
      }
    }
  }
};
