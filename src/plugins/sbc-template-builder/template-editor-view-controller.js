/**
 * Template editor controllers: `SbcTemplateEditorViewController(set, challenge,
 * globalTemplateId)` edits a challenge template (opened by the plugin's "edit template" action)
 * and `GlobalSbcTemplateEditorViewController(template)` edits a global template (opened from the
 * global templates list).
 *
 * Invariants:
 * - `JSUtils.inherits(SbcTemplateEditorViewController, EAViewController)` must precede its
 *   prototype assignments, and `JSUtils.inherits(GlobalSbcTemplateEditorViewController,
 *   SbcTemplateEditorViewController)` must precede the subclass's `init`/`getNavigationTitle`
 *   overrides (it inherits `_getViewInstanceFromData` and `viewDidAppear`).
 * - Constructors call the base constructor first, then set `_viewmodel` (read via
 *   `getViewModel`).
 * - The challenge editor's `init` loads the stored template and all global templates
 *   asynchronously, then calls `view.update`; save stores filters and exclusions, "use" stores
 *   the global template id; both pop the navigation controller.
 * - The global editor saves `id`, `name` and `filters` through `saveGlobalSbcTemplate`.
 *
 * Known issues (kept as-is):
 * - The global editor observes `onCancelClicked` with `this._onCancel`, which is not defined (the
 *   view never notifies that event).
 */
import { translate } from "../../i18n/translations.js";
import { GlobalSbcTemplate, SbcChallengeTemplate, SbcTemplateFilter } from "./models.js";
import {
  loadSbcChallengeTemplate,
  loadSortedGlobalSbcTemplates,
  saveGlobalSbcTemplate,
  saveSbcChallengeTemplate,
} from "./storage.js";
import { SbcTemplateEditorView } from "./template-editor-view.js";
import { getActiveNavigationController, getViewModel } from "../../webapp/navigation.js";

export function SbcTemplateEditorViewController(sbcSet, challenge, globalTemplateId) {
  EAViewController.call(this);
  this._viewmodel = new SbcChallengeTemplate(sbcSet, challenge, globalTemplateId);
}

export function GlobalSbcTemplateEditorViewController(template) {
  EAViewController.call(this);
  this._viewmodel = new GlobalSbcTemplate(template);
}

JSUtils.inherits(SbcTemplateEditorViewController, EAViewController);

SbcTemplateEditorViewController.prototype._getViewInstanceFromData = function () {
  return new SbcTemplateEditorView(this._viewmodel);
};

SbcTemplateEditorViewController.prototype.init = function () {
  if (!this.initialized) {
    this.initialized = true;
    this.getView().onSaveClicked.observe(this, async () => {
      await saveSbcChallengeTemplate(
        this._viewmodel.set,
        this._viewmodel.challenge,
        this._viewmodel.filters,
        this._viewmodel.exclusions,
      );
      getActiveNavigationController().popViewController();
    });
    this.getView().onFilterRemoved.observe(this, async () => {});
    this.getView().onGlobalTemplateUseClicked.observe(
      this,
      async (observable, globalTemplateId) => {
        await saveSbcChallengeTemplate(
          this._viewmodel.set,
          this._viewmodel.challenge,
          globalTemplateId,
        );
        getActiveNavigationController().popViewController();
      },
    );
    this.getView().onGlobalTemplateChanged.observe(this, (observable, selectedGlobalTemplate) => {
      this._selectedGlobalTemplate = selectedGlobalTemplate;
    });
    const viewModel = getViewModel(this);
    loadSbcChallengeTemplate(viewModel.set, viewModel.challenge).then((storedTemplate) => {
      if (storedTemplate) {
        if (storedTemplate.steps && storedTemplate.steps.length > 0) {
          for (let step of storedTemplate.steps) {
            viewModel.filters.push(new SbcTemplateFilter(step.searchCriteria, step.searchSettings));
          }
        }
        if (storedTemplate.exclusions && storedTemplate.exclusions.length > 0) {
          for (let exclusion of storedTemplate.exclusions) {
            viewModel.exclusions.push(new SbcTemplateFilter(exclusion.searchCriteria));
          }
        }
      }
      loadSortedGlobalSbcTemplates().then((globalTemplates) => {
        for (let globalTemplate of globalTemplates) {
          viewModel.globalTemplates.push(new GlobalSbcTemplate(globalTemplate));
        }
        this.getView().update(viewModel);
      });
    });
  }
};

SbcTemplateEditorViewController.prototype.viewDidAppear = function () {
  this.getNavigationController().setNavigationVisibility(true, true);
};

SbcTemplateEditorViewController.prototype.getNavigationTitle = function () {
  return (
    translate("plugins.sbcTemplateBuilder.settings.title") + " - " + this._viewmodel.challenge.name
  );
};

JSUtils.inherits(GlobalSbcTemplateEditorViewController, SbcTemplateEditorViewController);

GlobalSbcTemplateEditorViewController.prototype.init = function () {
  if (!this.initialized) {
    this.initialized = true;
    const view = this.getView();
    view.onSaveClicked.observe(this, async () => {
      await saveGlobalSbcTemplate(
        this._viewmodel.id,
        this._viewmodel.name,
        this._viewmodel.filters,
      );
      getActiveNavigationController().popViewController();
    });
    view.onCancelClicked.observe(this, this._onCancel);
  }
};

GlobalSbcTemplateEditorViewController.prototype.getNavigationTitle = function () {
  return translate("plugins.sbcTemplateBuilder.settings.title") + " - " + this._viewmodel.name;
};
