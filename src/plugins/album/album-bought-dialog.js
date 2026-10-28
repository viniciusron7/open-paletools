/**
 * `AlbumBoughtDialogController` (extends `EADialogViewController`, added in 27.2.1): the "Card
 * bought" dialog the album and gallery Buy button shows after a purchase. It renders the bought
 * card and asks where to send it.
 *
 * Invariants:
 * - The buttons notify `onExit` with their `labelEnum`: "club" (Send to club) or
 *   "transferList" (Send to transfer list); Escape notifies `null`. The caller
 *   (`_buyClicked` in src/plugins/album/album-view-controller.js) moves the card only for
 *   "club" or "transferList".
 * - The card view is created in `_getViewInstanceFromData` and destroyed by `dealloc`, which
 *   also drops the item.
 */
import { appendElements } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";

const translateAlbumBoughtDialogText = (translationKey) =>
  translate("plugins.album." + translationKey);

export function AlbumBoughtDialogController(item) {
  EADialogViewController.call(this, {});
  this.item = item;
}

JSUtils.inherits(AlbumBoughtDialogController, EADialogViewController);

AlbumBoughtDialogController.prototype._getViewInstanceFromData = function () {
  const dialogView = new EADialogView({
    title: translateAlbumBoughtDialogText("boughtTitle"),
    buttons: [
      {
        label: translateAlbumBoughtDialogText("sendToClub"),
        role: "continue",
        labelEnum: "club",
      },
      {
        label: translateAlbumBoughtDialogText("sendToTransferList"),
        role: "cancel",
        labelEnum: "transferList",
      },
    ],
  });
  this.card = UTItemViewFactory.createLargeItem(this.item);
  this.card.init();
  this.card.render(this.item);
  appendElements(dialogView.getContent(), this.card);
  return dialogView;
};

AlbumBoughtDialogController.prototype.handleKeyUpEvent = function (event) {
  if (!(event.key !== KeyboardKey.ESCAPE && event.key !== KeyboardKey.MS_ESCAPE)) {
    this.onExit.notify(null);
  }
};

AlbumBoughtDialogController.prototype.dealloc = function () {
  this.card?.destroy();
  this.card = null;
  this.item = null;
  EADialogViewController.prototype.dealloc.call(this);
};
