/**
 * Persistence helpers of the SBC template builder over the persona-scoped IndexedDB stores
 * `paletoolsDatabase.sbcTemplates` and `paletoolsDatabase.globalSbcTemplates`; used by the
 * plugin's index.js and controllers.
 *
 * Invariants:
 * - Templates of single-challenge sets are keyed `"s" + set.id`, others by `challenge.id`;
 *   loading a single-challenge set migrates a legacy `challenge.id` record to the set key.
 * - A record holds `steps` (array of `{searchCriteria, searchSettings}`) or a `globalTemplateId`
 *   (the store tells them apart with `typeof === "string"`, so global ids must stay strings) plus
 *   `exclusions`. Loading resolves a global id to that template's steps, or null if it is gone.
 * - Global templates are returned sorted by name.
 *
 * Known issues (kept as-is):
 * - The legacy-key migration re-saves only the steps or global id and drops the exclusions.
 */
import { paletoolsDatabase } from "../../db/database.js";

export async function loadSortedGlobalSbcTemplates() {
  var templates = await paletoolsDatabase.globalSbcTemplates.all();
  templates.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return templates;
}

export async function saveGlobalSbcTemplate(templateId, templateName, steps) {
  await paletoolsDatabase.globalSbcTemplates.set(templateId, templateName, steps);
}

export async function loadSbcChallengeTemplate(sbcSet, challenge) {
  let template = null;
  if (sbcSet.challenges.length === 1) {
    let setTemplateKey = "s" + sbcSet.id;
    template = await paletoolsDatabase.sbcTemplates.get(setTemplateKey);
    if (!template) {
      template = await paletoolsDatabase.sbcTemplates.get(challenge.id);
      if (template) {
        await paletoolsDatabase.sbcTemplates.delete(challenge.id);
        if (template.steps) {
          await paletoolsDatabase.sbcTemplates.set(setTemplateKey, template.steps);
        } else if (template.globalTemplateId) {
          await paletoolsDatabase.sbcTemplates.set(setTemplateKey, template.globalTemplateId);
        }
      }
    }
  } else {
    template = await paletoolsDatabase.sbcTemplates.get(challenge.id);
  }
  if (!template) {
    return null;
  }
  if (template.globalTemplateId) {
    const globalTemplate = await paletoolsDatabase.globalSbcTemplates.get(
      template.globalTemplateId,
    );
    if (!globalTemplate) {
      return null;
    }
    template.steps = globalTemplate.steps;
  }
  return template;
}

export async function saveSbcChallengeTemplate(
  sbcSet,
  challenge,
  stepsOrGlobalTemplateId,
  exclusions,
) {
  if (sbcSet.challenges.length === 1) {
    await paletoolsDatabase.sbcTemplates.set("s" + sbcSet.id, stepsOrGlobalTemplateId, exclusions);
  } else {
    await paletoolsDatabase.sbcTemplates.set(challenge.id, stepsOrGlobalTemplateId, exclusions);
  }
}
