/**
 * Old-style EA view and controller previewing a repetition auto-solve plan: one removable section
 * per solved group (challenge/repetition) and a summary; confirm submits the remaining groups in
 * order. `SbcAutoSolverPreviewViewController(plan, squad)` is created and pushed by dialog.js.
 *
 * Invariants:
 * - `JSUtils.inherits(SbcAutoSolverPreviewView, EAView)` and
 *   `JSUtils.inherits(SbcAutoSolverPreviewViewController, EAViewController)` run at module
 *   evaluation and must precede the respective `prototype.*` assignments; the constructors set
 *   their fields before calling the base constructor.
 * - Confirm, per group: `services.SBC.loadChallenge`, refuse locked non-storage players,
 *   `fillSbcSquadByPosition`, `services.SBC.submitChallenge(challenge, set, true,
 *   chemistryEnabled)`, PIN page view "SBC - Rewards Overlay", remove the group from
 *   `plan.groups`/`plan.players` and re-render, then wait `submitDelay` s +/- 250 ms. It stops at
 *   the first failure; `submitting` blocks re-entry.
 * - Headers show challenge titles for multi-challenge or non-repeatable plans, repetition numbers
 *   otherwise; the group rating is computed locally (float variant when the server feature
 *   `SQUAD_RATING_FLOAT_CALCULATION_ENABLED` is on), capped at 99, two decimals.
 * - Stylesheet `paletools-sbc-auto-solver`; the note row is
 *   `plugins.sbcAutoSolver.preview.<warningCode>`.
 *
 * Known issues (kept as-is):
 * - The target-rating row and the `stoppedOnConceptPlayers` fallback read `plan.targetRating` and
 *   `plan.stoppedOnConceptPlayers`, which no plan builder sets (only groups carry
 *   `targetRating`).
 */
import { isItemLocked } from "../../club/locked-items.js";
import { waitForDelay } from "../../core/async.js";
import { addClasses, appendElements, createElement } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { normalizeSbcRepetitionSubmitDelay } from "./repetition-solver.js";
import { fillSbcSquadByPosition } from "../../sbc/squad-fill.js";
import { createStaticNotification, showErrorNotification } from "../../ui/notifications.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { isSbcStorageItem } from "../../webapp/item-piles.js";
import { hideLoadingShield, showLoadingShield } from "../../webapp/loading-shield.js";
import { navigateBack } from "../../webapp/navigation.js";
import { observableToPromise } from "../../webapp/observable.js";
import sbcAutoSolverStyles from "./sbc-auto-solver.css";

function SbcAutoSolverPreviewView(plan, squad) {
  this.plan = plan;
  this.squad = squad;
  this._sectionViews = [];
  this.onCancelClicked = new EAObservable();
  this.onConfirmClicked = new EAObservable();
  EAView.call(this);
}

export function SbcAutoSolverPreviewViewController(plan, squad) {
  this.plan = plan;
  this.squad = squad;
  EAViewController.call(this);
}

JSUtils.inherits(SbcAutoSolverPreviewView, EAView);

SbcAutoSolverPreviewView.prototype.dealloc = function () {
  this.onCancelClicked.dealloc();
  this.onCancelClicked = null;
  this.onConfirmClicked.dealloc();
  this.onConfirmClicked = null;
  for (const sectionView of this._sectionViews) {
    sectionView.dealloc();
  }
  this._sectionViews = [];
};

SbcAutoSolverPreviewView.prototype._updateSummary = function () {
  this.plan.repetitions = this._getRepetitions().length;
  this.plan.players = this.plan.groups.reduce(
    (players, group) => players.concat(group.players),
    [],
  );
  if (this._repetitionsCounter) {
    const requestedRepetitions = this.plan.requestedRepetitions;
    const repetitionsText =
      requestedRepetitions && requestedRepetitions !== this.plan.repetitions
        ? this.plan.repetitions + " / " + requestedRepetitions
        : this.plan.repetitions;
    this._repetitionsCounter.innerHTML =
      translate("plugins.sbcAutoSolver.preview.repetitions") + ": " + repetitionsText;
  }
  if (this._challengesCounter) {
    const solvedChallengeCount = new Set(this.plan.groups.map((group) => group.challengeId)).size;
    this._challengesCounter.innerHTML =
      translate("plugins.sbcAutoSolver.preview.challenges") +
      ": " +
      solvedChallengeCount +
      " / " +
      this.plan.challengeCount;
  }
  if (this._playersCounter) {
    this._playersCounter.innerHTML =
      translate("plugins.sbcAutoSolver.preview.players") + ": " + this.plan.players.length;
  }
};

SbcAutoSolverPreviewView.prototype._removeGroup = function (group) {
  if (this.plan.groups.includes(group)) {
    this.plan.groups = this.plan.groups.filter((existingGroup) => existingGroup !== group);
    this._renderSections();
    this._updateSummary();
  }
};

SbcAutoSolverPreviewView.prototype.removeSubmittedGroup = function () {
  this._renderSections();
  this._updateSummary();
};

SbcAutoSolverPreviewView.prototype._getSectionHeaderText = function (group) {
  return this._isMultiChallengePlan() || this._isNonRepeatablePlan()
    ? group.challengeTitle + " (" + this._getGroupRating(group) + ")"
    : translate("plugins.sbcAutoSolver.preview.repetition") +
        " " +
        group.repetition +
        " (" +
        this._getGroupRating(group) +
        ")";
};

SbcAutoSolverPreviewView.prototype._getRepetitions = function () {
  return Array.from(new Set(this.plan.groups.map((group) => group.repetition))).sort(
    (left, right) => left - right,
  );
};

SbcAutoSolverPreviewView.prototype._isMultiChallengePlan = function () {
  return this.plan.challengeCount > 1;
};

SbcAutoSolverPreviewView.prototype._isNonRepeatablePlan = function () {
  return this.plan.isNonRepeatable === true;
};

SbcAutoSolverPreviewView.prototype._createSection = function (group) {
  const sectionView = new UTSectionedItemListView();
  sectionView.displayTotalPrices = true;
  sectionView.init();
  sectionView.setActionHeader(this._getSectionHeaderText(group), translate("remove"), () =>
    this._removeGroup(group),
  );
  sectionView.addItems(group.players);
  sectionView.render();
  this._sectionViews.push(sectionView);
  return sectionView;
};

SbcAutoSolverPreviewView.prototype._renderSections = function () {
  if (this._pinnedList) {
    for (const sectionView of this._sectionViews) {
      sectionView.dealloc();
    }
    this._sectionViews = [];
    this._pinnedList.innerHTML = "";
    if (this._isMultiChallengePlan() && !this._isNonRepeatablePlan()) {
      for (const repetition of this._getRepetitions()) {
        const repetitionContainer = createElement("div", {
          className: "sbc-auto-solver-group",
        });
        appendElements(
          repetitionContainer,
          createElement(
            "div",
            {
              className: "ut-list-header sbc-auto-solver-group-header",
            },
            translate("plugins.sbcAutoSolver.preview.repetition") + " " + repetition,
          ),
        );
        for (const group of this.plan.groups.filter((group) => group.repetition === repetition)) {
          appendElements(repetitionContainer, this._createSection(group));
        }
        appendElements(this._pinnedList, repetitionContainer);
      }
    } else {
      for (const group of this.plan.groups) {
        appendElements(this._pinnedList, this._createSection(group));
      }
    }
  }
};

SbcAutoSolverPreviewView.prototype._getGroupRating = function (group) {
  return group?.players?.length
    ? (function (players) {
        if (!players?.length) {
          return 0;
        }
        const validPlayers = players.filter(
          (player) => !!player && (typeof player.isValid !== "function" || player.isValid()),
        );
        if (!validPlayers.length) {
          return 0;
        }
        const isFloatRatingEnabled = services.Configuration.checkFeatureEnabled(
          UTServerSettingsRepository.KEY.SQUAD_RATING_FLOAT_CALCULATION_ENABLED,
        );
        const playerCount = validPlayers.length;
        let ratingTotal = 0;
        let adjustedRatingTotal = 0;
        validPlayers.forEach((player) => {
          ratingTotal += player.rating;
        });
        if (isFloatRatingEnabled) {
          let averageRating = ratingTotal;
          adjustedRatingTotal = ratingTotal;
          if (playerCount > 0) {
            averageRating /= playerCount;
          }
          averageRating = Math.min(averageRating, 99);
          validPlayers.forEach((player) => {
            if (!(player.rating <= averageRating)) {
              adjustedRatingTotal += player.rating - averageRating;
            }
          });
          ratingTotal = Math.round(adjustedRatingTotal);
        } else {
          const flooredAverageRating = Math.min(Math.floor(ratingTotal / playerCount), 99);
          validPlayers.forEach((player) => {
            if (!(player.rating <= flooredAverageRating)) {
              ratingTotal += player.rating - flooredAverageRating;
            }
          });
        }
        const rating = Math.min(Math.max(ratingTotal / playerCount, 0), 99);
        return Math.round(100 * (rating + Number.EPSILON)) / 100;
      })(group.players)
    : 0;
};

SbcAutoSolverPreviewView.prototype._generate = function () {
  upsertStylesheet("paletools-sbc-auto-solver", sbcAutoSolverStyles);
  const root = createElement("div", {
    className: isPhone()
      ? "ut-content-container ut-pinned-list-container sbc-auto-solver-preview"
      : "ut-split-view sidebar-right sbc-auto-solver-preview",
  });
  const listContainer = createElement("div", {
    className: "ut-content-container ut-pinned-list-container",
  });
  const content = createElement("div", {
    className: "ut-content",
  });
  const pinnedList = createElement("div", {
    className: "ut-pinned-list",
  });
  appendElements(content, pinnedList);
  appendElements(listContainer, content);
  appendElements(root, listContainer);
  const summary = createElement("div", {
    className: "sbc-auto-solver-summary",
  });
  const summaryHeader = createElement(
    "div",
    {
      className: "ut-list-header",
    },
    translate("plugins.sbcAutoSolver.preview.title"),
  );
  const repetitionsCounter =
    this._isMultiChallengePlan() || this._isNonRepeatablePlan()
      ? null
      : createElement("div", {
          className: "sbc-auto-solver-summary-row",
        });
  const challengesCounter = this._isMultiChallengePlan()
    ? createElement("div", {
        className: "sbc-auto-solver-summary-row",
      })
    : null;
  const playersCounter = createElement("div", {
    className: "sbc-auto-solver-summary-row",
  });
  const targetRatingRow = this.plan.targetRating
    ? createElement(
        "div",
        {
          className: "sbc-auto-solver-summary-row",
        },
        translate("plugins.sbcAutoSolver.preview.targetRating") + ": " + this.plan.targetRating,
      )
    : null;
  const noteKey =
    this.plan.warningCode || (this.plan.stoppedOnConceptPlayers ? "stoppedOnConceptPlayers" : null);
  const noteRow = noteKey
    ? createElement(
        "div",
        {
          className: "sbc-auto-solver-summary-note",
        },
        translate("plugins.sbcAutoSolver.preview." + noteKey),
      )
    : null;
  const buttonContainer = createElement("div", {
    className: "sbc-button-container sbc-auto-solver-button-container",
  });
  const backButton = new UTStandardButtonControl();
  const submitButton = new UTStandardButtonControl();
  backButton.init();
  backButton.setText(translate("infopanel.button.back"));
  backButton.addTarget(this, () => this.onCancelClicked.notify(), EventType.TAP);
  submitButton.init();
  submitButton.setText(translate("sbc.squad.button.submit"));
  addClasses(submitButton, "primary");
  submitButton.addTarget(this, () => this.onConfirmClicked.notify(), EventType.TAP);
  appendElements(summary, summaryHeader);
  if (repetitionsCounter) {
    appendElements(summary, repetitionsCounter);
  }
  if (challengesCounter) {
    appendElements(summary, challengesCounter);
  }
  appendElements(summary, playersCounter);
  if (targetRatingRow) {
    appendElements(summary, targetRatingRow);
  }
  if (noteRow) {
    appendElements(summary, noteRow);
  }
  appendElements(buttonContainer, submitButton, backButton);
  if (isPhone()) {
    appendElements(content, summary, buttonContainer);
  } else {
    const sidePanel = createElement("div", {
      className: "ut-navigation-container-view ui-layout-right",
    });
    const sidePanelContent = createElement("div", {
      className: "ut-content",
    });
    appendElements(sidePanelContent, summary, buttonContainer);
    appendElements(sidePanel, sidePanelContent);
    appendElements(root, sidePanel);
  }
  this.__root = root;
  this._pinnedList = pinnedList;
  this._repetitionsCounter = repetitionsCounter;
  this._challengesCounter = challengesCounter;
  this._playersCounter = playersCounter;
  this._renderSections();
  this._updateSummary();
  this._generated = true;
};

JSUtils.inherits(SbcAutoSolverPreviewViewController, EAViewController);

SbcAutoSolverPreviewViewController.prototype._getViewInstanceFromData = function () {
  return new SbcAutoSolverPreviewView(this.plan, this.squad);
};

SbcAutoSolverPreviewViewController.prototype.init = function () {
  if (!this.initialized) {
    this.getView().onCancelClicked.observe(this, this._cancel);
    this.getView().onConfirmClicked.observe(this, this._confirm);
    this.initialized = true;
  }
};

SbcAutoSolverPreviewViewController.prototype.dealloc = function () {
  const view = this.getView();
  if (view?.onCancelClicked) {
    view.onCancelClicked.unobserve(this);
  }
  if (view?.onConfirmClicked) {
    view.onConfirmClicked.unobserve(this);
  }
};

SbcAutoSolverPreviewViewController.prototype.viewDidAppear = function () {
  this.getNavigationController().setNavigationVisibility(true, true);
};

SbcAutoSolverPreviewViewController.prototype.getNavigationTitle = function () {
  return translate("plugins.sbcAutoSolver.preview.title");
};

SbcAutoSolverPreviewViewController.prototype._cancel = function () {
  navigateBack();
};

SbcAutoSolverPreviewViewController.prototype._confirm = function () {
  if (this.submitting) {
    return;
  }
  if (!this.plan.groups.length) {
    return void showErrorNotification(
      translate("plugins.sbcAutoSolver.errors.noRepetitionsSelected"),
    );
  }
  this.submitting = true;
  showLoadingShield();
  let progressNotification = createStaticNotification(UINotificationType.POSITIVE);
  (async function (plan, onGroupSubmitted) {
    if (!plan?.success || !plan?.set) {
      return {
        success: false,
        reason: "Invalid SBC auto solve plan",
      };
    }
    const submitDelay = normalizeSbcRepetitionSubmitDelay(plan.submitDelay);
    const groups = [...plan.groups];
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index];
      const challenge =
        typeof plan.set.getChallenge === "function"
          ? plan.set.getChallenge(group.challengeId)
          : null;
      if (!challenge) {
        return {
          success: false,
          reason: "Failed to find SBC challenge " + group.challengeTitle,
        };
      }
      if (
        !(await observableToPromise(services.SBC.loadChallenge(challenge))).success ||
        !challenge.squad
      ) {
        return {
          success: false,
          reason: "Failed to load SBC challenge " + group.challengeTitle,
        };
      }
      for (const player of group.players) {
        if (!isSbcStorageItem(player) && isItemLocked(player)) {
          return {
            success: false,
            reason:
              "Player " +
              player.name +
              " is locked and cannot be used in SBC challenge " +
              group.challengeTitle,
          };
        }
      }
      fillSbcSquadByPosition(challenge, group.players);
      if (
        !(
          await observableToPromise(
            services.SBC.submitChallenge(
              challenge,
              plan.set,
              true,
              services.Chemistry.isFeatureEnabled(),
            ),
          )
        ).success
      ) {
        return {
          success: false,
          reason: "Failed to submit SBC challenge " + group.challengeTitle,
        };
      }
      services.PIN.sendData(PINEventType.PAGE_VIEW, {
        type: PIN_PAGEVIEW_EVT_TYPE,
        pgid: "SBC - Rewards Overlay",
      });
      plan.groups = plan.groups.filter((remainingGroup) => remainingGroup !== group);
      plan.players = plan.players.filter((player) => !group.players.includes(player));
      group.players = [];
      onGroupSubmitted?.(index + 1, groups.length);
      if (index < groups.length - 1) {
        const delayMs = 1000 * submitDelay;
        await waitForDelay(delayMs - 250, delayMs + 250);
      }
    }
    return {
      success: true,
    };
  })(this.plan, (submittedCount, totalCount) => {
    this.getView().removeSubmittedGroup();
    progressNotification.message(
      translate("plugins.sbcAutoSolver.notifications.submitted") +
        " " +
        submittedCount +
        "/" +
        totalCount,
    );
  })
    .then((submitResult) => {
      if (submitResult.success) {
        navigateBack();
      } else {
        showErrorNotification(submitResult.reason);
      }
    })
    .catch((error) => {
      showErrorNotification(error?.message || "Failed to submit SBC");
    })
    .finally(() => {
      this.submitting = false;
      hideLoadingShield();
      progressNotification.dispose();
      progressNotification = null;
    });
};
