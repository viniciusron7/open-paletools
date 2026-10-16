/**
 * `ClubAnalyzerViewController` (EAViewController subclass), root controller of the Club Analyzer
 * tab created in club-analyzer/index.js: loads club players, unassigned items (`usermassinfo`),
 * trade pile, watchlist and SBC storage, builds a `ClubAnalyzerViewModel` and exports it as a CSV
 * or HTML file download.
 *
 * Invariants:
 * - `JSUtils.inherits(..., EAViewController)` must precede the prototype assignments.
 * - `viewDidAppear` reloads unless `clubAnalyzer.autoRefresh` is off and the session-storage flag
 *   `clubAnalyzerLoaded` is set; it then sets that flag (non-persistent).
 * - `_reload` calls `loadClubPlayers(progress, true, true)`, which forces a fresh load and resets
 *   the shared club-players cache; trade pile, watchlist and storage failures fall back to empty
 *   data. Progress keys: `plugins.clubAnalyzer.view.loading.<step>` with `{count}`.
 * - Group key is the definitionId plus `e` for upgraded items; items with `loans > 0` are not
 *   counted. Counters: rareflag 0/1 by level (<= 64 bronze, <= 74 silver, else gold) with leagues
 *   1003/1014 as libertadores/sudamericana, 54/59 MOTM, 3 TOTW, 11 TOTS, others special.
 *
 * Known issues (kept as-is):
 * - `_reload` runs inside an `async` Promise executor: errors from `loadClubPlayers`,
 *   `usermassinfo` or processing are lost and the loading message stays.
 * - `addPlayersToGroups` reads `player.teamid` (lowercase), so the group `team` is translated
 *   from undefined; `counters.tots++` yields NaN (never initialized, not displayed).
 * - The HTML export suffix is `<table>` instead of `</table>`; CSV values are joined with commas
 *   without quoting.
 * - Export `Untradeable` uses `!player.tradable` for club players but `player.untradeable` for
 *   the other piles; the price column is always null (`viewmodel.prices` is never filled).
 */
import { loadClubPlayers } from "../../club/club-players-cache.js";
import { configuration } from "../../config/configuration.js";
import { requestHttp } from "../../core/http.js";
import { getPageWindow } from "../../core/page-window.js";
import { paletoolsStorage } from "../../core/storage.js";
import { translate } from "../../i18n/translations.js";
import { ClubAnalyzerView } from "./view.js";
import { ClubAnalyzerViewModel } from "./viewmodel.js";
import { fetchSbcStorageItems } from "../../webapp/item-piles.js";

const clubAnalyzerControllerSettings = configuration.plugins.clubAnalyzer;

export function ClubAnalyzerViewController(unusedArgument1) {
  EAViewController.call(this);
  this._viewmodel = new ClubAnalyzerViewModel();
}

function getClubAnalyzerTeamName(teamId) {
  return translate("global.teamabbr15." + getPageWindow().APP_YEAR + ".team" + teamId);
}

function getClubAnalyzerLeagueName(leagueId) {
  return translate("global.leagueFull." + getPageWindow().APP_YEAR + ".league" + leagueId);
}

function getClubAnalyzerNationName(nationId) {
  return translate("search.nationName.nation" + nationId);
}

function getClubAnalyzerRarityName(rarityId) {
  return translate("item.raretype" + rarityId);
}

function getClubAnalyzerPlayStyleName(playStyleId) {
  return translate("playstyles.playstyle" + playStyleId);
}

function exportClubAnalyzerReport(
  viewmodel,
  getPrefix,
  formatHeaderRow,
  formatRow,
  getSuffix,
  fileName,
  mimeType,
) {
  return new Promise((resolve) => {
    let content = "";
    content += getPrefix ? getPrefix() : "";
    content += formatHeaderRow([
      "Definition Id",
      "Lastname",
      "Name",
      "Rating",
      "Evo",
      "Position",
      "Rarity",
      "Skill Moves",
      "Weak Foot",
      "Chemistry",
      "Country",
      "League",
      "Club",
      "Untradeable",
      "Loans",
      "Bought For",
      "Price Range",
      "Discard Value",
      "Market Average",
      "Games Played",
      "Goals",
      "Assists",
      "Yellow Cards",
      "Red Cards",
      "Price as of " + new Date().toString(),
      "Location",
    ]);
    for (let playerKey of Object.keys(viewmodel.players.all)) {
      let player = viewmodel.players.all[playerKey];
      content += formatRow([
        player.definitionId,
        player.data.l,
        player.data.f,
        player.rating,
        player.upgrades ? "Yes" : "No",
        player.preferredPosition,
        getClubAnalyzerRarityName(player.rareflag),
        player._skillMoves + 1,
        player._weakFoot,
        getClubAnalyzerPlayStyleName(player.playStyle),
        getClubAnalyzerNationName(player.nationId),
        getClubAnalyzerLeagueName(player.leagueId),
        getClubAnalyzerTeamName(player.teamId),
        !player.tradable || false,
        player.loans > -1 ? player.loans : 0,
        player.lastSalePrice,
        (player._itemPriceLimits ? player._itemPriceLimits.minimum : "") +
          "-" +
          (player._itemPriceLimits ? player._itemPriceLimits.maximum : ""),
        player.discardValue,
        player.getMarketAverage(),
        player.getGamesPlayed(),
        player.getGoals(),
        player.assists || 0,
        player.getYellowCards(),
        player.getRedCards(),
        viewmodel.prices.hasOwnProperty(player.definitionId)
          ? viewmodel.prices[player.definitionId]
          : null,
        "CLUB",
      ]);
    }
    const playerGroupsByLocation = {
      UNASSIGNED: viewmodel.players.unnasigned.all,
      WATCHLIST: viewmodel.players.watchlistWon,
      TRADEPILE: viewmodel.players.tradepile,
      SBCSTORAGE: viewmodel.players.sbcStorage,
    };
    for (let locationName of Object.keys(playerGroupsByLocation)) {
      for (let groupKey of Object.keys(playerGroupsByLocation[locationName])) {
        let playerGroup = playerGroupsByLocation[locationName][groupKey];
        for (let player of playerGroup.players) {
          content += formatRow([
            player.definitionId,
            playerGroup.data.l,
            playerGroup.data.f,
            player.rating,
            player.upgrades ? "Yes" : "No",
            player.preferredPosition,
            getClubAnalyzerRarityName(player.rareflag),
            player._skillMoves + 1,
            player._weakFoot,
            getClubAnalyzerPlayStyleName(player.playStyle),
            getClubAnalyzerNationName(player.nationId),
            getClubAnalyzerLeagueName(player.leagueId),
            getClubAnalyzerTeamName(player.teamId),
            player.untradeable || false,
            player.loans > -1 ? player.loans : 0,
            player.lastSalePrice,
            (player._itemPriceLimits ? player._itemPriceLimits.minimum : "") +
              "-" +
              (player._itemPriceLimits ? player._itemPriceLimits.maximum : ""),
            player.discardValue,
            player.getMarketAverage(),
            player.getGamesPlayed(),
            player.getGoals(),
            player.assists || 0,
            player.getYellowCards(),
            player.getRedCards(),
            viewmodel.prices.hasOwnProperty(player.definitionId)
              ? viewmodel.prices[player.definitionId]
              : null,
            locationName,
          ]);
        }
      }
    }
    content += getSuffix ? getSuffix() : "";
    (function (fileContent, downloadFileName, blobType) {
      var downloadLink = document.createElement("a");
      blobType = blobType || "application/octet-stream";
      if (navigator.msSaveBlob) {
        navigator.msSaveBlob(
          new Blob([fileContent], {
            type: blobType,
          }),
          downloadFileName,
        );
      } else if (URL && "download" in downloadLink) {
        downloadLink.href = URL.createObjectURL(
          new Blob([fileContent], {
            type: blobType,
          }),
        );
        downloadLink.setAttribute("download", downloadFileName);
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
      } else {
        location.href = "data:application/octet-stream," + encodeURIComponent(fileContent);
      }
      resolve();
    })(content, fileName, mimeType);
  });
}

JSUtils.inherits(ClubAnalyzerViewController, EAViewController);

ClubAnalyzerViewController.prototype._getViewInstanceFromData = function () {
  return new ClubAnalyzerView(this._viewmodel);
};

ClubAnalyzerViewController.prototype.init = function () {
  if (!this.initialized) {
    this.getView().onReloadClicked.observe(this, this._reload);
    this.getView().onExportCsvClicked.observe(this, this._exportCsv);
    this.getView().onExportHtmlClicked.observe(this, this._exportHtml);
    this.initialized = true;
  }
};

ClubAnalyzerViewController.prototype.viewDidAppear = function () {
  this.getNavigationController().setNavigationVisibility(true, true);
  if (
    !(!clubAnalyzerControllerSettings.autoRefresh && paletoolsStorage.get("clubAnalyzerLoaded"))
  ) {
    this._reload();
  }
  paletoolsStorage.set("clubAnalyzerLoaded", true, false);
};

ClubAnalyzerViewController.prototype.getNavigationTitle = function () {
  return translate("plugins.clubAnalyzer.settings.title");
};

ClubAnalyzerViewController.prototype._reload = function () {
  const controller = this;
  this.getView().prepareForUpdate();
  (function (reportProgress) {
    let clubPlayers;
    let userMassInfo;
    let tradePile;
    let watchlist;
    let sbcStorage;
    return new Promise(async (resolve) => {
      reportProgress("players", 0);
      clubPlayers = await loadClubPlayers(
        (loadedCount) => reportProgress("players", loadedCount),
        true,
        true,
      );
      reportProgress("usermassinfo");
      userMassInfo = await requestHttp("usermassinfo");
      reportProgress("tradepile");
      try {
        tradePile = await requestHttp("tradepile");
      } catch {
        tradePile = {
          auctionInfo: [],
        };
      }
      try {
        reportProgress("watchlist");
        watchlist = await requestHttp("watchlist");
      } catch {
        watchlist = {
          total: 0,
          auctionInfo: [],
        };
      }
      try {
        reportProgress(translate("search.searchmode.storage"), null, true);
        const storageItems = await fetchSbcStorageItems();
        sbcStorage = {
          total: storageItems.length,
          items: storageItems,
        };
      } catch {
        sbcStorage = {
          total: 0,
          items: [],
        };
      }
      reportProgress("process");
      const loadedViewmodel = await (async function (
        unusedArgument1,
        clubPlayers,
        userMassInfo,
        tradePile,
        watchlist,
        sbcStorage,
      ) {
        const viewmodel = new ClubAnalyzerViewModel();
        const addPlayersToGroups = (
          source,
          groups,
          selectPlayer,
          includeEntry,
          shouldCountRarity,
        ) => {
          for (let sourceKey of Object.keys(source)) {
            const sourceEntry = source[sourceKey];
            if (includeEntry !== undefined && !includeEntry(sourceEntry)) {
              continue;
            }
            const player = selectPlayer(sourceEntry);
            const groupKey = player.upgrades ? player.definitionId + "e" : player.definitionId;
            if (shouldCountRarity) {
              countPlayerRarity(player);
            }
            if (groups[groupKey]) {
              groups[groupKey].count++;
              groups[groupKey].sumPrices += player.lastSalePrice;
              groups[groupKey].players.push(player);
              groups[groupKey].avg = Math.round(
                groups[groupKey].sumPrices / groups[groupKey].count,
              );
            } else {
              groups[groupKey] = {
                players: [player],
                data: {
                  id: groupKey,
                  f: player._staticData.firstName,
                  l: player._staticData.lastName,
                },
                count: 1,
                sumPrices: player.lastSalePrice,
                rating: player.rating,
                rarity: getClubAnalyzerRarityName(player.rareflag),
                nation: getClubAnalyzerNationName(player.nationId),
                team: getClubAnalyzerTeamName(player.teamid),
                league: getClubAnalyzerLeagueName(player.leagueId),
                preferredPosition: player.preferredPosition,
                avg: player.lastSalePrice,
              };
            }
          }
        };
        const countPlayerRarity = (player) => {
          if (!(player.hasOwnProperty("loans") && player.loans > 0)) {
            switch (player.rareflag) {
              case 0:
              case 1:
                let counterGroup = "";
                counterGroup =
                  player.leagueId === 1003
                    ? "libertadores"
                    : player.leagueId === 1014
                      ? "sudamericana"
                      : player.rareflag === 0
                        ? "common"
                        : "rare";
                if (player.rating <= 64) {
                  viewmodel.counters[counterGroup].bronze++;
                } else if (player.rating > 64 && player.rating <= 74) {
                  viewmodel.counters[counterGroup].silver++;
                } else {
                  viewmodel.counters[counterGroup].gold++;
                }
                break;
              case 54:
                viewmodel.counters.libertadores.motm++;
                break;
              case 59:
                viewmodel.counters.sudamericana.motm++;
                break;
              case 3:
                viewmodel.counters.totw++;
                break;
              case 11:
                viewmodel.counters.tots++;
                break;
              default:
                viewmodel.counters.special++;
            }
          }
        };
        viewmodel.counters.unnasignedTotal = userMassInfo.userInfo.unassignedPileSize;
        viewmodel.counters.watchlistTotal = watchlist.total;
        viewmodel.counters.tradepileTotal = tradePile.auctionInfo.length;
        viewmodel.counters.sbcStorageTotal = sbcStorage.total;
        const uTItemEntityFactory = new UTItemEntityFactory();
        function convertToItemEntities(entries, propertyName) {
          for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
            if (propertyName) {
              entries[entryIndex][propertyName] = uTItemEntityFactory.createItem(
                entries[entryIndex][propertyName],
              );
            } else {
              entries[entryIndex] = uTItemEntityFactory.createItem(entries[entryIndex]);
            }
          }
        }
        convertToItemEntities(userMassInfo.purchasedItems.itemData);
        convertToItemEntities(tradePile.auctionInfo, "itemData");
        convertToItemEntities(watchlist.auctionInfo, "itemData");
        addPlayersToGroups(
          clubPlayers,
          viewmodel.players.club,
          (item) => item,
          (item) => item.lastSalePrice,
        );
        addPlayersToGroups(
          userMassInfo.purchasedItems.itemData,
          viewmodel.players.unnasigned.all,
          (item) => item,
          undefined,
          true,
        );
        addPlayersToGroups(
          userMassInfo.purchasedItems.itemData.filter((item) => item.tradable),
          viewmodel.players.unnasigned.tradeable,
          (item) => item,
          undefined,
          true,
        );
        addPlayersToGroups(
          userMassInfo.purchasedItems.itemData.filter((item) => !item.tradable),
          viewmodel.players.unnasigned.untradeable,
          (item) => item,
          undefined,
          true,
        );
        addPlayersToGroups(
          tradePile.auctionInfo,
          viewmodel.players.tradepile,
          (auction) => auction.itemData,
          undefined,
          true,
        );
        addPlayersToGroups(
          watchlist.auctionInfo,
          viewmodel.players.watchlistWon,
          (auction) => auction.itemData,
          (auction) => auction.bidState === "highest" && auction.tradeState === "closed",
          true,
        );
        addPlayersToGroups(
          watchlist.auctionInfo,
          viewmodel.players.watchlistWinning,
          (auction) => auction.itemData,
          (auction) => auction.bidState === "highest" && auction.tradeState !== "closed",
        );
        addPlayersToGroups(
          watchlist.auctionInfo,
          viewmodel.players.watchlistLoosing,
          (auction) => auction.itemData,
          (auction) => auction.bidState === "outbid" && auction.tradeState !== "closed",
        );
        addPlayersToGroups(
          watchlist.auctionInfo,
          viewmodel.players.watchlistLost,
          (auction) => auction.itemData,
          (auction) => auction.bidState === "outbid" && auction.tradeState === "closed",
        );
        addPlayersToGroups(sbcStorage.items, viewmodel.players.sbcStorage, (item) => item);
        for (let clubPlayerKey of Object.keys(clubPlayers)) {
          const player = clubPlayers[clubPlayerKey];
          const playerKey = player.upgrades ? player.definitionId + "e" : player.definitionId;
          viewmodel.players.all[playerKey] = player;
          player.data = {
            f: player._staticData.firstName,
            l: player._staticData.lastName,
          };
          const rarityName = getClubAnalyzerRarityName(player.rareflag);
          countPlayerRarity(player);
          viewmodel.players.byRarity[rarityName] = viewmodel.players.byRarity[rarityName] || [];
          viewmodel.players.byRarity[rarityName].push(player);
          viewmodel.players.byRating[player.rating] = viewmodel.players.byRating[player.rating] || {
            players: [],
            by: {},
          };
          viewmodel.players.byRating[player.rating].by[rarityName] =
            viewmodel.players.byRating[player.rating].by[rarityName] || [];
          viewmodel.players.byRating[player.rating].players.push(player);
          viewmodel.players.byRating[player.rating].by[rarityName].push(player);
          const nationName = getClubAnalyzerNationName(player.nationId);
          viewmodel.players.byNation[nationName] = viewmodel.players.byNation[nationName] || {
            players: [],
            by: {},
          };
          viewmodel.players.byNation[nationName].by[rarityName] =
            viewmodel.players.byNation[nationName].by[rarityName] || [];
          viewmodel.players.byNation[nationName].players.push(player);
          viewmodel.players.byNation[nationName].by[rarityName].push(player);
          const leagueName = getClubAnalyzerLeagueName(player.leagueId);
          const teamName = getClubAnalyzerTeamName(player.teamId);
          viewmodel.players.byLeague[leagueName] = viewmodel.players.byLeague[leagueName] || {
            players: [],
            by: {},
          };
          viewmodel.players.byLeague[leagueName].by[teamName] = viewmodel.players.byLeague[
            leagueName
          ].by[teamName] || {
            players: [],
            by: {},
          };
          viewmodel.players.byLeague[leagueName].by[teamName].by[rarityName] =
            viewmodel.players.byLeague[leagueName].by[teamName].by[rarityName] || [];
          viewmodel.players.byLeague[leagueName].players.push(player);
          viewmodel.players.byLeague[leagueName].by[teamName].players.push(player);
          viewmodel.players.byLeague[leagueName].by[teamName].by[rarityName].push(player);
        }
        return viewmodel;
      })(0, clubPlayers, userMassInfo, tradePile, watchlist, sbcStorage);
      resolve(loadedViewmodel);
    });
  })(function (stepKey, loadedCount, isRawText) {
    let message = isRawText
      ? stepKey
      : translate("plugins.clubAnalyzer.view.loading." + stepKey).replace("{count}", loadedCount);
    controller.getView().showLoading(message);
  }).then((viewmodel) => {
    this._viewmodel = viewmodel;
    this.getView().hideLoading();
    this.getView().update(this._viewmodel);
  });
};

ClubAnalyzerViewController.prototype._exportCsv = function () {
  exportClubAnalyzerReport(
    this._viewmodel,
    null,
    (headers) => headers.join(",") + "\n",
    (values) => values.join(",") + "\n",
    null,
    "club-analyzer.csv",
    "text/csv;encoding:utf-8",
  );
};

ClubAnalyzerViewController.prototype._exportHtml = function () {
  exportClubAnalyzerReport(
    this._viewmodel,
    () => "<table>",
    (headers) => {
      let headerRowMarkup = "<tr>";
      for (let header of headers) {
        headerRowMarkup += "<th>" + header + "</th>";
      }
      headerRowMarkup += "</tr>";
      return headerRowMarkup;
    },
    (values) => {
      let rowMarkup = "<tr>";
      for (let value of values) {
        rowMarkup += "<td>" + value + "</td>";
      }
      rowMarkup += "</tr>";
      return rowMarkup;
    },
    () => "<table>",
    "club-analyzer.html",
    "text/html;encoding:utf-8",
  );
};
