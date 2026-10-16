/**
 * `BackupView` (EAView via `JSUtils.inherits`), created by `BackupViewController`
 * (./backup-view-controller.js): two `LayoutHubGrid` tiles with the export button and the import
 * file input and button.
 *
 * Invariants:
 * - It talks to the controller only through the `onExportClicked`/`onImportClicked`
 *   `EAObservable`s; import first asks for confirmation (`plugins.backup.import.warning.*`) and
 *   notifies only on OK.
 * - `startExport`/`endExport` and `startImport`/`endImport` switch the button text to `loading`
 *   and disable/re-enable it; `getFileElement()` exposes the file input the controller reads.
 * - Stylesheet id `paletools-backup`; the tile descriptions are hard-coded English text.
 */
import { createElement } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { showDialog } from "../../ui/dialog.js";
import { LayoutHubGrid } from "../../ui/layout-hub-grid.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import backupCss from "./backup.css";

const BackupViewImpl = function () {
  EAView.call(this);
  this.onExportClicked = new EAObservable();
  this.onImportClicked = new EAObservable();
};

JSUtils.inherits(BackupViewImpl, EAView);

BackupViewImpl.prototype._generate = function () {
  if (!this.generated) {
    upsertStylesheet("paletools-backup", backupCss);
    this._importButton = new UTStandardButtonControl();
    this._importButton.init();
    this._importButton.setText(translate("import"));
    this._importButton.addTarget(
      this,
      () =>
        showDialog(
          [
            {
              labelEnum: enums.UIDialogOptions.OK,
            },
            {
              labelEnum: enums.UIDialogOptions.CANCEL,
            },
          ],
          translate("plugins.backup.import.warning.title"),
          translate("plugins.backup.import.warning.text"),
          async (selectedOption) => {
            if (selectedOption == enums.UIDialogOptions.OK) {
              this.onImportClicked.notify();
            }
          },
        ),
      EventType.TAP,
    );
    this._exportButton = new UTStandardButtonControl();
    this._exportButton.init();
    this._exportButton.setText(translate("export"));
    this._exportButton.addTarget(this, () => this.onExportClicked.notify(), EventType.TAP);
    this._fileElement = createElement("input", {
      type: "file",
    });
    const grid = new LayoutHubGrid(2);
    grid.addClass("backup");
    grid
      .addTile()
      .title(translate("export"))
      .content(
        createElement(
          "div",
          {},
          "The export functionality allows you to backup all the date Paletools store, the settings, locked players, locked packs and all your transactions history, just click on the export button and a file with all the data will get downloaded for you",
        ),
        createElement("div"),
        this._exportButton,
      );
    grid
      .addTile()
      .title(translate("import"))
      .content(
        createElement(
          "div",
          {},
          "The import functionality allows you to load a previously exported file, in order to continue just select the file you want to import and click on the import button.",
        ),
        this._fileElement,
        this._importButton,
      );
    this.__root = grid.getRootElement();
    this.generated = true;
  }
};

BackupViewImpl.prototype.startExport = function () {
  this._exportButton.setText(translate("loading"));
  this._exportButton.setInteractionState(false);
};

BackupViewImpl.prototype.endExport = function () {
  this._exportButton.setText(translate("export"));
  this._exportButton.setInteractionState(true);
};

BackupViewImpl.prototype.startImport = function () {
  this._importButton.setText(translate("loading"));
  this._importButton.setInteractionState(false);
};

BackupViewImpl.prototype.endImport = function () {
  this._importButton.setText(translate("import"));
  this._importButton.setInteractionState(true);
};

BackupViewImpl.prototype.getFileElement = function () {
  return this._fileElement;
};

export const BackupView = BackupViewImpl;
