// Source modules of the player snipe and bulk buy features, as loaded by the integration tests
// (in one scope, see load-sources.cjs). Together they are:
const PLAYER_SNIPE_AND_BULK_BUY_INTEGRATION = Object.freeze([
  "src/plugins/player-snipe/core.js",
  "src/plugins/market-automation/requests.js",
  "src/plugins/player-snipe/selection.js",
  "src/plugins/player-snipe/market.js",
  "src/plugins/player-snipe/status-panel.js",
  "src/plugins/market-automation/sessions.js",
  "src/plugins/player-snipe/index.js",
  "src/plugins/bulk-buy/market.js",
  "src/plugins/bulk-buy/status-panel.js",
  "src/plugins/bulk-buy/index.js",
]);

const PLAYER_SNIPE_CORE = "src/plugins/player-snipe/core.js";
const BULK_BUY_CORE = "src/plugins/bulk-buy/core.js";

// Helpers the integration tests evaluate for real (other helpers are faked by each test).
const MARKET_HELPERS = Object.freeze({
  "src/market/prices.js": ["roundToValidPrice"],
  "src/club/club-index.js": ["getItemDatabaseId"],
  "src/market/price-inputs.js": ["getPriceRowValue"],
});

module.exports = {
  PLAYER_SNIPE_AND_BULK_BUY_INTEGRATION,
  PLAYER_SNIPE_CORE,
  BULK_BUY_CORE,
  MARKET_HELPERS,
};
