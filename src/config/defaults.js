/**
 * Default values of every Paletools setting, as the live object `configurationState`.
 * src/config/configuration.js clones it into `defaultConfiguration`, merges the stored settings
 * into it when evaluated and re-exports it as `configuration`, the object all modules read and
 * the settings UI mutates.
 *
 * Invariants:
 * - `configurationState` must stay the same object (it is never reassigned): about 70 modules
 *   keep references to its nested `plugins.<name>` objects from evaluation time.
 * - Key names are persisted in 'paletools:settings'; renaming one loses the user's stored value
 *   (it stays under the old name). This includes misspellings the code reads:
 *   `sbcBuilderEnhacer`, `movePlayersToClubAfterSumbit`, `clubSearchEnhacer`. New keys reach
 *   existing users through the merge.
 * - `plugins.pristinePlayers` is declared twice; the later `{ enabled: false }` wins (nothing
 *   reads it).
 * - `sbcSmartBuilder.minOvr`/`maxOvr` are EA's `UTSearchCriteriaDTO` default OVR bounds (via
 *   src/webapp/search-criteria-limits.js), read when the bundle is evaluated.
 * - Snipe key bindings (`plugins.snipe.buttons`) are `KeyboardEvent.code` values.
 * - `appVersion` is persisted but never read; after loading it holds the stored value.
 */
import { paletoolsVersion } from "./version.js";
import { maxOvr, minOvr } from "../webapp/search-criteria-limits.js";

export let configurationState = {
  enabled: true,
  appVersion: paletoolsVersion,
  requests: {
    maxItemsCount: 200,
  },
  externalServices: {
    prices: {
      providers: ["github"],
      provider: "github",
    },
    sbc: {
      providers: ["futbin"],
      provider: "futbin",
    },
  },
  plugins: {
    gridMode: {
      enabled: false,
    },
    wideMode: {
      enabled: false,
    },
    compareMinMaxPrices: {
      enabled: true,
      order: null,
    },
    clubSearchFilters: {
      enabled: true,
    },
    marketSearchFilters: {
      playerId: false,
      playerRating: true,
      savedFilters: true,
      hideDuplicates: false,
      holographicFilters: false,
    },
    donation: {
      enabled: true,
    },
    playerActions: {
      copyPlayerId: true,
      futbinSearch: true,
      futggSearch: true,
      findLowestPrice: true,
      listForProfit: true,
      listForProfitAutoPublish: false,
      listForProfitDisplayPercentageButtons: true,
      displayApplyConsumable: true,
      lockPlayer: true,
      copyPlayerName: true,
      playStylesLab: true,
      removeAllEvolutions: true,
    },
    gallery: {
      lastSelection: {},
      enabled: true,
    },
    priceTracker: {
      enabled: true,
    },
    album: {
      lastSelection: {},
      enabled: true,
    },
    autoSnipe: {
      enabled: false,
      maxPrice: 1000,
      delayMs: 3000,
      maxSnipes: 10,
      maxCards: 1,
      buyDelayMs: 1000,
    },
    snipeMobile: {
      enabled: true,
      autoBack: false,
      quickBuy: true,
    },
    snipe: {
      oneTouch: {
        isEnabled: false,
        displayMinBid: false,
        displayMinBuy: false,
        superMode: false,
      },
      autoSnipe: {
        enabled: false,
      },
      sounds: {
        enabled: true,
      },
      buttons: {
        back: "Digit1",
        enableDisable: "Comma",
        lists: {
          up: "ArrowUp",
          down: "ArrowDown",
          prev: "ArrowLeft",
          next: "ArrowRight",
        },
        search: {
          resetBid: "Backquote",
          decMinBid: "ArrowLeft",
          incMinBid: "ArrowRight",
          decMaxBid: "End",
          incMaxBid: "Home",
          decMinBuy: "Delete",
          incMinBuy: "PageDown",
          decMaxBuy: "ArrowDown",
          incMaxBuy: "ArrowUp",
          search: "Digit2",
          oneTouchMinBid: "BracketRight",
          oneTouchMinBuy: "BracketLeft",
        },
        results: {
          bid: "Digit4",
          buy: "Digit3",
          transfer: "KeyR",
          club: "KeyC",
          pressEnter: true,
          autoBuy: false,
          preventBack: false,
          sell: "KeyQ",
          decBid: "Delete",
          incBid: "PageDown",
          compare: "KeyM",
          redeem: "KeyO",
          redeemHideout: "KeyH",
          storage: "KeyY",
        },
        customActions: {
          findLowestPrice: "KeyV",
          lockPlayer: "KeyL",
          copyPlayerName: "KeyN",
        },
        pick: {
          first: "Numpad1",
          second: "Numpad2",
          third: "Numpad3",
          fourth: "Numpad4",
          fifth: "Numpad5",
        },
        unassigned: {
          quickSell: "KeyA",
          storeInClub: "KeyS",
          transferList: "KeyD",
          quickSellNonDuplicates: "KeyF",
          quickSellDuplicates: "KeyG",
          sbcStorage: "KeyZ",
          organize: "Space",
        },
        sbc: {
          useSquadBuilder: "KeyB",
          clearSquad: "KeyC",
          submitChallenge: "KeyS",
          useDuplicated: "KeyD",
          useUnassigned: "KeyU",
          useTemplate: "KeyT",
          useTransferList: "KeyX",
          editTemplate: "KeyE",
          repeatSbc: "KeyR",
          importSbc: "KeyI",
          addMultiplePlayersToSquad: "KeyM",
          sbcSmartBuilder: "KeyP",
        },
        sbcHub: {
          repeat: "KeyR",
        },
      },
      legacyMode: false,
      enabled: true,
    },
    duplicatedToSbc: {
      enabled: true,
      behavior: "position",
    },
    transferListToSbc: {
      enabled: true,
      behavior: "position",
    },
    unassignedToSbc: {
      enabled: true,
      behavior: "position",
    },
    selectCheapest: {
      enabled: false,
    },
    pristinePlayers: {
      enabled: true,
    },
    importSbc: {
      enabled: true,
    },
    improvedPlayerSearch: {
      enabled: true,
    },
    markDuplicated: {
      enabled: true,
    },
    sbcSelectMultiplePlayers: {
      enabled: true,
    },
    filterSbcs: {
      enabled: true,
    },
    clubAnalyzer: {
      enabled: true,
      autoRefresh: true,
    },
    clubIndex: {
      enabled: false,
    },
    clubPager: {
      enabled: true,
      pageSize: 20,
    },
    gradingScore: {
      enabled: true,
    },
    checkForUpdates: {
      enabled: true,
    },
    sbcTimesCompleted: {
      enabled: true,
    },
    showConsoleOutput: {
      enabled: true,
    },
    countMyPacks: {
      enabled: true,
    },
    groupMyPacks: {
      enabled: true,
    },
    transferListSendAllToClub: {
      enabled: true,
    },
    sbcBuilderEnhacer: {
      enabled: true,
      movePlayersToClubAfterSumbit: "all",
    },
    sbcSmartBuilder: {
      enabled: true,
      useStorage: true,
      preferStorage: false,
      storageOnly: false,
      allowSpecialCards: false,
      ignoreEvolutions: true,
      ignoreSingleRevisionPlayers: false,
      ignoreImportantLeagues: false,
      ignoreImportantNations: false,
      minOvr: minOvr,
      maxOvr: maxOvr,
      untradeablesOnly: false,
    },
    sbcAutoSolver: {
      enabled: false,
      preferStorage: false,
      storageOnly: false,
      allowSpecialCards: true,
      untradeablesOnly: false,
      reverseSolve: false,
      submitDelay: 1,
      ignoreEvolutions: true,
      ignoreSingleRevisionPlayers: false,
      storagePreferences: {},
      storageOnlyPreferences: {},
      allowSpecialCardsPreferences: {},
      untradeablesOnlyPreferences: {},
      reverseSolvePreferences: {},
      submitDelayPreferences: {},
      ignoreEvolutionsPreferences: {},
      ignoreSingleRevisionPreferences: {},
      ratingRanges: {},
    },
    clubSearchEnhacer: {
      enabled: true,
    },
    keepPlayerSellValues: {
      enabled: true,
    },
    sellMultiple: {
      enabled: false,
    },
    eaBugFixer: {
      enabled: true,
    },
    disablePackAnimations: {
      enabled: false,
      override: false,
      raritiesToIgnore: [],
      minOvr: null,
    },
    pristinePlayers: {
      enabled: false,
    },
    incrementAllowedAuctions: {
      enabled: false,
    },
    warningScreen: {
      enabled: true,
    },
    sellProfit: {
      enabled: true,
    },
    trackTransactions: {
      enabled: true,
    },
    playerCardInfo: {
      enabled: true,
      alternatePositions: true,
      skillMoves: true,
      weakFoot: true,
      untradeable: true,
      pristine: true,
      league: true,
      importantLeague: true,
      workrates: true,
    },
    importantLeagues: {
      enabled: true,
      leagueIds: [],
      color: null,
    },
    importantNations: {
      enabled: true,
      nationIds: [],
    },
    transactionsHistory: {
      enabled: true,
    },
    debugMode: {
      enabled: false,
    },
    experimental: {
      fastClubSearch: false,
      fastConceptSearch: false,
    },
    refreshCoins: {
      enabled: true,
    },
    externalMarketPrices: {
      enabled: true,
    },
    limbo: {
      enabled: true,
    },
    myPacks: {
      enabled: true,
      group: true,
      packOpener: true,
      filter: true,
      search: true,
      searchText: null,
      lock: true,
      visibility: {
        tradeable: true,
        untradeable: true,
        locked: true,
      },
    },
    sbcRatingCalculator: {
      enabled: true,
      maxCombinations: 10,
      lowerBound: 5,
      upperBound: 5,
    },
    claimObjectives: {
      enabled: true,
    },
    packsOpener: {
      enabled: false,
    },
    decimalRating: {
      enabled: false,
    },
    lowestMarketPrice: {
      enabled: false,
    },
    repeatSbc: {
      enabled: true,
    },
    goToPackStore: {
      enabled: false,
    },
    benchManagement: {
      enabled: true,
    },
    lockPlayers: {
      enabled: true,
      lockByNationIds: [],
      lockByTeamIds: [],
      lockByLeagueIds: [],
      lockByRarityIds: [],
    },
    removeBulkActionButton: {
      enabled: true,
    },
    removeExchangePlayersButton: {
      enabled: false,
    },
    autoRelist: {
      enabled: false,
      autoRelist: false,
      interval: 300000,
    },
    sbcTemplateBuilder: {
      enabled: true,
      stopOnRequirementsMet: true,
    },
    claimSbcRewards: {
      enabled: false,
    },
    sbcChallengesView: {
      enabled: true,
      gridMode: false,
      hideCompleted: false,
      displayTOTW: false,
    },
    addMultiplePlayersToSquad: {
      enabled: true,
    },
    hiddenInjury: {
      enabled: false,
    },
    antigambling: {
      enabled: false,
    },
    disableFifaPoints: {
      enabled: false,
    },
    babysitter: {
      enabled: false,
      sbc: {
        enabled: true,
        delay: 30,
        delayAfter: 1,
      },
    },
    unassignedGoBack: {
      enabled: false,
    },
    playerPicks: {
      enabled: false,
      maxRating: {
        enabled: false,
      },
      hideout: {
        enabled: false,
        type: "paletools",
        custom: null,
      },
      clubTradeable: {
        enabled: false,
      },
    },
    notifications: {
      enabled: true,
      info: true,
      neutral: true,
      error: true,
    },
    sbcStorage: {
      enabled: true,
    },
    evolutions: {
      enabled: true,
    },
    whatsnew: {
      enabled: true,
      interval: 24,
      intervalPeriod: "hours",
    },
    improvedFilters: {
      enabled: false,
      gridFilters: false,
      countClubPlayers: false,
      orderByImportantLeagues: false,
      orderByImportantNations: false,
    },
    unassignedOrganize: {
      enabled: true,
      displayButton: false,
    },
    hideSbcs: {
      enabled: true,
    },
    hideEvolutions: {
      enabled: true,
    },
    playStylesLab: {
      enabled: false,
      players: [],
    },
    removeRoundedCorners: {
      enabled: true,
    },
  },
};
