/**
 * `GlobalSbcTemplatesStore` (`paletoolsDatabase.globalSbcTemplates`): named SBC templates
 * (`{id, name, userId, steps}`) that challenge templates can point to; used by the
 * sbc-template-builder plugin (storage.js, global templates view controller).
 *
 * Invariants:
 * - Object store `globalSbcTemplates`, keyPath `["userId", "id"]`, created when oldVersion < 9.
 * - Every read and write is scoped to `getSelectedPersona()` (stored as `userId`); `all()`
 *   filters by it client-side.
 * - `all()`/`get()` return `{steps, name, id}` (`get` returns null when missing); `delete`
 *   swallows errors; `export()` is an empty stub.
 *
 * Known issues (kept as-is):
 * - `all()` does not await `initPromise`; called before the database is open it would get
 *   `undefined` from `executeQuery` and throw on `.filter`.
 */
import { debugLog } from "../core/logger.js";
import { getSelectedPersona } from "../webapp/user.js";

const globalSbcTemplatesStoreName = "globalSbcTemplates";

export class GlobalSbcTemplatesStore {
  #e;
  constructor(database) {
    this.#e = database;
  }
  get ["name"]() {
    return globalSbcTemplatesStoreName;
  }
  async ["build"](oldVersion = 1) {
    debugLog("Building for v" + oldVersion);
    if (oldVersion < 9) {
      debugLog("Creating object store " + globalSbcTemplatesStoreName);
      this.#e.createStore(globalSbcTemplatesStoreName, {
        keyPath: ["userId", "id"],
      });
    }
  }
  async ["drop"]() {
    try {
      this.#e.deleteStore(globalSbcTemplatesStoreName);
    } catch {}
  }
  async ["all"]() {
    let templates = await this.#e.executeQuery(globalSbcTemplatesStoreName, (objectStore) =>
      objectStore.getAll(),
    );
    templates = templates.filter((template) => template.userId === getSelectedPersona());
    return templates.map((template) => ({
      steps: template.steps,
      name: template.name,
      id: template.id,
    }));
  }
  async ["get"](templateId) {
    let template = await this.#e.executeQuery(globalSbcTemplatesStoreName, (objectStore) =>
      objectStore.get([getSelectedPersona(), templateId]),
    );
    return template
      ? {
          steps: template.steps,
          name: template.name,
          id: templateId,
        }
      : null;
  }
  ["set"](templateId, name, steps) {
    return this.#e.executeNonQuery(globalSbcTemplatesStoreName, (objectStore) =>
      objectStore.put({
        id: templateId,
        name: name,
        userId: getSelectedPersona(),
        steps: steps,
      }),
    );
  }
  async ["delete"](templateId) {
    try {
      await this.#e.executeNonQuery(globalSbcTemplatesStoreName, (objectStore) =>
        objectStore.delete([getSelectedPersona(), templateId]),
      );
    } catch {}
  }
  async ["export"]() {}
}
