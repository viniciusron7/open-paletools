/**
 * Creates, replaces or removes `<style>` elements by id; used by most plugins to install their
 * CSS.
 *
 * Invariants:
 * - Style elements are appended to `document.body` (not `head`) and found again by id: a second
 *   `upsertStylesheet` with the same id replaces the text in place, so ids must be unique per
 *   stylesheet.
 * - `removeStylesheet` is a no-op when the id is absent.
 */
export function upsertStylesheet(styleId, cssText) {
  let styleElement = document.getElementById(styleId);
  if (styleElement) {
    styleElement.textContent = cssText;
  } else {
    styleElement = document.createElement("style");
    styleElement.textContent = cssText;
    styleElement.id = styleId;
    document.body.appendChild(styleElement);
  }
}

export function removeStylesheet(styleId) {
  const styleElement = document.getElementById(styleId);
  if (styleElement) {
    document.body.removeChild(styleElement);
  }
}
