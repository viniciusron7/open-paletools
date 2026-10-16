/**
 * Donation plugin `donationPlugin` (order 2, no settings), installed by the plugin list in
 * src/bootstrap/boot.js: inserts the version/@paleta, MercadoPago and PayPal panels before the
 * currencies of the currency navigation bar.
 *
 * Hooks:
 * - `UTCurrencyNavigationBarView.prototype._generate`, wrapped in `run()` (original first);
 *   panels are added once per view (`_donationGenerated`) together with stylesheet
 *   `paletools-donation`.
 *
 * Invariants:
 * - The `div.donation-panel` elements go before `this.__currencies` in the order version,
 *   MercadoPago, PayPal; grid-mode and wide-mode wrap the same method later (order 4).
 * - `donationPlugin` is `donationPluginDefinition || undefined` (alias kept from the bundle).
 */
import { paletoolsVersion } from "../../config/version.js";
import { createElement, insertBefore } from "../../core/dom.js";
import { paletoolsImages } from "../../ui/images.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import donationCss from "./donation.css";

let donationPluginDefinition;

donationPluginDefinition = {
  run: function () {
    const originalGenerate = UTCurrencyNavigationBarView.prototype._generate;
    UTCurrencyNavigationBarView.prototype._generate = function () {
      originalGenerate.call(this);
      if (!this._donationGenerated) {
        const mercadoPagoPanel = createElement(
          "div",
          {
            className: "donation-panel",
          },
          '<a href="https://ceneka.net/mp/d/paletaeaa" target="_blank"><img src="' +
            paletoolsImages.mercadoPago +
            '" /></a>',
        );
        const paypalPanel = createElement(
          "div",
          {
            className: "donation-panel",
          },
          '<a href="https://paypal.me/paletools" target="_blank"><img src="' +
            paletoolsImages.paypal +
            '" /></a>',
        );
        insertBefore(
          createElement(
            "div",
            {
              className: "donation-panel",
            },
            "<div>v" +
              paletoolsVersion +
              '</div><div><a href="https://twitter.com/paleta" target="_blank">@paleta</a></div>',
          ),
          this.__currencies,
        );
        insertBefore(mercadoPagoPanel, this.__currencies);
        insertBefore(paypalPanel, this.__currencies);
        upsertStylesheet("paletools-donation", donationCss);
        this._donationGenerated = true;
      }
    };
  },
  order: 2,
};

let donationPluginExport;

donationPluginExport = donationPluginDefinition || undefined;

export const donationPlugin = donationPluginExport;
