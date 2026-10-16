/**
 * `BackupViewController`, pushed by the Backup button of src/plugins/settings/settings-view.js:
 * exports all Paletools data to a JSON download and restores it from a selected file.
 *
 * Invariants:
 * - Export format `{version: 1, localStorage, indexedDb}`: every localStorage entry whose key
 *   starts with `paletools:` (all personas, settings and storage version included) plus
 *   `paletoolsDatabase.exportDb()`; file `paletools-backup_YYYY-MM-DD_HH-MM-SS.json`.
 *   sessionStorage is not exported.
 * - Import also accepts the field names `storage` and `db`, requires an object of localStorage
 *   data, deletes every `paletools:` key, restores the string values, then runs
 *   `paletoolsDatabase.importDb(data || {})`, `loadConfiguration()` and `reloadGameView()`.
 * - The restore is not atomic: localStorage is replaced before the IndexedDB import, which can
 *   still fail. Errors are shown with `showErrorNotification(message || "ERROR")`.
 */
import { loadConfiguration } from "../../config/configuration.js";
import { paletoolsDatabase } from "../../db/database.js";
import { BackupView } from "./backup-view.js";
import { readSelectedFile } from "../../ui/controls/file-reader.js";
import { showErrorNotification } from "../../ui/notifications.js";
import { reloadGameView } from "../../webapp/game-view.js";

function isPaletoolsStorageKey(storageKey) {
  return storageKey === "paletools:settings" || storageKey.startsWith("paletools:");
}

function collectPaletoolsLocalStorage() {
  const storageEntries = {};
  for (let index = 0; index < localStorage.length; index++) {
    const storageKey = localStorage.key(index);
    if (storageKey && isPaletoolsStorageKey(storageKey)) {
      storageEntries[storageKey] = localStorage.getItem(storageKey);
    }
  }
  return storageEntries;
}

const BackupViewControllerImpl = function () {
  EAViewController.call(this);
};

JSUtils.inherits(BackupViewControllerImpl, EAViewController);

BackupViewControllerImpl.prototype.init = function () {
  if (!this.initialized) {
    this.getView().onExportClicked.observe(this, this._export);
    this.getView().onImportClicked.observe(this, this._import);
    this.initialized = true;
  }
};

BackupViewControllerImpl.prototype._export = async function () {
  this.getView().startExport();
  try {
    const backup = {
      version: 1,
      localStorage: collectPaletoolsLocalStorage(),
      indexedDb: await paletoolsDatabase.exportDb(),
    };
    await ((backupJson = JSON.stringify(backup, null, 2)),
    (backupFileName =
      "paletools-backup_" +
      ((now = new Date()),
      now.getFullYear() +
        "-" +
        String(now.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(now.getDate()).padStart(2, "0") +
        "_" +
        String(now.getHours()).padStart(2, "0") +
        "-" +
        String(now.getMinutes()).padStart(2, "0") +
        "-" +
        String(now.getSeconds()).padStart(2, "0")) +
      ".json"),
    new Promise((resolve) => {
      var content;
      var fileName;
      var mimeType;
      var link;
      content = backupJson;
      fileName = backupFileName;
      mimeType = "text/json;encoding:utf-8";
      link = document.createElement("a");
      mimeType = mimeType || "application/octet-stream";
      if (navigator.msSaveBlob) {
        navigator.msSaveBlob(
          new Blob([content], {
            type: mimeType,
          }),
          fileName,
        );
      } else if (URL && "download" in link) {
        link.href = URL.createObjectURL(
          new Blob([content], {
            type: mimeType,
          }),
        );
        link.setAttribute("download", fileName);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        location.href = "data:application/octet-stream," + encodeURIComponent(content);
      }
      resolve();
    }));
  } catch (error) {
    showErrorNotification(error?.message || "ERROR");
  } finally {
    this.getView().endExport();
  }
  var backupJson;
  var backupFileName;
  var now;
};

BackupViewControllerImpl.prototype._import = async function () {
  this.getView().startImport();
  try {
    let backupData;
    backupData = await readSelectedFile(this.getView().getFileElement());
    if (!backupData) {
      return;
    }
    backupData = JSON.parse(backupData);
    if (!backupData || typeof backupData !== "object" || Array.isArray(backupData)) {
      throw new Error("Invalid backup file");
    }
    const localStorageData = backupData.localStorage || backupData.storage;
    const indexedDbData = backupData.indexedDb || backupData.db;
    if (!localStorageData || typeof localStorageData !== "object") {
      throw new Error("Backup is missing local storage data");
    }
    (function (storageEntries) {
      for (let index = localStorage.length - 1; index >= 0; index--) {
        const storageKey = localStorage.key(index);
        if (storageKey && isPaletoolsStorageKey(storageKey)) {
          localStorage.removeItem(storageKey);
        }
      }
      for (const [storageKey, storageValue] of Object.entries(storageEntries)) {
        if (isPaletoolsStorageKey(storageKey) && typeof storageValue === "string") {
          localStorage.setItem(storageKey, storageValue);
        }
      }
    })(localStorageData);
    await paletoolsDatabase.importDb(indexedDbData || {});
    loadConfiguration();
    reloadGameView();
  } catch (error) {
    showErrorNotification(error?.message || "ERROR");
  } finally {
    this.getView().endImport();
  }
};

BackupViewControllerImpl.prototype._getViewInstanceFromData = function () {
  return new BackupView(this._menus);
};

BackupViewControllerImpl.prototype.viewDidAppear = function () {
  this.getNavigationController().setNavigationVisibility(true, true);
};

BackupViewControllerImpl.prototype.getNavigationTitle = function () {
  return "Backup";
};

export const BackupViewController = BackupViewControllerImpl;
