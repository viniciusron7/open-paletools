/**
 * Club Analyzer plugin definition `clubAnalyzerPlugin` (order 20), installed by the plugin list
 * in src/bootstrap/boot.js: adds a Club Analyzer tab rooted at `ClubAnalyzerViewController` to
 * the game tab bar and injects its stylesheet; the settings menu holds the `autoRefresh` toggle.
 *
 * Hooks:
 * - `UTGameTabBarController.prototype.initWithViewControllers`, wrapped in `run()`: pushes a
 *   `UTGameFlowNavigationController` (tab tag 9, classes `icon-club` and `paletools-element`)
 *   before calling the original.
 *
 * Invariants:
 * - Other code wraps the same method (price-tracker via `hookPrototypeMethod`, the settings
 *   plugin after all plugins); the wrapping order decides the tab order.
 * - Stylesheet id `paletools-club-analyzer`; its rules target the ids/classes produced by
 *   view.js.
 *
 * Known issues (kept as-is):
 * - The tab is added unconditionally: `clubAnalyzer.enabled` and `configuration.enabled` are
 *   never read.
 * - `.replace("#EXTENDED_PLAYER_INFO.TOTAL#", ...)` targets a placeholder absent from the CSS.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { translate } from "../../i18n/translations.js";
import { ClubAnalyzerViewController } from "./controller.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";

let clubAnalyzerPluginDefinition;

const clubAnalyzerSettings = configuration.plugins.clubAnalyzer;

function createClubAnalyzerSettingsMenu() {
  const container = document.createElement("div");
  appendToggle(
    container,
    "plugins.clubAnalyzer.settings.autoRefresh",
    clubAnalyzerSettings.autoRefresh,
    (autoRefresh) => {
      clubAnalyzerSettings.autoRefresh = autoRefresh;
      persistConfiguration();
    },
  );
  return container;
}

clubAnalyzerPluginDefinition = {
  run: function () {
    const originalInitWithViewControllers =
      UTGameTabBarController.prototype.initWithViewControllers;
    UTGameTabBarController.prototype.initWithViewControllers = function (viewControllers) {
      const clubAnalyzerNavigationController = new UTGameFlowNavigationController();
      clubAnalyzerNavigationController.initWithRootController(new ClubAnalyzerViewController());
      clubAnalyzerNavigationController.tabBarItem = (function () {
        const tabBarItem = new UTTabBarItemView();
        tabBarItem.init();
        tabBarItem.setTag(9);
        tabBarItem.setText(translate("plugins.clubAnalyzer.settings.title"));
        tabBarItem.addClass("icon-club");
        tabBarItem.getRootElement().classList.add("paletools-element");
        return tabBarItem;
      })();
      viewControllers.push(clubAnalyzerNavigationController);
      originalInitWithViewControllers.call(this, viewControllers);
    };
    upsertStylesheet(
      "paletools-club-analyzer",
      ".playerResultsList .club-analyzer-exists {\n    display: flex !important;\n}\n\n.playerResultsList .club-analyzer-exists:after {\n    color: #00ff00;\n    order: 2;\n    position: initial;\n    margin-left: 0;\n}\n\n.playerResultsList .club-analyzer-untradeable:before {\n    color: #ffd100;\n    order: 3;\n    position: initial;\n    margin-left: 0;\n}\n\n.club-analyzer-untradeable:before {\n    color: #ffd100;\n    margin-left: 22px;\n    position: absolute;\n    top: 5px;\n    z-index: 20;\n}\n\n.ut-club-search-results-view .club-analyzer-untradeable:before {\n    display: none;\n}\n\n.club-analyzer {\n    margin-top: 4px;\n}\n\n.club-analyzer .inline-list {\n    padding: 6px;\n    display: inline-block;\n    width: 30%;\n    margin-right: 4px;\n    margin-bottom: 1px;\n    font-size: 14px;\n}\n\n.phone .club-analyzer .inline-list {\n    width: 100%;\n}\n\n.club-analyzer .inline-list li {\n    line-height: 30px;\n}\n\n.club-analyzer .value:after {\n    content: ':';\n    margin-right: 4px;\n}\n\n.phone .club-analyzer .position,\n.phone .club-analyzer [data-sortby=\"position\"] {\n    display: none;\n}\n\n.club-analyzer .player .untradeable {\n    margin-right: 4px;\n    display: inline-flex;\n}\n\n.club-analyzer .untradeable:before {\n    color: #ffd100;\n}\n\n.club-analyzer li.player {\n    display: flex;\n    align-items: center;\n}\n\n.club-analyzer .player .fullname {\n    flex-grow: 1;\n    color: white;\n}\n\n.club-analyzer .player .position::before {\n    content: \"(\";\n}\n\n.club-analyzer .player .position::after {\n    content: \")\";\n}\n\n.club-analyzer .player .rating {\n    order: 4;\n}\n\n.club-analyzer-auctionreport td:first-child {\n    width: 40%;\n}\n\n.club-analyzer-auctionreport .rating {\n    order: 1;\n    margin-right: 8px;\n    text-align: center;\n    display: inline-block;\n}\n\n.club-analyzer-auctionreport a {\n    color: white;\n}\n\n.club-analyzer-auctionreport .rarity {\n    order: 2;\n    margin-right: 8px;\n    text-align: center;\n    display: inline-block;\n}\n\n.club-analyzer-auctionreport .count {\n    border-left: 1px solid #275261;\n    color: yellow;\n    text-align: right;\n    width: 40px;\n    display: inline-block;\n}\n\n.club-analyzer-auctionreport .avg {\n    border-left: 1px solid #275261;\n    color: yellow;\n    text-align: right;\n    width: 100px;\n    display: inline-block;\n}\n\n.club-analyzer-auctionreport .fut_icon {\n    position: absolute;\n    transform: rotate(180deg);\n}\n\n.club-analyzer-auctionreport table {\n    border-collapse: collapse;\n    width: 75%;\n    margin: 0 auto;\n}\n\n.club-analyzer-auctionreport table th {\n    background-color: #1f1d1e;\n}\n\n.club-analyzer-auctionreport table th,\n.club-analyzer-auctionreport table td {\n    padding: 4px;\n}\n\n.club-analyzer-auctionreport table tr:nth-child(odd) {\n    background-color: #33353c;\n}\n\n.club-analyzer-auctionreport th.sorted-desc .fut_icon {\n    transform: none;\n}\n\n\n.club-analyzer .loans {\n    z-index: 3;\n    font-size: 80%;\n    text-align: center;\n    font-family: UltimateTeam, sans-serif;\n    font-weight: 600;\n    box-shadow: 0 1px 1px 0 rgb(0 0 0 / 25%);\n    background: linear-gradient(to bottom, #44a7db 0, #42a2d4 100%);\n    color: #fff;\n    border-radius: 50%;\n    width: 18px;\n    height: 18px;\n    margin-right: 4px;\n    line-height: 18px;\n}\n\n.club-analyzer .player .rating:before {\n    content: '(';\n}\n\n.club-analyzer .player .rating:after {\n    content: ')';\n}\n\n.club-analyzer-navigation>div {\n    border-right: 1px solid #275261;\n    padding-left: 12px;\n    padding-right: 12px;\n    height: 100%;\n    display: flex;\n    align-items: center;\n}\n\n.club-analyzer-navigation>div>a {\n    color: white;\n}\n\n.club-analyzer li:not(.player):before {\n    content: '+';\n}\n\n.club-analyzer li.expanded:not(.player):before {\n    content: '-';\n}\n\n#clubanalyzer-report-dashboard h3 {\n    text-align: center;\n}\n\n#clubanalyzer-report-dashboard table {\n    width: 100%;\n}\n\n#clubanalyzer-report-dashboard td {\n    font-size: 30px;\n    text-align: center;\n}\n\n#clubanalyzer-report-dashboard th {\n    text-align: center;\n    font-size: 30px;\n}\n\n.phone #clubanalyzer-report-dashboard th {\n    text-align: center;\n    font-size: 20px;\n}\n\n#clubanalyzer-report-dashboard img {\n    width: 100px;\n}\n\n.phone #clubanalyzer-report-dashboard img {\n    width: 40px;\n}\n\n#clubanalyzer-report-dashboard>div {\n    display: inline-block;\n    width: 49%;\n    vertical-align: top;\n}\n\n.phone #clubanalyzer-report-dashboard>div {\n    display: block;\n    width: 100%;\n}\n\n#clubanalyzer-report-dashboard .limbo th {\n    font-size: 20px;\n}\n\n#clubanalyzer-report-dashboard table {\n    margin-top: 10px;\n    margin-left: 10px;\n}\n\n.phone #clubanalyzer-report-dashboard table {\n    margin-top: 0;\n    margin-left: 0;\n}\n\n#clubanalyzer-report-dashboard .tile {\n    padding: 10px;\n}\n\n#clubanalyzer-loading-message {\n    text-align: center;\n    line-height: 50px;\n}\n\n#clubanalyzer-counter-unnasigned::before,\n#clubanalyzer-counter-tradepile::before,\n#clubanalyzer-counter-watchlist::before {\n    content: '(';\n}\n\n#clubanalyzer-counter-unnasigned::after,\n#clubanalyzer-counter-tradepile::after,\n#clubanalyzer-counter-watchlist::after {\n    content: ')';\n}\n\n#clubanalyzer-report-leaderboards table {\n    width: 100%;\n    border-collapse: collapse;\n    border: 1px solid #2d2c36;\n    color: #e0e0e0;\n    background-color: #1e1d25;\n}\n\n#clubanalyzer-report-leaderboards table .listFUTItem {\n    background-color: transparent;\n}\n\n#clubanalyzer-report-leaderboards table .listFUTItem > div {\n    border: 0px;\n}\n\n#clubanalyzer-report-leaderboards table th {\n  background-color: #2d2c36;\n  color: #ffffff;\n  text-align: center;\n  padding: 8px 12px;\n  font-weight: bold;\n  border-bottom: 2px solid #2d2c36;\n}\n\n#clubanalyzer-report-leaderboards table td {\n    text-align: center;\n    font-weight: bold;\n    padding: 8px 12px;\n    border-bottom: 1px solid #2d2c36;\n}\n\n#clubanalyzer-report-leaderboards table tr:hover {\n  background-color: #2d2c36;\n  cursor: pointer;\n}\n\n#clubanalyzer-report-leaderboards table td:first-child {\n    width: 82px;\n}\n\n#clubanalyzer-report-leaderboards .table-pagination {\n  display: flex;\n  justify-content: center;\n  align-items: center;\n  gap: 1rem;\n  padding: 10px 0;\n  color: #ccc;\n}\n\n#clubanalyzer-report-leaderboards .table-pagination button {\n  background-color: #2d2c36;\n  color: #fff;\n  border: 1px solid #2d2c36;\n  padding: 6px 12px;\n  border-radius: 4px;\n  cursor: pointer;\n}\n\n#clubanalyzer-report-leaderboards .table-pagination button:hover:not(:disabled) {\n  background-color: #3a3944;\n}\n\n#clubanalyzer-report-leaderboards .table-pagination button:disabled {\n  opacity: 0.5;\n  cursor: not-allowed;\n}\n\n#clubanalyzer-report-leaderboards .listFUTItem::before,\n#clubanalyzer-report-leaderboards .listFUTItem>button,\n#clubanalyzer-report-leaderboards .listFUTItem .name,\n#clubanalyzer-report-leaderboards .listFUTItem .player-stats-data-component,\n#clubanalyzer-report-leaderboards .listFUTItem .rating::before,\n#clubanalyzer-report-leaderboards .listFUTItem .rating::after,\n#clubanalyzer-report-leaderboards .listFUTItem .position::before,\n#clubanalyzer-report-leaderboards .listFUTItem .position::after,\n#clubanalyzer-report-leaderboards .listFUTItem .right-column-info {\n    display: none;\n}".replace(
        "#EXTENDED_PLAYER_INFO.TOTAL#",
        translate("extendedPlayerInfo.total"),
      ),
    );
  },
  order: 20,
  menu: createClubAnalyzerSettingsMenu,
  settings: {
    name: "club-analyzer",
    title: "plugins.clubAnalyzer.settings.title",
    menu: createClubAnalyzerSettingsMenu,
  },
};

export const clubAnalyzerPlugin = clubAnalyzerPluginDefinition;
