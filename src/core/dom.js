/**
 * DOM helpers that accept DOM nodes or EA views/controls (unwrapped by `getDomElement`:
 * `getRealElement()`, else `getRootElement()`, else the value itself) and, for most of them,
 * iterables of those. Imported by almost every UI module.
 *
 * Invariants:
 * - The append, prepend, insert, remove-from-parent, `addClasses`, `removeClasses` and
 *   `setStyles` helpers do nothing and return undefined for a falsy target; the last three
 *   otherwise return their target as passed, so calls can be chained (src/bootstrap/boot.js
 *   nests `addClasses(removeClasses(...))`).
 * - `queryElement`/`queryElements` return undefined for an empty selector; `queryElements`
 *   returns a real array.
 * - `accessAttribute` reads when the value is falsy and writes otherwise (it cannot write ''
 *   or 0); on an iterable the read returns the first non-null element's attribute.
 * - `createElement(tag, attributes, html)`: a string second argument is the HTML; falsy
 *   attribute values are skipped; `className` maps to 'class'; the HTML is assigned unescaped
 *   to `innerHTML`.
 * - `hasClass` returns false for values without `classList`; `isElementHidden` treats a missing
 *   element or a zero-size box as hidden.
 * - `appendElements`/`prependElements` flatten one level of arrays and skip falsy entries.
 */
import { isIterable, toArray } from "./collections.js";

export function getDomElement(elementOrControl) {
  return typeof elementOrControl.getRealElement === "function"
    ? elementOrControl.getRealElement()
    : elementOrControl.getRootElement
      ? elementOrControl.getRootElement()
      : elementOrControl;
}

export function getParentNode(childElementOrControl) {
  return (childElementOrControl = getDomElement(childElementOrControl)).parentNode;
}

export function queryElement(selector, searchRoot = document) {
  if (selector) {
    return getDomElement(searchRoot).querySelector(selector);
  }
}

export function queryElements(allSelector, allSearchRoot = document) {
  if (allSelector) {
    return toArray(getDomElement(allSearchRoot).querySelectorAll(allSelector));
  }
}

export function findOrCreateElement(matchSelector, elementContainer, createMissingElement) {
  let matchedElement = queryElement(matchSelector, elementContainer);
  if (!matchedElement) {
    matchedElement = createMissingElement();
    appendElements(elementContainer, matchedElement);
  }
  return matchedElement;
}

export function appendElements(appendContainer, ...elementsToAppend) {
  if (appendContainer) {
    appendContainer = getDomElement(appendContainer);
    for (let appendedElement of [].concat(...elementsToAppend)) {
      if (appendedElement) {
        appendContainer.append(getDomElement(appendedElement));
      }
    }
    return elementsToAppend;
  }
}

export function prependElements(prependContainer, ...elementsToPrepend) {
  if (prependContainer) {
    prependContainer = getDomElement(prependContainer);
    for (let prependedElement of [].concat(...elementsToPrepend)) {
      if (prependedElement) {
        prependContainer.prepend(getDomElement(prependedElement));
      }
    }
    return elementsToPrepend;
  }
}

export function removeFromParentNode(elementsToRemove) {
  if (elementsToRemove) {
    if (isIterable(elementsToRemove)) {
      for (let removedElement of elementsToRemove) {
        if (removedElement) {
          removedElement = getDomElement(removedElement);
          removedElement.parentNode.removeChild(removedElement);
        }
      }
    } else {
      (elementsToRemove = getDomElement(elementsToRemove)).parentNode.removeChild(elementsToRemove);
    }
    return elementsToRemove;
  }
}

export function accessAttribute(target, attributeName, attributeValue) {
  if (isIterable(target)) {
    for (let element of target) {
      if (element) {
        if (!attributeValue) {
          return getDomElement(element).getAttribute(attributeName);
        }
        getDomElement(element).setAttribute(attributeName, attributeValue);
      }
    }
  } else {
    if (!attributeValue) {
      return getDomElement(target).getAttribute(attributeName);
    }
    getDomElement(target).setAttribute(attributeName, attributeValue);
  }
}

export function removeAttribute(elementOrView, attributeName) {
  getDomElement(elementOrView).removeAttribute(attributeName);
}

export function createElement(tagName, attributes, innerHTML) {
  let element = document.createElement(tagName);
  if (typeof attributes === "string") {
    innerHTML = attributes;
    attributes = null;
  }
  if (attributes) {
    for (let attributeKey of Object.keys(attributes)) {
      if (attributes[attributeKey]) {
        element.setAttribute(
          attributeKey === "className" ? "class" : attributeKey,
          attributes[attributeKey],
        );
      }
    }
  }
  if (innerHTML) {
    element.innerHTML = innerHTML;
  }
  return element;
}

export function isElementVisible(elementOrView) {
  return !isElementHidden(elementOrView);
}

export function isElementHidden(elementOrView) {
  return (
    !elementOrView ||
    ((elementOrView = getDomElement(elementOrView)).offsetWidth === 0 &&
      elementOrView.offsetHeight === 0)
  );
}

export function addClasses(target, ...classNames) {
  if (target) {
    if (isIterable(target)) {
      for (let element of target) {
        if (element) {
          getDomElement(element).classList.add(...classNames);
        }
      }
    } else {
      getDomElement(target).classList.add(...classNames);
    }
    return target;
  }
}

export function hasClass(elementOrView, className) {
  return (
    !!elementOrView &&
    !!(elementOrView = getDomElement(elementOrView)).classList &&
    elementOrView.classList.contains(className)
  );
}

export function removeClasses(target, ...classNames) {
  if (target) {
    if (isIterable(target)) {
      for (let element of target) {
        if (element) {
          element = getDomElement(element);
          element.classList.remove(...classNames);
        }
      }
    } else {
      getDomElement(target).classList.remove(...classNames);
    }
    return target;
  }
}

export function setStyles(target, styleProperties) {
  if (target) {
    if (isIterable(target)) {
      for (let element of target) {
        if (element) {
          for (let propertyName of Object.keys(styleProperties)) {
            getDomElement(element).style[propertyName] = styleProperties[propertyName];
          }
        }
      }
    } else {
      for (let propertyName of Object.keys(styleProperties)) {
        getDomElement(target).style[propertyName] = styleProperties[propertyName];
      }
    }
    return target;
  }
}

export function insertBefore(elementToInsert, referenceElement) {
  if (elementToInsert && referenceElement) {
    (referenceElement = getDomElement(referenceElement)).parentNode.insertBefore(
      getDomElement(elementToInsert),
      referenceElement,
    );
    return elementToInsert;
  }
}

export function insertAfter(elementToInsert, referenceElement) {
  if (elementToInsert && referenceElement) {
    (referenceElement = getDomElement(referenceElement)).parentNode.insertBefore(
      getDomElement(elementToInsert),
      referenceElement.nextSibling,
    );
    return elementToInsert;
  }
}

export function removeFromParentElement(target) {
  if (target) {
    if (isIterable(target)) {
      for (let element of target) {
        if (element) {
          element = getDomElement(element);
          element.parentElement.removeChild(element);
        }
      }
    } else {
      (target = getDomElement(target)).parentElement.removeChild(target);
    }
    return target;
  }
}
