/**
 * `StoredIdList` of the SBC set ids hidden by the hide-sbcs plugin
 * (src/plugins/hide-sbcs/index.js).
 *
 * Invariants:
 * - The key callback `"hiddenSbc:" + persona` is evaluated on every access, so the list follows
 *   the selected persona; it is persisted in localStorage through `paletoolsStorage` (effective
 *   key `paletools:<APP_YEAR>:<persona>:hiddenSbc:<persona>`).
 * - Instantiated at module evaluation, so the manifest must keep this module after
 *   src/core/storage.js (class declarations are not hoisted).
 */
import { StoredIdList } from "../../core/storage.js";
import { getSelectedPersona } from "../../webapp/user.js";

export const hiddenSbcSetIds = new StoredIdList(() => "hiddenSbc:" + getSelectedPersona());
