/**
 * Shows and hides EA's global loading click shield (`gClickShield`,
 * `EAClickShieldView.Shield.LOADING`) and removes the `.loading-progress` element inside a
 * container. Used by long-running plugin flows (SBC solvers and builders, packs opener, album,
 * gallery, lowest-market-price, sell-multiple, remove-all-evolutions).
 */
import { queryElement, removeFromParentNode } from "../core/dom.js";

export function showLoadingShield() {
  gClickShield.showShield(EAClickShieldView.Shield.LOADING);
}

export function hideLoadingShield() {
  gClickShield.hideShield(EAClickShieldView.Shield.LOADING);
}

export function removeLoadingProgressIndicator(container) {
  removeFromParentNode(queryElement(".loading-progress", container));
}
