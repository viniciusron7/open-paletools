/**
 * `SbcTemplatesStore` (`paletoolsDatabase.sbcTemplates`): per-challenge SBC templates used by
 * src/plugins/sbc-template-builder/storage.js. A record holds either its own `steps` or a
 * `globalTemplateId` pointing into `globalSbcTemplates`, plus `exclusions`.
 *
 * Invariants:
 * - Object store `sbcTemplates`, keyPath `["userId", "challengeId"]`, created when
 *   oldVersion < 7; `userId` is `getSelectedPersona()` for every read and write.
 * - `set(challengeId, stepsOrGlobalTemplateId, exclusions)` stores a string second argument as
 *   `globalTemplateId` and anything else as `steps`.
 * - Legacy records stored as a bare steps array are converted by `get()` to
 *   `{challengeId, userId, steps, exclusions: []}` and written back. Upgrading from v7 calls
 *   `get()` for every stored key; it runs after the open succeeded (queries wait for
 *   `initPromise`) and only under the currently selected persona.
 * - `get()` returns `{globalTemplateId, steps, exclusions}` or null; `delete` swallows errors;
 *   `export()` is an empty stub.
 */
import { debugLog } from "../core/logger.js";
import { getSelectedPersona } from "../webapp/user.js";

const sbcTemplatesStoreName = "sbcTemplates";

export class SbcTemplatesStore {
  #e;
  constructor(database) {
    this.#e = database;
  }
  get ["name"]() {
    return sbcTemplatesStoreName;
  }
  async ["build"](oldVersion = 1) {
    debugLog("Building for v" + oldVersion);
    if (oldVersion < 7) {
      debugLog("Creating object store " + sbcTemplatesStoreName);
      this.#e.createStore(sbcTemplatesStoreName, {
        keyPath: ["userId", "challengeId"],
      });
    } else if (oldVersion < 8) {
      for (let storedKey of await this.#e.executeQuery(sbcTemplatesStoreName, (objectStore) =>
        objectStore.getAllKeys(),
      )) {
        await this.get(storedKey[1]);
      }
    }
  }
  async ["drop"]() {
    try {
      this.#e.deleteStore(sbcTemplatesStoreName);
    } catch {}
  }
  async ["get"](sbcChallengeId) {
    let template = await this.#e.executeQuery(sbcTemplatesStoreName, (objectStore) =>
      objectStore.get([getSelectedPersona(), sbcChallengeId]),
    );
    if (template instanceof Array) {
      template = {
        challengeId: sbcChallengeId,
        userId: getSelectedPersona(),
        steps: template.map((step) => step),
        exclusions: [],
      };
      await this.#e.executeNonQuery(sbcTemplatesStoreName, (objectStore) =>
        objectStore.put(template),
      );
    }
    return template
      ? {
          globalTemplateId: template.globalTemplateId,
          steps: template.steps,
          exclusions: template.exclusions,
        }
      : null;
  }
  ["set"](sbcChallengeId, globalTemplateId, exclusions) {
    const record = {
      challengeId: sbcChallengeId,
      userId: getSelectedPersona(),
      exclusions: exclusions,
    };
    if (typeof globalTemplateId === "string") {
      record.globalTemplateId = globalTemplateId;
    } else {
      record.steps = globalTemplateId;
    }
    return this.#e.executeNonQuery(sbcTemplatesStoreName, (objectStore) => objectStore.put(record));
  }
  async ["delete"](sbcChallengeId) {
    try {
      await this.#e.executeNonQuery(sbcTemplatesStoreName, (objectStore) =>
        objectStore.delete([getSelectedPersona(), sbcChallengeId]),
      );
    } catch {}
  }
  async ["export"]() {}
}
