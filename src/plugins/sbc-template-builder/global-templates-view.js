/**
 * `GlobalSbcTemplatesView`: old-style EA view listing the global SBC templates (name input, edit,
 * remove and duplicate buttons) under an "add" row; driven by
 * global-templates-view-controller.js.
 *
 * Invariants:
 * - `JSUtils.inherits(GlobalSbcTemplatesView, EAView)` runs at module evaluation and must precede
 *   the `prototype.*` assignments; the observables are created before `EAView.call(this)`.
 * - Events: `onTemplateAddClicked(name)`, `onTemplateEditClicked`, `onTemplateRemoveClicked`,
 *   `onTemplateDuplicateClicked`, `onTemplateRenamed`, `onTemplateShareClicked` (template);
 *   `update(templates)` rebuilds the table.
 * - Stylesheet id `sbc-template-builder`, shared with the template editor view.
 *
 * Known issues (kept as-is):
 * - The "Share" button is created and wired but never appended to the row, so it never shows.
 */
import { addClasses, appendElements, createElement } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { GridLayout } from "../../ui/components/grid-layout.js";
import { LabelWithTextInputControl } from "../../ui/controls/label-with-text-input-control.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import sbcTemplateBuilderStyles from "./sbc-template-builder.css";

export function GlobalSbcTemplatesView() {
  this.onTemplateAddClicked = new EAObservable();
  this.onTemplateEditClicked = new EAObservable();
  this.onTemplateRemoveClicked = new EAObservable();
  this.onTemplateDuplicateClicked = new EAObservable();
  this.onTemplateRenamed = new EAObservable();
  this.onTemplateShareClicked = new EAObservable();
  EAView.call(this);
}

JSUtils.inherits(GlobalSbcTemplatesView, EAView);

GlobalSbcTemplatesView.prototype.dealloc = function () {
  this.onTemplateAddClicked.dealloc();
  this.onTemplateAddClicked = null;
  this.onTemplateEditClicked.dealloc();
  this.onTemplateEditClicked = null;
  this.onTemplateRemoveClicked.dealloc();
  this.onTemplateRemoveClicked = null;
  this.onTemplateDuplicateClicked.dealloc();
  this.onTemplateDuplicateClicked = null;
  this.onTemplateRenamed.dealloc();
  this.onTemplateRenamed = null;
  this.onTemplateShareClicked.dealloc();
  this.onTemplateShareClicked = null;
};

GlobalSbcTemplatesView.prototype._generate = function () {
  upsertStylesheet("sbc-template-builder", sbcTemplateBuilderStyles);
  const root = createElement("div", {
    className: "global-templates-list-view",
  });
  const addNewContainer = createElement("div", {
    className: "global-templates-add-new-container",
  });
  const templateNameInput = new LabelWithTextInputControl();
  templateNameInput.init();
  templateNameInput.setLabel("Template Name");
  const addButton = new UTStandardButtonControl();
  addButton.init();
  addButton.setText(translate("add"));
  addButton.addTarget(
    this,
    () => {
      this.onTemplateAddClicked.notify(templateNameInput.getInputValue());
      templateNameInput.setInputValue("");
    },
    EventType.TAP,
  );
  appendElements(addNewContainer, templateNameInput, addButton);
  this._templatesTable = new GridLayout(this._container, {
    className: "global-templates-table",
  });
  appendElements(root, addNewContainer, this._templatesTable);
  this.__root = root;
};

GlobalSbcTemplatesView.prototype.update = function (templates) {
  this._templatesTable.empty();
  for (let template of templates) {
    const row = this._templatesTable.addRow();
    const nameInput = new UTTextInputControl();
    nameInput.init();
    nameInput.setValue(template.name);
    appendElements(row.addColumn(), nameInput);
    nameInput.addTarget(
      this,
      () => {
        template.name = nameInput.getValue();
        this.onTemplateRenamed.notify(template);
      },
      EventType.CHANGE,
    );
    const editButton = new UTStandardButtonControl();
    editButton.init();
    editButton.setText(translate("edit"));
    addClasses(editButton, "mini");
    editButton.addTarget(
      this,
      () => {
        this.onTemplateEditClicked.notify(template);
      },
      EventType.TAP,
    );
    appendElements(row.addColumn(), editButton);
    const removeButton = new UTStandardButtonControl();
    removeButton.init();
    removeButton.setText(translate("remove"));
    addClasses(removeButton, "mini");
    removeButton.addTarget(
      this,
      () => {
        this.onTemplateRemoveClicked.notify(template);
      },
      EventType.TAP,
    );
    appendElements(row.addColumn(), removeButton);
    const duplicateButton = new UTStandardButtonControl();
    duplicateButton.init();
    duplicateButton.setText(translate("duplicate"));
    addClasses(duplicateButton, "mini");
    duplicateButton.addTarget(
      this,
      () => {
        this.onTemplateDuplicateClicked.notify(template);
      },
      EventType.TAP,
    );
    appendElements(row.addColumn(), duplicateButton);
    const shareButton = new UTStandardButtonControl();
    shareButton.init();
    shareButton.setText("Share");
    addClasses(shareButton, "mini");
    shareButton.addTarget(
      this,
      () => {
        this.onTemplateShareClicked.notify(template);
      },
      EventType.TAP,
    );
  }
};
