/**
 * `LabelWithFileInputControl`: `div.ut-label-with-file-input` holding a `LabelControl` and a
 * native `<input type=file>`; `upload()` reads the selected file with
 * src/ui/controls/file-reader.js and passes the content (undefined without a file) to every
 * `onFileUploaded` callback. Used by the player-picks hideout settings.
 *
 * Invariants:
 * - The options `_uploadFileOnChange`, `_uploadReadMode` and `_fileUploadedCallbacks` are
 *   assigned BEFORE `UTControl.call(this)`, because `_generate`, run by that call, reads
 *   `_uploadFileOnChange`; keep that order.
 * - Otherwise the same old-style pattern as src/ui/controls/label-control.js (no prototype
 *   inheritance from `UTControl`); `init()` is deliberately a no-op.
 * - With `uploadFileOnChange`, a change event calls `upload()` without awaiting it, so read
 *   errors are not handled there.
 */
import { addClasses, createElement, removeFromParentNode } from "../../core/dom.js";
import { listenForEvent } from "../../core/events.js";
import { fileReadMode, readSelectedFile } from "./file-reader.js";
import { LabelControl } from "./label-control.js";

const LabelWithFileInputControlImpl = function (
  uploadFileOnChange = false,
  uploadReadMode = fileReadMode.TEXT,
) {
  this._uploadFileOnChange = uploadFileOnChange;
  this._uploadReadMode = uploadReadMode;
  this._fileUploadedCallbacks = [];
  UTControl.call(this);
};

LabelWithFileInputControlImpl.prototype._generate = function () {
  if (!this.generated) {
    const rootElement = document.createElement("div");
    addClasses(rootElement, "ut-label-with-file-input");
    this._label = new LabelControl();
    this._input = createElement("input", {
      type: "file",
    });
    if (this._uploadFileOnChange) {
      listenForEvent(this._input, "change", async (event) => {
        this.upload();
      });
    }
    rootElement.appendChild(this._label.getRootElement());
    rootElement.appendChild(this._input);
    this._onInputChangeCallbacks = [];
    this.__root = rootElement;
    this.generated = true;
  }
};

LabelWithFileInputControlImpl.prototype.init = function () {};

LabelWithFileInputControlImpl.prototype.onFileUploaded = function (handler) {
  this._fileUploadedCallbacks.push(handler);
};

LabelWithFileInputControlImpl.prototype.upload = async function () {
  let fileContent = await readSelectedFile(this._input, this._uploadReadMode);
  for (let fileUploadedCallback of this._fileUploadedCallbacks) {
    fileUploadedCallback(fileContent);
  }
};

LabelWithFileInputControlImpl.prototype.setLabelLocale = function (locale) {
  this._label.getRootElement().dataset.locale = locale;
};

LabelWithFileInputControlImpl.prototype.setLabel = function (labelText) {
  this._label.setText(labelText);
};

LabelWithFileInputControlImpl.prototype.destroyGeneratedElements = function () {
  removeFromParentNode(this.__root);
  this.__root = null;
};

LabelWithFileInputControlImpl.prototype.getRootElement = function () {
  return this.__root;
};

export const LabelWithFileInputControl = LabelWithFileInputControlImpl;
