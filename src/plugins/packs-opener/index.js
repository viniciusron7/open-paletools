/**
 * Packs Opener plugin (`packsOpenerPlugin`, order 100), installed by the plugin list in
 * src/bootstrap/boot.js, and `showPacksOpenerDialog(packId, openerSettings, isMyPack)`, also
 * called by src/plugins/my-packs/index.js. The dialog asks for speed, pack count, currency (store
 * packs) and an action per item category, then opens or buys the packs one by one with
 * `packsOpenerOpenPack` (./opener.js) and pushes `PacksOpenerResultsViewController`.
 *
 * Hooks:
 * - `run()` wraps `UTStorePackDetailsView.prototype.setupBuyCoinsButton` (after original): when
 *   enabled, (re)creates the `_btnOpenPacks` button, which opens the dialog for
 *   `this.articleId` with `packsOpenerSettings`.
 *
 * Invariants:
 * - `packsOpenerStorePacksCache` (`@mutable` export) memoizes the `services.Store.getPacks()`
 *   response; src/plugins/my-packs/index.js resets it to null from its `UTStoreView._generate`
 *   hook. That cross-module assignment relies on the single-scope build (native ES modules would
 *   throw), so the binding must stay an exported `let`.
 * - The chosen speed and actions are written into the passed settings object
 *   (`plugins.packsOpener` or `plugins.myPacks`: `speedMultiplier`, `purchaseActions.*`) and
 *   persisted before opening; the selects are pre-filled from `purchaseActions`.
 * - Select values are `packsOpenerItemActions` values; speed "3"/"1" multiplies the random
 *   527-1378 ms pause between packs; the loop stops at the first non-success status.
 * - DOM ids `pack-opener-*` and `coins-to-spend` are queried after `showDialog` returns;
 *   stylesheet id `paletools-packs-opener`.
 * - Enabling requires `confirm(translate("plugins.dangerous"))`; the default is off.
 *
 * Known issues (kept as-is):
 * - The `pack.tradable && option` / `!pack.tradable && option` concatenations put the literal
 *   text `false` (or `undefined`) into the select markup.
 * - The `SBC_STORAGE_FULL` message is unreachable: `packsOpenerOpenPack` reports that case as
 *   `ERROR`.
 * - Declining the confirmation leaves the settings toggle shown as on (the callback does not
 *   return false).
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { waitForDelay } from "../../core/async.js";
import { appendElements, queryElement, queryElements } from "../../core/dom.js";
import { translate } from "../../i18n/translations.js";
import {
  PacksOpenerState,
  packsOpenerItemActions,
  packsOpenerOpenPack,
  packsOpenerOpenStatus,
} from "./opener.js";
import { PacksOpenerResultsViewController } from "./results-view.js";
import { NumericSpinnerControl } from "../../ui/controls/numeric-spinner-control.js";
import { showDialog } from "../../ui/dialog.js";
import { showErrorNotification, showNeutralNotification } from "../../ui/notifications.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { hideElements, showElements } from "../../ui/visibility.js";
import { hideLoadingShield, showLoadingShield } from "../../webapp/loading-shield.js";
import { getActiveNavigationController } from "../../webapp/navigation.js";
import { observableToPromise } from "../../webapp/observable.js";
import packsOpenerStyles from "./packs-opener.css";

let packsOpenerPluginDefinition;

/**
 * @mutable Store packs response reused by the packs opener; the My Packs store-view hook
 * (src/plugins/my-packs/index.js) resets it to null whenever the store view is generated.
 */
export let packsOpenerStorePacksCache = null;

export async function showPacksOpenerDialog(packId, openerSettings, isMyPack) {
  const storePacksResponse =
    packsOpenerStorePacksCache || (await observableToPromise(services.Store.getPacks()));
  packsOpenerStorePacksCache = storePacksResponse;
  const matchingPacks = isMyPack
    ? packsOpenerStorePacksCache.response.packs.filter(
        (storePack) => storePack.id === packId && storePack.isMyPack,
      )
    : packsOpenerStorePacksCache.response.packs.filter((storePack) => storePack.id === packId);
  if (!matchingPacks || matchingPacks.length === 0) {
    return void showErrorNotification(translate("plugins.packsOpener.errors.missingPack"));
  }
  const pack = matchingPacks[0];
  const isStorePack = !isMyPack;
  const moveToClubOption =
    '<option value="' +
    packsOpenerItemActions.MOVE_TO_CLUB +
    '">' +
    translate("plugins.packsOpener.purchaseAction.moveToClub") +
    "</option>";
  const moveToTransferListOption =
    '<option value="' +
    packsOpenerItemActions.MOVE_TO_TRANSFER_LIST +
    '">' +
    translate("plugins.packsOpener.purchaseAction.moveToTransferList") +
    "</option>";
  const quickSellOption =
    '<option value="' +
    packsOpenerItemActions.QUICK_SELL +
    '">' +
    translate("plugins.packsOpener.purchaseAction.quickSell") +
    "</option>";
  const stopProcessOption =
    '<option value="' +
    packsOpenerItemActions.STOP_PROCESS +
    '">' +
    translate("plugins.packsOpener.purchaseAction.stopProcess") +
    "</option>";
  const sbcStorageOption =
    '<option value="' +
    packsOpenerItemActions.SBC_STORAGE +
    '">' +
    translate("search.searchmode.storage") +
    "</option>";
  let packCountSpinner;
  showDialog(
    [
      {
        labelEnum: enums.UIDialogOptions.OK,
      },
      {
        labelEnum: enums.UIDialogOptions.CANCEL,
      },
    ],
    translate("plugins.packsOpener.settings.title"),
    '<div class="pack-opener-dialog">\n            <label for="pack-opener-speed">' +
      translate("plugins.packsOpener.labels.speed") +
      '</label>\n            <select id="pack-opener-speed">\n                <option value="3">' +
      translate("plugins.packsOpener.speed.slow") +
      '</option>\n                <option value="1">' +
      translate("plugins.packsOpener.speed.fast") +
      '</option>\n            </select> \n            <label for="pack-opener-purchase-count">' +
      translate("plugins.packsOpener.labels.packsCount") +
      '</label>\n            <div id="pack-opener-purchase-count"></div>\n            <label id="coins-to-spend"></label>\n            ' +
      (isStorePack
        ? '<label for="pack-opener-currency">' +
          translate("plugins.packsOpener.labels.currency") +
          '</label>\n            <select id="pack-opener-currency">\n                <option value="' +
          GameCurrency.COINS +
          '">' +
          translate("currency.coins") +
          '</option>\n                <option value="' +
          GameCurrency.POINTS +
          '">' +
          translate("currency.points") +
          "</option>\n            </select>"
        : "") +
      '\n            <label for="pack-opener-players-purchase-action">' +
      translate("plugins.packsOpener.labels.purchaseAction.players") +
      '</label>\n            <select id="pack-opener-players-purchase-action" data-purchase-action="players">\n                ' +
      moveToClubOption +
      "\n                " +
      (pack.tradable && moveToTransferListOption) +
      "\n                " +
      quickSellOption +
      '\n            </select> \n            <label for="pack-opener-duplicated-players-purchase-action">' +
      translate("plugins.packsOpener.labels.purchaseAction.duplicatePlayers") +
      '</label>\n            <select id="pack-opener-duplicated-players-purchase-action" data-purchase-action="duplicatedPlayers">\n                ' +
      (pack.tradable && moveToTransferListOption) +
      "\n                " +
      quickSellOption +
      "\n                " +
      (!pack.tradable && stopProcessOption) +
      "\n                " +
      (!pack.tradable && sbcStorageOption) +
      '\n            </select> \n            <label for="pack-opener-managers-purchase-action">' +
      translate("plugins.packsOpener.labels.purchaseAction.managers") +
      '</label>\n            <select id="pack-opener-managers-purchase-action" data-purchase-action="managers">\n                ' +
      moveToClubOption +
      "\n                " +
      (pack.tradable && moveToTransferListOption) +
      "\n                " +
      quickSellOption +
      '\n            </select> \n            <label for="pack-opener-duplicated-managers-purchase-action">' +
      translate("plugins.packsOpener.labels.purchaseAction.duplicateManagers") +
      '</label>\n            <select id="pack-opener-duplicated-managers-purchase-action" data-purchase-action="duplicatedManagers">\n                ' +
      (pack.tradable && moveToTransferListOption) +
      "\n                " +
      quickSellOption +
      "\n                " +
      (!pack.tradable && stopProcessOption) +
      '\n            </select> \n            <label for="pack-opener-items-purchase-action">' +
      translate("plugins.packsOpener.labels.purchaseAction.items") +
      '</label>\n            <select id="pack-opener-items-purchase-action" data-purchase-action="items">\n                ' +
      moveToClubOption +
      "\n                " +
      (pack.tradable && moveToTransferListOption) +
      "\n                " +
      quickSellOption +
      '\n            </select> \n            <label for="pack-opener-duplicated-items-purchase-action">' +
      translate("plugins.packsOpener.labels.purchaseAction.duplicateItems") +
      '</label>\n            <select id="pack-opener-duplicated-items-purchase-action" data-purchase-action="duplicatedItems">\n                ' +
      (pack.tradable && moveToTransferListOption) +
      "\n                " +
      quickSellOption +
      "\n                " +
      (!pack.tradable && stopProcessOption) +
      "\n            </select> \n            " +
      (pack.tradable
        ? '\n            <label for="pack-opener-transfer-list-full-purchase-action">' +
          translate("plugins.packsOpener.labels.purchaseAction.transferListFull") +
          '</label>\n            <select id="pack-opener-transfer-list-full-purchase-action" data-purchase-action="transferListFull">\n                ' +
          quickSellOption +
          "\n                " +
          stopProcessOption +
          "\n            </select>"
        : "") +
      "\n         </div>\n         ",
    (selectedOption) => {
      if (selectedOption == enums.UIDialogOptions.OK) {
        (async function (
          selectedPack,
          speedMultiplier,
          playersAction,
          duplicatedPlayersAction,
          managersAction,
          duplicatedManagersAction,
          itemsAction,
          duplicatedItemsAction,
          transferListFull,
          packsRemaining,
          currency,
          openerSettings,
          unusedArgument13,
        ) {
          const openingState = new PacksOpenerState();
          for (
            openerSettings.purchaseActions = openerSettings.purchaseActions || {},
              openerSettings.speedMultiplier = speedMultiplier,
              openerSettings.purchaseActions.players = playersAction,
              openerSettings.purchaseActions.duplicatedPlayers = duplicatedPlayersAction,
              openerSettings.purchaseActions.managers = managersAction,
              openerSettings.purchaseActions.duplicatedManagers = duplicatedManagersAction,
              openerSettings.purchaseActions.items = itemsAction,
              openerSettings.purchaseActions.duplicatedItems = duplicatedItemsAction,
              openerSettings.purchaseActions.transferListFull = transferListFull,
              persistConfiguration(),
              showLoadingShield();
            packsRemaining > 0;
          ) {
            const openStatus = await packsOpenerOpenPack(
              selectedPack,
              speedMultiplier,
              playersAction,
              duplicatedPlayersAction,
              managersAction,
              duplicatedManagersAction,
              itemsAction,
              duplicatedItemsAction,
              transferListFull,
              currency,
              openingState,
            );
            if (openStatus !== packsOpenerOpenStatus.SUCCESS) {
              let errorMessage;
              hideLoadingShield();
              switch (openStatus) {
                case packsOpenerOpenStatus.ERROR:
                  errorMessage = translate("plugins.packsOpener.errors.generic");
                  break;
                case packsOpenerOpenStatus.UNASSIGNED_ITEMS:
                  errorMessage = translate("popup.error.unassignedItemsEntitlementTitle");
                  break;
                case packsOpenerOpenStatus.NOT_ENOUGH_CREDITS:
                  errorMessage = translate("popup.error.tradetoken.NotEnoughCredits");
                  break;
                case packsOpenerOpenStatus.TRANSFER_LIST_FULL:
                  errorMessage = translate("plugins.packsOpener.errors.transferListFull");
                  break;
                case packsOpenerOpenStatus.SBC_STORAGE_FULL:
                  errorMessage = translate("infopanel.label.storagefull");
              }
              showErrorNotification(errorMessage);
              break;
            }
            await waitForDelay(527 * speedMultiplier, 1378 * speedMultiplier);
            packsRemaining--;
            showNeutralNotification(
              translate("plugins.packsOpener.packsRemaining").replace("#", packsRemaining),
            );
          }
          hideLoadingShield();
          (function (finalState) {
            const resultsController = new PacksOpenerResultsViewController(finalState);
            resultsController.init();
            getActiveNavigationController().pushViewController(resultsController);
          })(openingState);
        })(
          matchingPacks[0],
          queryElement("#pack-opener-speed").value,
          queryElement("#pack-opener-players-purchase-action").value,
          queryElement("#pack-opener-duplicated-players-purchase-action").value,
          queryElement("#pack-opener-managers-purchase-action").value,
          queryElement("#pack-opener-duplicated-managers-purchase-action").value,
          queryElement("#pack-opener-items-purchase-action").value,
          queryElement("#pack-opener-duplicated-items-purchase-action").value,
          pack.tradable
            ? queryElement("#pack-opener-transfer-list-full-purchase-action").value
            : packsOpenerItemActions.STOP_PROCESS,
          packCountSpinner.getValue(),
          isStorePack ? queryElement("#pack-opener-currency").value : null,
          openerSettings,
        );
      }
    },
  );
  packCountSpinner = new NumericSpinnerControl();
  packCountSpinner.init();
  packCountSpinner.setLimits(1, isMyPack ? matchingPacks.length : 999);
  packCountSpinner.setValue(1);
  appendElements(queryElement("#pack-opener-purchase-count"), packCountSpinner);
  if (isStorePack) {
    const currencySelect = queryElement("#pack-opener-currency");
    const coinsToSpendLabel = queryElement("#coins-to-spend");
    hideElements(coinsToSpendLabel);
    packCountSpinner.getInput().addTarget(
      this,
      () => {
        const currencyLabelKey =
          currencySelect.value === GameCurrency.COINS ? "currency.coins" : "currency.points";
        const amount = pack.prices.get(currencySelect.value).amount;
        const packCount = packCountSpinner.getValue();
        if (packCount > 0) {
          showElements(coinsToSpendLabel);
          coinsToSpendLabel.textContent = translate(currencyLabelKey) + ": " + amount * packCount;
        } else {
          hideElements(coinsToSpendLabel);
        }
      },
      EventType.CHANGE,
    );
  }
  for (let actionSelect of queryElements("[data-purchase-action]")) {
    if (!openerSettings.purchaseActions) {
      continue;
    }
    const savedAction = openerSettings.purchaseActions[actionSelect.dataset.purchaseAction];
    if (savedAction) {
      actionSelect.value = savedAction;
    }
  }
}

const packsOpenerSettings = configuration.plugins.packsOpener;

packsOpenerPluginDefinition = {
  run: function () {
    upsertStylesheet("paletools-packs-opener", packsOpenerStyles);
    const originalSetupBuyCoinsButton = UTStorePackDetailsView.prototype.setupBuyCoinsButton;
    UTStorePackDetailsView.prototype.setupBuyCoinsButton = function (...args) {
      originalSetupBuyCoinsButton.call(this, ...args);
      if (configuration.enabled && packsOpenerSettings.enabled) {
        if (this._btnOpenPacks) {
          this.removeActionButton(this._btnOpenPacks);
        }
        this._btnOpenPacks = new UTCurrencyButtonControl();
        this._btnOpenPacks.init();
        this._btnOpenPacks.setText(translate("plugins.packsOpener.button.text"));
        this._btnOpenPacks.addClass("primary pack-opener");
        this._btnOpenPacks.addTarget(
          this,
          function () {
            showPacksOpenerDialog(this.articleId, packsOpenerSettings, false);
          },
          EventType.TAP,
        );
        this.appendActionButton(this._btnOpenPacks);
      }
    };
  },
  order: 100,
  settings: {
    name: "packs-opener",
    title: "plugins.packsOpener.settings.title",
    menu: function () {
      const container = document.createElement("div");
      appendToggle(container, "enabled", packsOpenerSettings.enabled, (isEnabled) => {
        if (isEnabled && confirm(translate("plugins.dangerous"))) {
          packsOpenerSettings.enabled = true;
        } else if (!isEnabled) {
          packsOpenerSettings.enabled = false;
        }
        persistConfiguration();
      });
      return container;
    },
  },
};

export const packsOpenerPlugin = packsOpenerPluginDefinition;
