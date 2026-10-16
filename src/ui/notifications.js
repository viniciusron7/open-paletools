/**
 * Notification helpers: toast notifications queued on `services.Notification` (positive,
 * neutral, negative) and `createStaticNotification`, a persistent notification layer whose
 * message can be replaced (used for the club index load progress).
 *
 * Invariants:
 * - `StaticNotification` appends a `UTNotificationLayerView` with class
 *   `paletools-static-notification` (styled in src/styles/paletools.css) to `document.body` when
 *   constructed; `message(text, type)` replaces its content, using the default type when none is
 *   given.
 * - The owner must call `dispose()` to remove the layer; `message()` after `dispose()` throws.
 */
import { appendElements, getDomElement, removeFromParentNode } from "../core/dom.js";

export function showSuccessNotification(message) {
  services.Notification.queue([message, UINotificationType.POSITIVE]);
}

export function showNeutralNotification(message) {
  services.Notification.queue([message, UINotificationType.NEUTRAL]);
}

export function showErrorNotification(message) {
  services.Notification.queue([message, UINotificationType.NEGATIVE]);
}

export function createStaticNotification(notificationType) {
  return new StaticNotification(notificationType);
}

class StaticNotification {
  #d = null;
  #g;
  constructor(defaultType) {
    this.#g = defaultType;
    this.#d = new UTNotificationLayerView();
    this.#d.init();
    this.#d.getRootElement().classList.add("paletools-static-notification");
    appendElements(document.body, this.#d);
  }
  ["message"](messageText, notificationType) {
    getDomElement(this.#d).innerHTML = "";
    const uTNotificationView = new UTNotificationView(
      new UINotificationDTO(messageText, notificationType || this.#g),
    );
    uTNotificationView.init();
    appendElements(this.#d, uTNotificationView);
  }
  ["dispose"]() {
    if (this.#d) {
      removeFromParentNode(this.#d);
      this.#d = null;
    }
  }
}
