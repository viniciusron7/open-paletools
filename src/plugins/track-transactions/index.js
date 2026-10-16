/**
 * Track Transactions plugin (`trackTransactionsPlugin`, order 100), installed by the plugin list
 * in src/bootstrap/boot.js: records bought and sold items in the IndexedDB transaction history
 * (`paletoolsDatabase.transactions`). Installs no hooks.
 *
 * Invariants:
 * - `run()` listens to `ITEM_WON` (`{item, bid}`, stored with the bid as price), `ITEMS_WON` and
 *   `ITEMS_SOLD` (`{items}`), all dispatched by src/webapp/patches.js; only items whose auction
 *   data reports `isWon()` / `isSold()` are stored.
 * - `configuration.enabled` and `plugins.trackTransactions.enabled` are checked per event.
 * - The buy records feed src/plugins/sell-profit/index.js (`getBuyByItemId`).
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { listenForEvent, paletoolsEvents } from "../../core/events.js";
import { paletoolsDatabase } from "../../db/database.js";
import { appendToggle } from "../../ui/settings-controls.js";

let trackTransactionsPluginDefinition;

const trackTransactionsSettings = configuration.plugins.trackTransactions;

trackTransactionsPluginDefinition = {
  run: function () {
    listenForEvent(paletoolsEvents.ITEM_WON, (event) => {
      if (
        configuration.enabled &&
        trackTransactionsSettings.enabled &&
        event.detail.item &&
        event.detail.item.getAuctionData().isWon()
      ) {
        paletoolsDatabase.transactions.insertBuy(event.detail.item, event.detail.bid);
      }
    });
    listenForEvent(paletoolsEvents.ITEMS_SOLD, (event) => {
      if (configuration.enabled && trackTransactionsSettings.enabled) {
        for (let item of event.detail.items.filter((item) => item.getAuctionData().isSold())) {
          paletoolsDatabase.transactions.insertSell(item);
        }
      }
    });
    listenForEvent(paletoolsEvents.ITEMS_WON, (event) => {
      if (configuration.enabled && trackTransactionsSettings.enabled) {
        for (let item of event.detail.items.filter((item) => item.getAuctionData().isWon())) {
          paletoolsDatabase.transactions.insertBuy(item);
        }
      }
    });
  },
  order: 100,
  settings: {
    name: "track-transactions",
    title: "plugins.trackTransactions.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", trackTransactionsSettings.enabled, (isEnabled) => {
        trackTransactionsSettings.enabled = isEnabled;
        persistConfiguration();
      });
      return container;
    },
  },
};

export const trackTransactionsPlugin = trackTransactionsPluginDefinition;
