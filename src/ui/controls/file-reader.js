/**
 * Reads the first file of an `<input type=file>` with `FileReader` as text, ArrayBuffer or data
 * URL (`fileReadMode`); used by `LabelWithFileInputControl`, the backup import and player picks.
 *
 * Invariants:
 * - Resolves undefined when no file is selected; rejects without a reason on read errors.
 * - The mode must be a `fileReadMode` value: any other value starts no read and the promise never
 *   settles.
 */
export const fileReadMode = Object.freeze({
  TEXT: "TEXT",
  BINARY: "BINARY",
  DATAURL: "DATAURL",
});

export function readSelectedFile(fileInput, readMode = fileReadMode.TEXT) {
  return new Promise((resolve, reject) => {
    if (fileInput.files.length === 0) {
      return void resolve();
    }
    const fileReader = new FileReader();
    fileReader.addEventListener("load", () => {
      resolve(fileReader.result);
    });
    fileReader.addEventListener("error", () => {
      reject();
    });
    switch (readMode) {
      case fileReadMode.TEXT:
        fileReader.readAsText(fileInput.files[0]);
        break;
      case fileReadMode.BINARY:
        fileReader.readAsArrayBuffer(fileInput.files[0]);
        break;
      case fileReadMode.DATAURL:
        fileReader.readAsDataURL(fileInput.files[0]);
    }
  });
}
