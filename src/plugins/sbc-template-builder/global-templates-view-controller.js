/**
 * `GlobalSbcTemplatesViewController`: list of the global SBC templates, pushed by the button the
 * template builder plugin adds to the SBC hub.
 *
 * Invariants:
 * - `JSUtils.inherits(GlobalSbcTemplatesViewController, EAViewController)` runs at module
 *   evaluation and must precede the `prototype.*` assignments.
 * - Templates are (re)loaded on every `viewDidAppear`; `_templates` is null until then. Add opens
 *   an editor for `{id: generateUuid(), name, steps: []}` (blank names ignored); remove deletes
 *   the IndexedDB record; rename and duplicate (`<name> Copy`, sharing the steps array) save at
 *   once; share only debug-logs the template JSON.
 */
import { debugLog } from "../../core/logger.js";
import { generateUuid } from "../../core/uuid.js";
import { paletoolsDatabase } from "../../db/database.js";
import { translate } from "../../i18n/translations.js";
import { GlobalSbcTemplatesView } from "./global-templates-view.js";
import { loadSortedGlobalSbcTemplates, saveGlobalSbcTemplate } from "./storage.js";
import { GlobalSbcTemplateEditorViewController } from "./template-editor-view-controller.js";

export function GlobalSbcTemplatesViewController() {
  EAViewController.call(this);
  this._templates = null;
}

JSUtils.inherits(GlobalSbcTemplatesViewController, EAViewController);

GlobalSbcTemplatesViewController.prototype._getViewInstanceFromData = function () {
  return new GlobalSbcTemplatesView();
};

GlobalSbcTemplatesViewController.prototype.init = function () {
  if (!this.initialized) {
    this.initialized = true;
    this.getView().onTemplateAddClicked.observe(this, (observable, templateName) => {
      if (!templateName || templateName.trim().length === 0) {
        return;
      }
      const editorController = new GlobalSbcTemplateEditorViewController({
        id: generateUuid(),
        name: templateName,
        steps: [],
      });
      editorController.init();
      this.getNavigationController().pushViewController(editorController);
    });
    this.getView().onTemplateEditClicked.observe(this, (observable, template) => {
      const editorController = new GlobalSbcTemplateEditorViewController(template);
      editorController.init();
      this.getNavigationController().pushViewController(editorController);
    });
    this.getView().onTemplateRemoveClicked.observe(this, async (observable, template) => {
      await paletoolsDatabase.globalSbcTemplates.delete(template.id);
      this._templates = this._templates.filter(
        (existingTemplate) => existingTemplate.id !== template.id,
      );
      this.getView().update(this._templates);
    });
    this.getView().onTemplateRenamed.observe(this, async (observable, template) => {
      await saveGlobalSbcTemplate(template.id, template.name, template.steps);
    });
    this.getView().onTemplateDuplicateClicked.observe(this, async (observable, template) => {
      const templateCopy = {
        id: generateUuid(),
        name: template.name + " Copy",
        steps: template.steps,
      };
      this._templates.push(templateCopy);
      this.getView().update(this._templates);
      await saveGlobalSbcTemplate(templateCopy.id, templateCopy.name, templateCopy.steps);
    });
    this.getView().onTemplateShareClicked.observe(this, async (observable, template) => {
      debugLog(JSON.stringify(template));
    });
  }
};

GlobalSbcTemplatesViewController.prototype.viewDidAppear = function () {
  this.getNavigationController().setNavigationVisibility(true, true);
  loadSortedGlobalSbcTemplates().then((templates) => {
    this._templates = templates;
    this.getView().update(this._templates);
  });
};

GlobalSbcTemplatesViewController.prototype.getNavigationTitle = function () {
  return translate("plugins.sbcTemplateBuilder.settings.title");
};
