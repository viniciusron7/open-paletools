/**
 * Birthday easter-egg plugin `birthdayPlugin` (order 1, no settings), installed by the plugin
 * list in src/bootstrap/boot.js: on June 2 (local date, checked once in `run()`) prepends a
 * "PALETA" balloon tile to the home hub.
 *
 * Hooks:
 * - On that date only, `run()` wraps `UTHomeHubView.prototype._generate` (original first) and
 *   prepends `div.tile.col-1-1.birthday` to `.layout-hub` on every call; stylesheet
 *   `paletools-birthday`.
 *
 * Invariants:
 * - Uses translation keys `birthday.title` and `plugins.donation.message`.
 * - As a plain wrapper installed at order 1, it is wrapped by the later `hookPrototypeMethod`
 *   hooks of album and gallery on the same method.
 */
import { createElement, prependElements, queryElement } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import birthdayCss from "./birthday.css";

let birthdayPluginDefinition;

birthdayPluginDefinition = {
  run: function () {
    if (
      !(function () {
        const date = new Date();
        const month = date.getMonth();
        const dayOfMonth = date.getDate();
        return month === 5 && dayOfMonth === 2;
      })()
    ) {
      return;
    }
    const originalGenerate = UTHomeHubView.prototype._generate;
    UTHomeHubView.prototype._generate = function () {
      originalGenerate.call(this);
      const birthdayTile = createElement(
        "div",
        {
          className: "tile col-1-1 birthday",
        },
        '\n        <header>\n            <h1 class="tileHeader">' +
          translate("birthday.title") +
          '</h1>\n        </header>\n        <div class="balloons">\n            <div class="balloon">P</div>\n            <div class="balloon">A</div>\n            <div class="balloon">L</div>\n            <div class="balloon">E</div>\n            <div class="balloon">T</div>\n            <div class="balloon">A</div>\n        </div>\n        <div class="birthday-message">' +
          translate("plugins.donation.message") +
          "</div>",
      );
      prependElements(queryElement(".layout-hub", this.getRootElement()), birthdayTile);
    };
    upsertStylesheet("paletools-birthday", birthdayCss);
  },
  order: 1,
};

export const birthdayPlugin = birthdayPluginDefinition;
