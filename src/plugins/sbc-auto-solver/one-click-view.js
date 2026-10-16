/**
 * Old-style views and controllers of the one-click solutions screen: `OneClickSbcSolutionsView`
 * (select/refresh per solution), `OneClickSbcActionsView` (submit/back),
 * `OneClickSbcPaneViewController` and `OneClickSbcSplitViewController(plan, workArea)`, which
 * dialog.js pushes; also `showOneClickSbcError`.
 *
 * Invariants:
 * - Each `JSUtils.inherits(Ctor, Base)` (EAView, EAViewController, UTSplitViewController) runs at
 *   module evaluation and must precede that constructor's `prototype.*` assignments; constructors
 *   set their fields before the base call, and overrides chain to the base (`EAView` dealloc,
 *   `UTSplitViewController` init/viewDidAppear/viewWillDisappear/dealloc).
 * - `isActive` for long operations is `this._active` (false after `viewWillDisappear`);
 *   `_submitting` and `plan.busy` prevent concurrent submit and refresh.
 * - Submit revalidates the challenge and candidates (same ids and `sbsScore`, not locked, within
 *   the submit limit, score >= target), sets `plan.invalidated = true` before
 *   `services.SBC.submitOneClickChallenge` so a solution is never sent twice, marks
 *   `ItemPile.PURCHASED` dirty, then patches the EA work area view model (`clearSelection`,
 *   `resetCache`, `_set`, `_challenge`, `_itemEntityMap`/`_itemScoreMap`/`_itemTabMap`,
 *   requirements controller) unless `workArea._sbcAutoSolverDisposed` (set by index.js).
 * - Refresh replaces one solution by the best alternative of equal score, size and rating
 *   multiset that is not made only of the current players; `staleSolution`/`noChallenges`
 *   invalidate the plan. Unknown error codes are shown as `loadFailed`.
 */
import { isItemLocked } from "../../club/locked-items.js";
import { addClasses, appendElements, createElement } from "../../core/dom.js";
import { formatNumber, translate } from "../../i18n/translations.js";
import {
  assertSbcAutoSolverActive,
  findOneClickSbcScoreSolutions,
  getOneClickSbcSubmitLimit,
  isSbcAutoSolverEnabled,
  loadOneClickSbcCandidatePlayers,
  revalidateOneClickSbcChallenge,
  throwOneClickSbcError,
} from "./one-click-solver.js";
import { showErrorNotification, showSuccessNotification } from "../../ui/notifications.js";
import { hideLoadingShield, showLoadingShield } from "../../webapp/loading-shield.js";
import { observableToPromise } from "../../webapp/observable.js";

function OneClickSbcSolutionsView(plan) {
  this.plan = plan;
  this._sections = [];
  this._refreshButtons = [];
  this.onSelectionChanged = new EAObservable();
  this.onRefreshClicked = new EAObservable();
  EAView.call(this);
}

function createOneClickSbcTextElement(tagName, className, textContent) {
  const element = createElement(tagName, {
    className: className,
  });
  element.textContent = textContent;
  return element;
}

function OneClickSbcActionsView(plan) {
  this.plan = plan;
  this.onCancelClicked = new EAObservable();
  this.onConfirmClicked = new EAObservable();
  EAView.call(this);
}

function OneClickSbcPaneViewController(paneView) {
  this.paneView = paneView;
  EAViewController.call(this);
}

export function OneClickSbcSplitViewController(plan, workArea) {
  this.plan = plan;
  this.workArea = workArea;
  this._active = true;
  UTSplitViewController.call(this);
}

export function showOneClickSbcError(error) {
  showErrorNotification(
    translate(
      "plugins.sbcAutoSolver.oneClick.errors." +
        ([
          "cancelled",
          "invalidScore",
          "searchLimit",
          "loadFailed",
          "noChallenges",
          "noSolutions",
          "staleSolution",
          "submitFailed",
          "noAlternatives",
        ].includes(error?.code)
          ? error.code
          : "loadFailed"),
    ),
  );
}

JSUtils.inherits(OneClickSbcSolutionsView, EAView);

OneClickSbcSolutionsView.prototype._renderSolutions = function () {
  this._refreshButtons.forEach((button) => button.destroy());
  this._refreshButtons = [];
  this._sections.forEach((section) => section.dealloc());
  this._sections = [];
  this._solutions.innerHTML = "";
  this.plan.solutions.forEach((solution, selectedIndex) => {
    const isSelected = this.plan.selectedIndex === selectedIndex;
    const solutionContainer = createElement("div", {
      className: "sbc-one-click-solution" + (isSelected ? " selected" : ""),
    });
    const solutionTitle = translate("plugins.sbcAutoSolver.oneClick.solution").replace(
      "{number}",
      formatNumber(selectedIndex + 1),
    );
    const solutionDetails = translate("plugins.sbcAutoSolver.oneClick.details")
      .replace("{players}", formatNumber(solution.players.length))
      .replace("{score}", formatNumber(solution.score))
      .replace("{target}", formatNumber(this.plan.target))
      .replace("{excess}", formatNumber(solution.excess));
    const sectionView = new UTSectionedItemListView();
    sectionView.init();
    sectionView.setActionHeader(
      "" +
        solutionTitle +
        (selectedIndex === 0 ? " · " + translate("plugins.sbcAutoSolver.oneClick.best") : ""),
      translate("plugins.sbcAutoSolver.oneClick." + (isSelected ? "selected" : "select")),
      () => {
        if (!(this._busy || this.plan.invalidated)) {
          this.plan.selectedIndex = selectedIndex;
          this._renderSolutions();
          this.onSelectionChanged.notify();
        }
      },
    );
    sectionView.addItems(solution.players);
    sectionView.render();
    const refreshButton = new UTStandardButtonControl();
    refreshButton.init();
    refreshButton.setText("↻");
    const refreshLabel = translate("plugins.sbcAutoSolver.oneClick.refresh");
    refreshButton.getRootElement().setAttribute("aria-label", refreshLabel);
    refreshButton.getRootElement().setAttribute("title", refreshLabel);
    addClasses(refreshButton, "mini", "sbc-one-click-refresh");
    addClasses(sectionView._header, "sbc-one-click-solution-header");
    refreshButton.addTarget(
      this,
      () => {
        if (!(this._busy || this.plan.invalidated)) {
          this.onRefreshClicked.notify(selectedIndex);
        }
      },
      EventType.TAP,
    );
    appendElements(sectionView._header, refreshButton);
    refreshButton.setInteractionState(!this._busy && !this.plan.invalidated);
    this._refreshButtons.push(refreshButton);
    this._sections.push(sectionView);
    appendElements(
      solutionContainer,
      createOneClickSbcTextElement("p", "sbc-auto-solver-summary-row", solutionDetails),
      sectionView,
    );
    appendElements(this._solutions, solutionContainer);
  });
};

OneClickSbcSolutionsView.prototype.setBusy = function (busy) {
  this._busy = busy;
  this._refreshButtons.forEach((button) =>
    button.setInteractionState(!busy && !this.plan.invalidated),
  );
};

OneClickSbcSolutionsView.prototype._generate = function () {
  if (this._generated) {
    return;
  }
  const root = createElement("div", {
    className: "sbc-one-click-content",
  });
  const summaryText = translate("plugins.sbcAutoSolver.oneClick.summary")
    .replace("{submitted}", formatNumber(this.plan.submittedScore))
    .replace("{required}", formatNumber(this.plan.scoreRequirement))
    .replace("{remaining}", formatNumber(this.plan.target));
  appendElements(
    root,
    createOneClickSbcTextElement("h2", "ut-list-header", this.plan.challenge.name),
    createOneClickSbcTextElement("p", "sbc-auto-solver-summary-row", summaryText),
    createOneClickSbcTextElement(
      "p",
      "sbc-auto-solver-summary-note",
      translate(
        "plugins.sbcAutoSolver.oneClick." +
          (this.plan.solutions[0].excess === 0 ? "exactNote" : "excessNote"),
      ),
    ),
  );
  this._solutions = createElement("div");
  appendElements(root, this._solutions);
  this.__root = root;
  this._generated = true;
  this._renderSolutions();
};

OneClickSbcSolutionsView.prototype.dealloc = function () {
  this._sections.forEach((section) => section.dealloc());
  this._sections = [];
  this._refreshButtons.forEach((button) => button.destroy());
  this._refreshButtons = [];
  this.onSelectionChanged.dealloc();
  this.onRefreshClicked.dealloc();
  EAView.prototype.dealloc.call(this);
};

JSUtils.inherits(OneClickSbcActionsView, EAView);

OneClickSbcActionsView.prototype.setBusy = function (busy) {
  this._busy = busy;
  this.updateSelection();
  this._cancelButton.setInteractionState(!busy);
};

OneClickSbcActionsView.prototype.updateSelection = function () {
  this._confirmButton.setInteractionState(
    !this._busy && !this.plan.invalidated && Number.isInteger(this.plan.selectedIndex),
  );
};

OneClickSbcActionsView.prototype._generate = function () {
  if (this._generated) {
    return;
  }
  const root = createElement("div", {
    className: "sbc-one-click-actions",
  });
  const buttonContainer = createElement("div", {
    className: "sbc-button-container sbc-auto-solver-button-container",
  });
  this._confirmButton = new UTStandardButtonControl();
  this._confirmButton.init();
  this._confirmButton.setText(translate("plugins.sbcAutoSolver.oneClick.submit"));
  addClasses(this._confirmButton, "primary");
  this._confirmButton.addTarget(this, () => this.onConfirmClicked.notify(), EventType.TAP);
  this._cancelButton = new UTStandardButtonControl();
  this._cancelButton.init();
  this._cancelButton.setText(translate("infopanel.button.back"));
  this._cancelButton.addTarget(this, () => this.onCancelClicked.notify(), EventType.TAP);
  appendElements(buttonContainer, this._confirmButton, this._cancelButton);
  appendElements(root, buttonContainer);
  this.__root = root;
  this._generated = true;
  this.updateSelection();
};

OneClickSbcActionsView.prototype.dealloc = function () {
  this._confirmButton?.destroy();
  this._cancelButton?.destroy();
  this.onCancelClicked.dealloc();
  this.onConfirmClicked.dealloc();
  EAView.prototype.dealloc.call(this);
};

JSUtils.inherits(OneClickSbcPaneViewController, EAViewController);

OneClickSbcPaneViewController.prototype._getViewInstanceFromData = function () {
  return this.paneView;
};

JSUtils.inherits(OneClickSbcSplitViewController, UTSplitViewController);

OneClickSbcSplitViewController.prototype.init = function () {
  if (!this.initialized) {
    this.resultsController = new OneClickSbcPaneViewController(
      new OneClickSbcSolutionsView(this.plan),
    );
    this.actionsController = new OneClickSbcPaneViewController(
      new OneClickSbcActionsView(this.plan),
    );
    this.resultsController.init();
    this.actionsController.init();
    this.addChildViewController(this.resultsController);
    this.addChildViewController(this.actionsController);
    this.actionsController.getView().onCancelClicked.observe(this, this._cancel);
    this.actionsController.getView().onConfirmClicked.observe(this, this._confirm);
    this.resultsController.getView().onRefreshClicked.observe(this, this._refresh);
    this.resultsController.getView().onSelectionChanged.observe(this, this._selectionChanged);
    UTSplitViewController.prototype.init.call(this);
    this.setLayout(UTSplitViewController.Layout.SIDEBAR_RIGHT);
    addClasses(this.getView(), "sbc-auto-solver-preview", "sbc-one-click-preview");
    if (isPhone()) {
      addClasses(this.getView(), "sbc-one-click-mobile");
    }
  }
};

OneClickSbcSplitViewController.prototype.viewDidAppear = function () {
  this._active = true;
  UTSplitViewController.prototype.viewDidAppear.call(this);
  this.setLeftController(this.resultsController);
  this.setRightController(this.actionsController);
  this.getNavigationController().setNavigationVisibility(true, true);
};

OneClickSbcSplitViewController.prototype.viewWillDisappear = function () {
  this._active = false;
  UTSplitViewController.prototype.viewWillDisappear.call(this);
};

OneClickSbcSplitViewController.prototype.dealloc = function () {
  this._active = false;
  this._disposed = true;
  this.actionsController.getView().onCancelClicked.unobserve(this);
  this.actionsController.getView().onConfirmClicked.unobserve(this);
  this.resultsController.getView().onRefreshClicked.unobserve(this);
  this.resultsController.getView().onSelectionChanged.unobserve(this);
  this.resultsController.dealloc();
  this.actionsController.dealloc();
  this.resultsController = null;
  this.actionsController = null;
  this.leftController = null;
  this.rightController = null;
  UTSplitViewController.prototype.dealloc.call(this);
};

OneClickSbcSplitViewController.prototype._selectionChanged = function () {
  this.actionsController.getView().updateSelection();
};

OneClickSbcSplitViewController.prototype._setBusy = function (busy) {
  this.resultsController.getView().setBusy(busy);
  this.actionsController.getView().setBusy(busy);
};

OneClickSbcSplitViewController.prototype.getNavigationTitle = function () {
  return translate("plugins.sbcAutoSolver.oneClick.title");
};

OneClickSbcSplitViewController.prototype._cancel = function () {
  if (!this._submitting) {
    this.getNavigationController().popViewController();
  }
};

OneClickSbcSplitViewController.prototype._confirm = async function () {
  if (
    !this._submitting &&
    this._active &&
    isSbcAutoSolverEnabled() &&
    Number.isInteger(this.plan.selectedIndex) &&
    !this.plan.invalidated
  ) {
    this._submitting = true;
    this._setBusy(true);
    showLoadingShield();
    try {
      const submission = await (async function (plan, solutionIndex, isActive = () => true) {
        if (plan.busy || plan.invalidated) {
          throwOneClickSbcError("staleSolution");
        }
        plan.busy = true;
        try {
          const validatedSolution = await (async function (plan, solutionIndex, isActive) {
            assertSbcAutoSolverActive(isActive);
            const solution = plan.solutions[solutionIndex];
            if (!(!plan.invalidated && Number.isInteger(solutionIndex) && solution)) {
              throwOneClickSbcError("staleSolution");
            }
            const { set: sbcSet, challenge: challenge } = await revalidateOneClickSbcChallenge(
              plan,
              isActive,
            );
            const candidatesById = new Map(
              (await loadOneClickSbcCandidatePlayers(challenge, plan.options, isActive)).map(
                (candidate) => [String(candidate.id), candidate],
              ),
            );
            const playerIds = solution.players.map((player) => Number(player.id));
            if (
              !playerIds.length ||
              playerIds.length > getOneClickSbcSubmitLimit() ||
              new Set(playerIds).size !== playerIds.length
            ) {
              throwOneClickSbcError("staleSolution");
            }
            let totalScore = 0;
            for (const player of solution.players) {
              const candidate = candidatesById.get(String(player.id));
              if (
                !(candidate && candidate.sbsScore === player.sbsScore && !isItemLocked(candidate))
              ) {
                throwOneClickSbcError("staleSolution");
              }
              totalScore += candidate.sbsScore;
            }
            if (totalScore !== solution.score || totalScore < plan.target) {
              throwOneClickSbcError("staleSolution");
            }
            assertSbcAutoSolverActive(isActive);
            if (
              plan.invalidated ||
              challenge.scoreRequirement !== plan.scoreRequirement ||
              (challenge.submittedScore ?? 0) !== plan.submittedScore
            ) {
              throwOneClickSbcError("staleSolution");
            }
            return {
              set: sbcSet,
              challenge: challenge,
              players: playerIds.map((playerId) => candidatesById.get(String(playerId))),
            };
          })(plan, solutionIndex, isActive);
          let submitResponse;
          assertSbcAutoSolverActive(isActive);
          plan.invalidated = true;
          try {
            submitResponse = await observableToPromise(
              services.SBC.submitOneClickChallenge(
                validatedSolution.challenge,
                validatedSolution.set,
                validatedSolution.players.map((player) => Number(player.id)),
              ),
            );
          } catch {
            throwOneClickSbcError("submitFailed");
          }
          if (!submitResponse.success) {
            throwOneClickSbcError("submitFailed");
          }
          repositories.Item.setDirty(ItemPile.PURCHASED);
          return {
            ...validatedSolution,
            response: submitResponse,
          };
        } finally {
          plan.busy = false;
        }
      })(this.plan, this.plan.selectedIndex, () => this._active);
      (function (workArea, submission) {
        if (!workArea || workArea._sbcAutoSolverDisposed) {
          return;
        }
        const viewModel = workArea.getViewModel();
        if (!viewModel) {
          return;
        }
        viewModel.clearSelection();
        viewModel.resetCache();
        viewModel._set = submission.set;
        viewModel._challenge = submission.challenge;
        viewModel._itemEntityMap.clear();
        viewModel._itemScoreMap.clear();
        viewModel._itemTabMap.clear();
        const requirementsController = workArea.workAreaDelegate?.requirementsController;
        if (requirementsController?.viewModel) {
          requirementsController.viewModel._set = submission.set;
          requirementsController.viewModel._challenge = submission.challenge;
          requirementsController.hasRendered = false;
          requirementsController.setReviewEnabled(false);
        }
      })(this.workArea, submission);
      showSuccessNotification(translate("plugins.sbcAutoSolver.notifications.submitted"));
      if (this._active) {
        this.getNavigationController().popViewController();
      }
    } catch (error) {
      this.plan.invalidated = true;
      if (!this._disposed) {
        showOneClickSbcError(error);
      }
    } finally {
      hideLoadingShield();
      this._submitting = false;
      if (!this._disposed) {
        this._setBusy(false);
      }
    }
  }
};

OneClickSbcSplitViewController.prototype._refresh = async function (observable, solutionIndex) {
  if (
    !this._submitting &&
    this._active &&
    isSbcAutoSolverEnabled() &&
    !this.plan.invalidated &&
    Number.isInteger(solutionIndex) &&
    this.plan.solutions[solutionIndex]
  ) {
    this._submitting = true;
    this._setBusy(true);
    showLoadingShield();
    try {
      await (async function (plan, solutionIndex, isActive = () => true) {
        assertSbcAutoSolverActive(isActive);
        if (
          !(
            !plan.busy &&
            !plan.invalidated &&
            Number.isInteger(solutionIndex) &&
            plan.solutions[solutionIndex]
          )
        ) {
          throwOneClickSbcError("staleSolution");
        }
        plan.busy = true;
        try {
          const solution = plan.solutions[solutionIndex];
          const { challenge: challenge } = await revalidateOneClickSbcChallenge(plan, isActive);
          const candidates = await loadOneClickSbcCandidatePlayers(
            challenge,
            plan.options,
            isActive,
          );
          if (solution.players.length > getOneClickSbcSubmitLimit()) {
            throwOneClickSbcError("staleSolution");
          }
          const currentPlayerIds = new Set(solution.players.map((player) => String(player.id)));
          const ratingCounts = new Map();
          solution.players.forEach((player) =>
            ratingCounts.set(player.rating, (ratingCounts.get(player.rating) || 0) + 1),
          );
          candidates.sort(
            (left, right) =>
              Number(currentPlayerIds.has(String(left.id))) -
              Number(currentPlayerIds.has(String(right.id))),
          );
          const reusePenalty = candidates.length * solution.players.length + 1;
          const alternatives = await findOneClickSbcScoreSolutions(
            candidates,
            solution.score,
            solution.players.length,
            () => isSbcAutoSolverEnabled() && isActive(),
            {
              ratingCounts: ratingCounts,
              itemPenalty: (candidate) =>
                currentPlayerIds.has(String(candidate.id)) ? reusePenalty : 0,
            },
          );
          assertSbcAutoSolverActive(isActive);
          if (
            plan.invalidated ||
            challenge.scoreRequirement !== plan.scoreRequirement ||
            (challenge.submittedScore ?? 0) !== plan.submittedScore
          ) {
            throwOneClickSbcError("staleSolution");
          }
          const bestAlternative = alternatives[0];
          if (
            !(
              bestAlternative &&
              !bestAlternative.players.every((player) => currentPlayerIds.has(String(player.id)))
            )
          ) {
            throwOneClickSbcError("noAlternatives");
          }
          plan.solutions[solutionIndex] = {
            ...bestAlternative,
            excess: bestAlternative.score - plan.target,
          };
          return plan.solutions[solutionIndex];
        } finally {
          plan.busy = false;
        }
      })(this.plan, solutionIndex, () => this._active);
      if (!this._disposed) {
        this.resultsController.getView()._renderSolutions();
      }
    } catch (error) {
      if (!(error?.code !== "staleSolution" && error?.code !== "noChallenges")) {
        this.plan.invalidated = true;
      }
      if (!this._disposed) {
        showOneClickSbcError(error);
      }
    } finally {
      hideLoadingShield();
      this._submitting = false;
      if (!this._disposed) {
        this._setBusy(false);
      }
    }
  }
};
