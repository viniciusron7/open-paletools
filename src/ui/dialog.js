/**
 * Opens an EA `EADialogViewController` popup and calls `onClose(option)` when it exits; used by
 * many plugins (warning screen, lock players, packs opener, SBC auto solver, backups, ...).
 *
 * Invariants:
 * - `dialogOptions[0]` is the continue option and `dialogOptions[1]` the cancel option, as EA
 *   option objects (`{labelEnum: enums.UIDialogOptions.*}`).
 * - The controller is `init()`ed, then shown with `gPopupClickShield.setActivePopup`, and
 *   returned.
 * - `onExit` is observed and unobserved with `this` as target, which is undefined when
 *   `showDialog` is called as a plain function; both calls must keep using the same target. The
 *   handler unobserves on the first exit.
 */
export function showDialog(dialogOptions, title, message, onClose) {
  const continueOption = dialogOptions.length > 0 ? dialogOptions[0] : null;
  const cancelOption = dialogOptions.length > 1 ? dialogOptions[1] : null;
  const dialogController = new EADialogViewController({
    continueOption: continueOption,
    cancelOption: cancelOption,
    message: message,
    title: title,
  });
  dialogController.init();
  dialogController.onExit.observe(this, function (observable, selectedOption) {
    observable.unobserve(this);
    if (onClose) {
      onClose.call(this, selectedOption);
    }
  });
  gPopupClickShield.setActivePopup(dialogController);
  return dialogController;
}
