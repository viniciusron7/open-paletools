/**
 * Accessors for EA view-controller internals and navigation helpers. `getViewModel`,
 * `getLeftController`, `getRightController`, `getChildViewControllers` and
 * `getActiveController(controller)` accept both the underscored and the public property names EA
 * uses; without an argument `getActiveController()` walks `getAppMain()` root -> presented ->
 * current view controller -> current controller. Imported by src/webapp/patches.js,
 * src/market/search-results.js, src/bootstrap/boot.js and most plugins.
 *
 * Invariants:
 * - `findControllerProperty` checks the controller, then its left, right and current controllers,
 *   then (only with `searchChildren`) recurses into the children; falsy values count as not found
 *   and the result is null.
 * - `findControllerOfType` first tests the direct left/right/current/child controllers, then
 *   recurses into them in that order; it starts at the active controller when no root is given.
 * - `goBackToMarketSearchFilters` pops the top controller when it already is a
 *   `UTMarketSearchFiltersViewController`, then pops to a filters controller still in the stack,
 *   or pushes a new one initialized with `services.User.getUser().marketSearchCriteria`.
 * - `navigateBack(delayMs, onDone)` calls `_eBackButtonTapped()` on the active navigation
 *   controller inside `setTimeout(0)` (after `waitForDelay(delayMs)` when given); `onDone` runs
 *   right after scheduling, i.e. before the back tap.
 * - The player-snipe and bulk-buy tests inject fakes named `getViewModel` and
 *   `getActiveController`; renaming these exports requires updating the tests.
 */
import { waitForDelay } from "../core/async.js";

export function getViewModel(controller) {
  return controller._viewmodel || controller.viewmodel || controller.viewModel;
}

export function getActiveController(controller) {
  return controller
    ? controller._currentController || controller.currentController
    : getAppMain()
        .getRootViewController()
        .getPresentedViewController()
        .getCurrentViewController()
        .getCurrentController();
}

export function getActiveNavigationController() {
  return getActiveController().getNavigationController();
}

export function getLeftController(controller) {
  return controller._leftController || controller.leftController;
}

export function getRightController(controller) {
  return controller._rightController || controller.rightController;
}

export function getChildViewControllers(controller) {
  return controller._childViewControllers || controller.childViewControllers;
}

export function findControllerProperty(controller, propertyName, searchChildren) {
  if (controller[propertyName]) {
    return controller[propertyName];
  }
  const leftController = getLeftController(controller);
  if (leftController && leftController[propertyName]) {
    return leftController[propertyName];
  }
  const rightController = getRightController(controller);
  if (rightController && rightController[propertyName]) {
    return rightController[propertyName];
  }
  const currentController = getActiveController(controller);
  if (currentController && currentController[propertyName]) {
    return currentController[propertyName];
  }
  if (searchChildren) {
    const childControllers = getChildViewControllers(controller);
    if (childControllers && childControllers.length > 0) {
      for (const childController of childControllers) {
        let foundValue = findControllerProperty(childController, propertyName, searchChildren);
        if (foundValue) {
          return foundValue;
        }
      }
    }
  }
  return null;
}

export function findControllerOfType(controllerClass, rootController) {
  return (function searchControllerTree(controller, controllerClass) {
    if (controller instanceof controllerClass) {
      return controller;
    }
    const leftController = getLeftController(controller);
    const rightController = getRightController(controller);
    const currentController = getActiveController(controller);
    const childControllers = getChildViewControllers(controller);
    if (leftController instanceof controllerClass) {
      return leftController;
    }
    if (rightController instanceof controllerClass) {
      return rightController;
    }
    if (currentController instanceof controllerClass) {
      return currentController;
    }
    if (childControllers && childControllers.length > 0) {
      for (let childController of childControllers) {
        if (childController instanceof controllerClass) {
          return childController;
        }
      }
    }
    let foundController;
    if (
      leftController &&
      ((foundController = searchControllerTree(leftController, controllerClass)), foundController)
    ) {
      return foundController;
    }
    if (
      rightController &&
      ((foundController = searchControllerTree(rightController, controllerClass)), foundController)
    ) {
      return foundController;
    }
    if (
      currentController &&
      ((foundController = searchControllerTree(currentController, controllerClass)),
      foundController)
    ) {
      return foundController;
    }
    if (childControllers && childControllers.length > 0) {
      for (let childController of childControllers) {
        foundController = searchControllerTree(childController, controllerClass);
        if (foundController) {
          return foundController;
        }
      }
    }
    return null;
  })(rootController || getActiveController(), controllerClass);
}

export function goBackToMarketSearchFilters() {
  (function (controllerClass, unusedArgument2) {
    const navigationController = getActiveController().getNavigationController();
    if (!navigationController) {
      return;
    }
    if (navigationController.getCurrentController() instanceof controllerClass) {
      navigationController.popViewController();
    }
    const existingController = navigationController.childViewControllers.find(
      (controller) => controller instanceof controllerClass,
    );
    if (existingController) {
      navigationController.popToViewController(existingController);
    } else {
      navigationController.pushViewController(
        (() => {
          const filtersController = new UTMarketSearchFiltersViewController();
          filtersController.initWithSearchCriteria(services.User.getUser().marketSearchCriteria);
          return filtersController;
        })(),
      );
    }
  })(UTMarketSearchFiltersViewController);
}

export function navigateBack(delayMs, onDone) {
  function tapBackButton() {
    setTimeout(() => {
      let navigationController = getActiveNavigationController();
      if (navigationController) {
        navigationController._eBackButtonTapped();
      }
    }, 0);
  }
  if (delayMs) {
    waitForDelay(delayMs).then(() => {
      tapBackButton();
      if (onDone) {
        onDone();
      }
    });
  } else {
    tapBackButton();
    if (onDone) {
      onDone();
    }
  }
}
