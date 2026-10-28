/**
 * `ClubAnalyzerView` (EAView subclass), created by `ClubAnalyzerViewController`: filter-bar tabs,
 * reload and CSV/HTML export buttons (exports on desktop only), dashboard counters, a
 * leaderboards `DataTable`, collapsible count trees (rating, rarity, SBS score, league, nation)
 * and auction-style tables (club, unassigned, transfer list, transfer targets, SBC storage).
 *
 * Invariants:
 * - `JSUtils.inherits(ClubAnalyzerView, EAView)` must run before the prototype assignments.
 * - Tab ids `clubanalyzer-players-<x>` map to report ids/classes `clubanalyzer-report-<x>`;
 *   reports sharing a tab carry that id as extra class (`clubanalyzer-report-by-unnasigned`,
 *   `...-by-transfertargets`, `...-by-sbcstorage`). The CSS in club-analyzer/index.js
 *   uses only the `clubanalyzer-report-dashboard`, `clubanalyzer-report-leaderboards` and
 *   `clubanalyzer-loading-message` ids; its `#clubanalyzer-counter-*` rules (one is spelled
 *   `unnasigned`) match nothing created here.
 * - Tab switching and `update` query `.club-analyzer-report` in the whole document; `update`
 *   replaces the body, shows the first report and binds click toggles on every tree `li`.
 * - Count trees sort their first level with `parseInt` differences for the rating and score
 *   reports and with `localeCompare` otherwise; deeper levels always use `localeCompare`.
 * - The dashboard (27.2.1) shows common gold/silver/bronze, TOTW, the summed SBS score
 *   (`counters.sbsScore`) and the unassigned/transfer list/transfer targets totals.
 * - `translateClubAnalyzerKey` falls back to the plain EA key when `plugins.clubAnalyzer.<key>`
 *   is missing (detected by the result containing the key).
 * - Player links: `https://www.fut.gg/players/<slug>/<APP_YEAR_SHORT>-<definitionId>`.
 *
 * Known issues (kept as-is):
 * - `prepareForUpdate`/`update` query `#clubanalyzer-commands` but the container id is
 *   `clubanalyzercommands`, so those show/hide calls are no-ops.
 * - `_createAuctionReport` gives `initialSortKey`/`initialSortDirection` defaults but never uses
 *   them.
 */
import { removeDiacritics } from "../../core/diacritics.js";
import {
  addClasses,
  appendElements,
  createElement,
  isElementVisible,
  queryElement,
  queryElements,
  removeClasses,
} from "../../core/dom.js";
import { listenForEvent } from "../../core/events.js";
import { translate } from "../../i18n/translations.js";
import { DataTable } from "../../ui/components/data-table.js";
import { hideElements, showElements } from "../../ui/visibility.js";

export function ClubAnalyzerView(viewmodel) {
  EAView.call(this);
  this.viewmodel = viewmodel;
  this.onReloadClicked = new EAObservable();
  this.onExportCsvClicked = new EAObservable();
  this.onExportHtmlClicked = new EAObservable();
}

function translateClubAnalyzerKey(key) {
  let translation = translate("plugins.clubAnalyzer." + key);
  return !translation || translation.indexOf(key) > -1 ? translate(key) : translation;
}

function toClubAnalyzerPlayerSlug(fullName) {
  return removeDiacritics(fullName.replace(/ /g, "-"));
}

JSUtils.inherits(ClubAnalyzerView, EAView);

ClubAnalyzerView.prototype.dealloc = function () {
  this.onReloadClicked.dealloc();
  this.onReloadClicked = null;
  this.onExportCsvClicked.dealloc();
  this.onExportCsvClicked = null;
  this.onExportHtmlClicked.dealloc();
  this.onExportHtmlClicked = null;
};

ClubAnalyzerView.prototype._appendMainMenu = function (container) {
  const eAFilterBarView = new EAFilterBarView();
  eAFilterBarView.addTab("clubanalyzer-players-dashboard", "Dashboard");
  eAFilterBarView.addTab(
    "clubanalyzer-players-leaderboards",
    translateClubAnalyzerKey("leaderboards.tile.title"),
  );
  eAFilterBarView.addTab("clubanalyzer-players-by-rating", "Rating");
  eAFilterBarView.addTab("clubanalyzer-players-by-score", "Score");
  eAFilterBarView.addTab(
    "clubanalyzer-players-by-rarity",
    translateClubAnalyzerKey("extendedPlayerInfo.general.rarity"),
  );
  eAFilterBarView.addTab(
    "clubanalyzer-players-by-league",
    translateClubAnalyzerKey("search.details.itemLeague"),
  );
  eAFilterBarView.addTab(
    "clubanalyzer-players-by-nation",
    translateClubAnalyzerKey("extendedPlayerInfo.general.nation"),
  );
  eAFilterBarView.addTab(
    "clubanalyzer-players-by-club-bought",
    translateClubAnalyzerKey("view.tab.club"),
  );
  eAFilterBarView.addTab(
    "clubanalyzer-players-by-unnasigned",
    translateClubAnalyzerKey("navbar.label.newitems"),
  );
  eAFilterBarView.addTab(
    "clubanalyzer-players-by-transferlist",
    translateClubAnalyzerKey("panel.label.transferlist"),
  );
  eAFilterBarView.addTab(
    "clubanalyzer-players-by-transfertargets",
    translateClubAnalyzerKey("panel.label.transfertargets"),
  );
  eAFilterBarView.addTab(
    "clubanalyzer-players-by-sbcstorage",
    translateClubAnalyzerKey("search.searchmode.storage"),
  );
  eAFilterBarView.addTarget(
    this,
    (sender, eventType, tabData) => {
      hideElements(queryElements(".club-analyzer-report"));
      let reportId = tabData.id.replace("players-", "report-");
      showElements(queryElement("#" + reportId));
      showElements(queryElements("." + reportId));
    },
    EventType.TAP,
  );
  appendElements(container, eAFilterBarView);
  eAFilterBarView.setActiveTab("clubanalyzer-players-dashboard");
  eAFilterBarView.layoutSubviews();
};

ClubAnalyzerView.prototype._appendBody = function (container) {
  const pinnedListContainer = createElement("div", {
    className: "ut-pinned-list-container ut-content-container",
  });
  const contentContainer = createElement("div", {
    className: "ut-content",
  });
  const reportsContainer = createElement("div", {
    className: "ut-pinned-list club-analyzer",
  });
  const commandsContainer = createElement("div", {
    id: "clubanalyzercommands",
    className: "button-container",
  });
  const reloadButton = new UTStandardButtonControl();
  reloadButton.init();
  reloadButton.setText(translateClubAnalyzerKey("view.buttons.reload"));
  reloadButton.addTarget(this, () => this.onReloadClicked.notify(), EventType.TAP);
  addClasses(reloadButton, "primary");
  appendElements(commandsContainer, reloadButton);
  if (!isPhone()) {
    const exportCsvButton = new UTStandardButtonControl();
    exportCsvButton.init();
    exportCsvButton.setText(translateClubAnalyzerKey("view.buttons.exportCsv"));
    exportCsvButton.addTarget(this, () => this.onExportCsvClicked.notify(), EventType.TAP);
    addClasses(exportCsvButton, "primary");
    const exportHtmlButton = new UTStandardButtonControl();
    exportHtmlButton.init();
    exportHtmlButton.setText(translateClubAnalyzerKey("view.buttons.exportHtml"));
    exportHtmlButton.addTarget(this, () => this.onExportHtmlClicked.notify(), EventType.TAP);
    addClasses(exportHtmlButton, "primary");
    appendElements(commandsContainer, exportCsvButton, exportHtmlButton);
  }
  appendElements(container, pinnedListContainer);
  appendElements(pinnedListContainer, contentContainer);
  appendElements(contentContainer, commandsContainer);
  appendElements(contentContainer, reportsContainer);
  return reportsContainer;
};

ClubAnalyzerView.prototype._createDashboard = function () {
  const counters = this.viewmodel.counters;
  return createElement(
    "div",
    {
      id: "clubanalyzer-report-dashboard",
      className: "club-analyzer-report",
    },
    '<h3 class="tile">\n                ' +
      translateClubAnalyzerKey("view.dashboard.description") +
      '\n                </h3>\n                <div>\n                <table class="rarities tile">\n                    <tr><td><img src="https://www.ea.com/ea-sports-fc/ultimate-team/web-app/images/SearchFilters/level/gold.png" /></td><td>' +
      counters.common.gold +
      '</td></tr>\n                    <tr><td><img src="https://www.ea.com/ea-sports-fc/ultimate-team/web-app/images/SearchFilters/level/silver.png" /></td><td>' +
      counters.common.silver +
      '</td></tr>\n                    <tr><td><img src="https://www.ea.com/ea-sports-fc/ultimate-team/web-app/images/SearchFilters/level/bronze.png" /></td><td>' +
      counters.common.bronze +
      '</td></tr>\n                    <tr><td><img src="https://www.ea.com/ea-sports-fc/ultimate-team/web-app/images/SearchFilters/level/SP.png" /></td><td>' +
      counters.totw +
      '</td><td></td></tr>\n                </table>\n                </div>\n                <div>\n                    <table class="latam tile">\n                        <tr><td><img src="https://www.ea.com/ea-sports-fc/ultimate-team/web-app/images/sbc/dustpoint.png" /></td>\n                            <td>' +
      counters.sbsScore +
      '</td>\n                        </tr>\n                    </table>\n                    <table class="limbo tile">\n                        <tr><th>' +
      translateClubAnalyzerKey("navbar.label.newitems") +
      "</th><th>" +
      translateClubAnalyzerKey("panel.label.transferlist") +
      "</th><th>" +
      translateClubAnalyzerKey("panel.label.transfertargets") +
      "</th></tr>\n                        <tr><td>" +
      counters.unnasignedTotal +
      "</td><td>" +
      counters.tradepileTotal +
      "</td><td>" +
      counters.watchlistTotal +
      "</td></tr>\n                    </table>\n                </div>\n            </div>",
  );
};

ClubAnalyzerView.prototype._renderPlayer = function (player, isInlineList) {
  const definitionId = player.definitionId || player.data.id;
  return (
    '<li class="player ' +
    (isInlineList ? "inline-list" : "") +
    '">\n                <a class="fullname" href="https://www.fut.gg/players/' +
    toClubAnalyzerPlayerSlug(player.data.f + "-" + player.data.l).toLowerCase() +
    "/" +
    APP_YEAR_SHORT +
    "-" +
    definitionId +
    '" target="_blank">\n                    <span class="firstname">' +
    player.data.f +
    '</span> \n                    <span class="lastname">' +
    player.data.l +
    '</span>\n                    <span class="position">' +
    PlayerPosition[player.preferredPosition] +
    '</span>\n                </a>\n                <span class="rating">' +
    player.rating +
    "</span>\n                " +
    (player.tradable ? "" : '<span class="fut_icon icon_untradeable untradeable"></span>') +
    "\n                " +
    (player.loans > -1 ? '<span class="loans">' + player.loans + "</span>" : "") +
    "\n                " +
    (isInlineList ? '<span class="count">' + player.count + "</span>" : "") +
    "\n                " +
    (isInlineList
      ? '<span class="avg">' + Math.round(player.sumPrices / player.count) + "</span>"
      : "") +
    "\n                " +
    (isInlineList
      ? '<span class="rarity">' + translateClubAnalyzerKey(player.rarity) + "</span>"
      : "") +
    "\n            </li>"
  );
};

ClubAnalyzerView.prototype._createLeaderboards = function () {
  const leaderboardsTable = new DataTable({
    id: "leaderboards-table",
    enablePagination: true,
    defaultSortDirection: "desc",
    headers: [
      "",
      {
        text: "Name",
        sort: true,
      },
      {
        text: "Games",
        sort: {
          direction: "desc",
          default: true,
        },
      },
      {
        text: "Goals",
        sort: true,
      },
      {
        text: "GPG",
        sort: true,
      },
      {
        text: "Assists",
        sort: true,
      },
      {
        text: "Yellows",
        sort: true,
      },
      {
        text: "Reds",
        sort: true,
      },
    ],
    mapper: (player) => {
      const itemCellView = new UTItemTableCellView();
      itemCellView.setData(player);
      itemCellView.render();
      return [
        itemCellView.getRootElement(),
        player.data.l,
        player.getGamesPlayed(),
        player.getGoals(),
        player.getGamesPlayed() > 0
          ? (player.getGoals() / player.getGamesPlayed()).toFixed(2)
          : "0.00",
        player.assists || 0,
        player.getYellowCards(),
        player.getRedCards(),
      ];
    },
    sortFunc: (tableData, sortKey, sortDirection) => {
      switch (sortKey) {
        case "Name":
          return tableData.sort((left, right) => {
            const leftLastName = left.data.l;
            const rightLastName = right.data.l;
            return sortDirection === "asc"
              ? leftLastName.localeCompare(rightLastName)
              : rightLastName.localeCompare(leftLastName);
          });
        case "Games":
          return tableData.sort((left, right) =>
            sortDirection === "asc"
              ? left.getGamesPlayed() - right.getGamesPlayed()
              : right.getGamesPlayed() - left.getGamesPlayed(),
          );
        case "Goals":
          return tableData.sort((left, right) =>
            sortDirection === "asc"
              ? left.getGoals() - right.getGoals()
              : right.getGoals() - left.getGoals(),
          );
        case "GPG":
          return tableData.sort((left, right) =>
            sortDirection === "asc"
              ? (left.getGoals() / left.getGamesPlayed()).toFixed(2) -
                (right.getGoals() / right.getGamesPlayed()).toFixed(2)
              : (right.getGoals() / right.getGamesPlayed()).toFixed(2) -
                (left.getGoals() / left.getGamesPlayed()).toFixed(2),
          );
        case "Assists":
          return tableData.sort((left, right) => {
            const leftAssists = left.assists || 0;
            const rightAssists = right.assists || 0;
            return sortDirection === "asc"
              ? leftAssists - rightAssists
              : rightAssists - leftAssists;
          });
        case "Yellows":
          return tableData.sort((left, right) =>
            sortDirection === "asc"
              ? left.getYellowCards() - right.getYellowCards()
              : right.getYellowCards() - left.getYellowCards(),
          );
        case "Reds":
          return tableData.sort((left, right) =>
            sortDirection === "asc"
              ? left.getRedCards() - right.getRedCards()
              : right.getRedCards() - left.getRedCards(),
          );
      }
    },
    data: Object.values(this.viewmodel.players.all).sort(
      (left, right) => right.getGamesPlayed() - left.getGamesPlayed(),
    ),
  });
  const leaderboardsReport = createElement("div", {
    id: "clubanalyzer-report-leaderboards",
    className: "club-analyzer-report",
    style: "display: none",
  });
  appendElements(leaderboardsReport, leaderboardsTable);
  return leaderboardsReport;
};

ClubAnalyzerView.prototype._createCountReport = function (
  reportId,
  groupedPlayers,
  sortNumerically,
) {
  return createElement(
    "div",
    {
      id: reportId,
      className: "club-analyzer-report",
    },
    this._createCountReportTree(groupedPlayers, 0, sortNumerically),
  );
};

ClubAnalyzerView.prototype._createCountReportTree = function (node, depth, sortNumerically) {
  let markup = "<div>";
  if (node instanceof Array) {
    markup += '<ul class="players" style="display: none">';
    for (let player of node) {
      markup += this._renderPlayer(player);
    }
    markup += "</ul>";
  } else {
    markup += depth === 0 ? "<ul>" : '<ul style="display: none">';
    for (let groupName of Object.keys(node).sort((left, right) =>
      sortNumerically ? parseInt(left) - parseInt(right) : left.localeCompare(right),
    )) {
      markup += depth === 0 ? '<li class="inline-list">' : "<li>";
      markup += '<span class="value">' + groupName + "</span>";
      markup +=
        '<span class="count">' +
        (node[groupName].players ? node[groupName].players.length : node[groupName].length) +
        "</span>";
      markup += this._createCountReportTree(
        node[groupName].by ? node[groupName].by : node[groupName],
        depth + 1,
      );
      markup += "</li>";
    }
    markup += "</ul>";
  }
  markup += "</div>";
  return markup;
};

ClubAnalyzerView.prototype._createAuctionReport = function (
  reportId,
  playerGroups,
  caption,
  extraClassName,
  initialSortKey,
  initialSortDirection,
  showCount,
  showPrice,
) {
  initialSortKey = initialSortKey || "rating";
  initialSortDirection = initialSortDirection || "desc";
  const headers = [
    {
      text: translateClubAnalyzerKey("extendedPlayerInfo.general.firstName"),
      sort: {
        key: "name",
        default: true,
      },
    },
    {
      text: translateClubAnalyzerKey("extendedPlayerInfo.general.preferredPosition"),
      sort: {
        key: "position",
      },
    },
    {
      text: translateClubAnalyzerKey("extendedPlayerInfo.general.overall"),
      sort: {
        key: "rating",
      },
    },
    {
      text: translateClubAnalyzerKey("extendedPlayerInfo.general.rarity"),
      sort: {
        key: "rarity",
      },
    },
  ];
  if (showCount) {
    headers.push({
      text: "#",
      sort: {
        key: "count",
      },
    });
  }
  if (showPrice) {
    headers.push({
      text: translateClubAnalyzerKey("searchauctions.label.pricing"),
      sort: {
        key: "value",
      },
    });
  }
  const reportTable = new DataTable({
    caption: caption,
    headers: headers,
    sortFunc: (tableData, sortKey, sortDirection) =>
      tableData.sort(
        (function (compareKey, compareDirection) {
          return (left, right) => {
            let leftValue;
            let rightValue;
            switch (compareKey) {
              case "name":
                leftValue = left.data.f + left.data.l;
                rightValue = right.data.f + right.data.l;
                break;
              case "position":
                leftValue = left.preferredPosition;
                rightValue = right.preferredPosition;
                break;
              case "rating":
                leftValue = left.rating;
                rightValue = right.rating;
                break;
              case "rarity":
                leftValue = translateClubAnalyzerKey(left.rarity);
                rightValue = translateClubAnalyzerKey(right.rarity);
                break;
              case "count":
                leftValue = left.count;
                rightValue = right.count;
                break;
              case "value":
                leftValue = left.avg;
                rightValue = right.avg;
            }
            let comparison = 0;
            comparison =
              typeof leftValue === "string"
                ? compareDirection === "asc"
                  ? leftValue.localeCompare(rightValue)
                  : rightValue.localeCompare(leftValue)
                : compareDirection === "asc"
                  ? leftValue - rightValue
                  : rightValue - leftValue;
            if (comparison === 0) {
              const leftFullName = left.data.f + left.data.l;
              const rightFullName = right.data.f + right.data.l;
              return compareDirection === "asc"
                ? leftFullName.localeCompare(rightFullName)
                : rightFullName.localeCompare(leftFullName);
            }
            return comparison;
          };
        })(sortKey, sortDirection),
      ),
    data: Object.values(playerGroups),
    mapper: (playerGroup) => {
      const cells = [];
      const nameLink = createElement(
        "a",
        {
          className: "fullname",
          href:
            "https://www.fut.gg/players/" +
            toClubAnalyzerPlayerSlug(playerGroup.data.f + "-" + playerGroup.data.l).toLowerCase() +
            "/" +
            APP_YEAR_SHORT +
            "-" +
            (playerGroup.definitionId || playerGroup.data.id),
        },
        '<span class="firstname">' +
          playerGroup.data.f +
          '</span> <span class="lastname">' +
          playerGroup.data.l +
          "</span>",
      );
      cells.push(nameLink);
      cells.push(
        playerGroup.preferredPosition ? PlayerPosition[playerGroup.preferredPosition] : "",
      );
      cells.push(playerGroup.rating);
      cells.push(translateClubAnalyzerKey(playerGroup.rarity));
      if (showCount) {
        cells.push(
          createElement(
            "span",
            {
              className: "count",
            },
            playerGroup.count || "&nbsp;",
          ),
        );
      }
      if (showPrice) {
        cells.push(
          createElement(
            "span",
            {
              className: "avg",
            },
            playerGroup.avg || "&nbsp;",
          ),
        );
      }
      return cells;
    },
  });
  const report = createElement("div", {
    id: reportId,
    className: "club-analyzer-report club-analyzer-auctionreport " + extraClassName,
  });
  appendElements(report, reportTable);
  return report;
};

ClubAnalyzerView.prototype._generate = function () {
  if (!this.generated) {
    const root = document.createElement("div");
    this._appendMainMenu(root);
    this._loadingMessage = createElement("div", {
      id: "clubanalyzer-loading-message",
    });
    hideElements(this._loadingMessage);
    appendElements(root, this._loadingMessage);
    this._body = this._appendBody(root);
    this.__root = root;
    this.generated = true;
  }
};

ClubAnalyzerView.prototype.showLoading = function (message) {
  this._loadingMessage.textContent = message;
  showElements(this._loadingMessage);
};

ClubAnalyzerView.prototype.hideLoading = function () {
  this._loadingMessage.textContent = "";
  hideElements(this._loadingMessage);
};

ClubAnalyzerView.prototype.prepareForUpdate = function () {
  this._body.innerHTML = "";
  const menuButtons = queryElements(".menu-container > button", this.__root);
  removeClasses(menuButtons, "selected");
  addClasses(menuButtons[0], "selected");
  hideElements(queryElement("#clubanalyzer-commands"));
};

ClubAnalyzerView.prototype.update = function (viewmodel) {
  this._body.innerHTML = "";
  this.viewmodel = viewmodel;
  appendElements(
    this._body,
    this._createDashboard(viewmodel),
    this._createLeaderboards(viewmodel),
    this._createCountReport("clubanalyzer-report-by-rating", viewmodel.players.byRating, true),
    this._createCountReport("clubanalyzer-report-by-rarity", viewmodel.players.byRarity),
    this._createCountReport("clubanalyzer-report-by-score", viewmodel.players.bySbsScore, true),
    this._createCountReport("clubanalyzer-report-by-league", viewmodel.players.byLeague),
    this._createCountReport("clubanalyzer-report-by-nation", viewmodel.players.byNation),
    this._createAuctionReport(
      "clubanalyzer-report-by-club-bought",
      viewmodel.players.club,
      null,
      null,
      null,
      null,
      false,
      true,
    ),
    this._createAuctionReport(
      "clubanalyzer-report-by-unnasigned",
      viewmodel.players.unnasigned.tradeable,
      "Tradeable",
      "clubanalyzer-report-by-unnasigned",
      null,
      null,
      true,
      true,
    ),
    this._createAuctionReport(
      "clubanalyzer-report-by-unnasigned2",
      viewmodel.players.unnasigned.untradeable,
      "Untradeable",
      "clubanalyzer-report-by-unnasigned",
      null,
      null,
      true,
    ),
    this._createAuctionReport(
      "clubanalyzer-report-by-transferlist",
      viewmodel.players.tradepile,
      null,
      null,
      null,
      null,
      true,
      true,
    ),
    this._createAuctionReport(
      "clubanalyzer-report-by-transfertargets",
      viewmodel.players.watchlistWon,
      translateClubAnalyzerKey("watchlist.dock.categories.won"),
      null,
      null,
      null,
      true,
      true,
    ),
    this._createAuctionReport(
      "clubanalyzer-report-by-transfertargets2",
      viewmodel.players.watchlistWinning,
      translateClubAnalyzerKey("dock.label.winning"),
      "clubanalyzer-report-by-transfertargets",
      null,
      null,
      true,
      true,
    ),
    this._createAuctionReport(
      "clubanalyzer-report-by-transfertargets3",
      viewmodel.players.watchlistLoosing,
      translateClubAnalyzerKey("dock.label.outbid"),
      "clubanalyzer-report-by-transfertargets",
      null,
      null,
      true,
      true,
    ),
    this._createAuctionReport(
      "clubanalyzer-report-by-transfertargets4",
      viewmodel.players.watchlistLost,
      translateClubAnalyzerKey("watchlist.dock.categories.expired"),
      "clubanalyzer-report-by-transfertargets",
      null,
      null,
      true,
      true,
    ),
    this._createAuctionReport(
      "clubanalyzer-report-by-sbcstorage",
      viewmodel.players.sbcStorage,
      translateClubAnalyzerKey("search.searchmode.storage"),
      "clubanalyzer-report-by-sbcstorage",
      null,
      null,
      true,
    ),
  );
  const reports = queryElements(".club-analyzer-report");
  hideElements(reports);
  showElements(queryElement("#clubanalyzer-commands"));
  showElements(reports[0]);
  listenForEvent(queryElements("li", this._body), "click", (event) => {
    const listItem = event.currentTarget;
    const subList = queryElement("ul", listItem);
    if (isElementVisible(subList)) {
      hideElements(subList);
      removeClasses(listItem, "expanded");
    } else {
      showElements(subList);
      addClasses(listItem, "expanded");
    }
    event.stopPropagation();
  });
};
