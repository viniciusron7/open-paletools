/**
 * `requestUserCurrencies()` wraps `services.User.requestCurrencies()` and resolves its `data`; on
 * failure it resolves zeroed currencies (`coins`, `points`, `tokens` as `UTCurrencyVO`,
 * `packs: 0`) instead of rejecting. Used by the refresh-coins plugin and the packs opener.
 */
import { observableToPromise } from "./observable.js";

export async function requestUserCurrencies() {
  const response = await observableToPromise(services.User.requestCurrencies());
  return response.success
    ? response.data
    : {
        coins: new UTCurrencyVO(GameCurrency.COINS, 0),
        packs: 0,
        points: new UTCurrencyVO(GameCurrency.POINTS, 0),
        tokens: new UTCurrencyVO(GameCurrency.DRAFT_TOKEN, 0),
      };
}
