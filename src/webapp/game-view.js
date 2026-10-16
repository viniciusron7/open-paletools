/**
 * `getControllerView(controller)` returns a controller's view (`_view` or `view`; used by
 * sbc-builder-enhancer and repeat-sbc). `reloadGameView()` sets an empty
 * `PlaceholderViewController` as the root controller's presented controller and calls
 * `showGameView()`; it runs at the end of plugin start-up in src/bootstrap/boot.js and after a
 * backup import (src/plugins/settings/backup-view-controller.js).
 *
 * Invariants:
 * - `PlaceholderViewController`/`PlaceholderView` are ES5 subclasses of `EAViewController`/`EAView`
 *   set up with `JSUtils.inherits` at module evaluation; `PlaceholderView.removeTarget` is a no-op.
 */
export function getControllerView(controller) {
  return controller._view || controller.view;
}

export function reloadGameView() {
  getAppMain().getRootViewController().presentationController.presentedViewController =
    new PlaceholderViewController();
  getAppMain().getRootViewController().showGameView();
}

function PlaceholderViewController() {
  EAViewController.call(this);
}

function PlaceholderView() {
  EAView.call(this);
}

JSUtils.inherits(PlaceholderViewController, EAViewController);

PlaceholderViewController.prototype._getViewInstanceFromData = function () {
  return new PlaceholderView();
};

JSUtils.inherits(PlaceholderView, EAView);

PlaceholderView.prototype.removeTarget = () => {};
