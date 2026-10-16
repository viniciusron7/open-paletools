/**
 * Makes an absolutely positioned element draggable by shifting its computed `left`/`top`; used
 * for the player-picks hideout overlay.
 *
 * Invariants:
 * - Moving starts on the element's mousedown/touchstart and stops on a document mouseup/touchend.
 *
 * Known issues (kept as-is):
 * - Touch dragging does nothing: `TouchEvent` has no `movementX`/`movementY`, so the offsets are
 *   NaN and the style assignment is ignored.
 * - Each call adds two `document` listeners that are never removed.
 */
export function makeElementDraggable(element) {
  function moveByPointerDelta({ movementX: deltaX, movementY: deltaY }) {
    let computedStyle = window.getComputedStyle(element);
    let currentLeft = parseInt(computedStyle.left);
    let currentTop = parseInt(computedStyle.top);
    element.style.left = currentLeft + deltaX + "px";
    element.style.top = currentTop + deltaY + "px";
  }
  element.addEventListener("touchstart", () => {
    element.addEventListener("touchmove", moveByPointerDelta);
  });
  element.addEventListener("mousedown", () => {
    element.addEventListener("mousemove", moveByPointerDelta);
  });
  document.addEventListener("touchend", () => {
    element.removeEventListener("mousemove", moveByPointerDelta);
    element.removeEventListener("touchmove", moveByPointerDelta);
  });
  document.addEventListener("mouseup", () => {
    element.removeEventListener("mousemove", moveByPointerDelta);
    element.removeEventListener("touchmove", moveByPointerDelta);
  });
}
