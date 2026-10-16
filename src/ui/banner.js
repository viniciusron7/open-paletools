/**
 * Shows a one-line status text in the navigation bar; used by the club players cache (loading
 * progress) and the select-cheapest plugin.
 *
 * Invariants:
 * - The element `div#banner-message.title` is created on first use, inserted right after
 *   `.ut-navigation-bar-view .title` and found again by id; "" clears the text but keeps it.
 * - When the navigation bar title is missing, the new element is never attached, so nothing is
 *   shown and a fresh detached element is created on each call.
 */
import { createElement, insertAfter, queryElement } from "../core/dom.js";

export function setBannerMessage(textContent) {
  let bannerElement = queryElement("#banner-message");
  if (!bannerElement) {
    bannerElement = createElement("div", {
      id: "banner-message",
      className: "title",
    });
    insertAfter(bannerElement, queryElement(".ut-navigation-bar-view .title"));
  }
  bannerElement.textContent = textContent;
}
