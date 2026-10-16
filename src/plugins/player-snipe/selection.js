/**
 * Reads the player and the Buy Now Price Max chosen in the native market filters; used by
 * market-automation/sessions.js and player-snipe/market.js for button availability, confirmation,
 * Confirm and before each search.
 *
 * Invariants:
 * - `getPlayerSnipeSelection` returns null when Paletools is disabled or the criteria type is set
 *   and is not `SearchType.PLAYER` (a null or missing type passes); the id comes from the
 *   player-name control (`getSelected()`) or else from the view model `playerData`, which must
 *   then match `criteria.maskedDefId`. Result `{ id: String, name }`.
 * - `getPlayerSnipeMaximum` accepts only a safe integer in 200..14,999,000 equal to
 *   `roundToValidPrice(max, 200)` (a valid market tick); otherwise null.
 */
import { configuration } from "../../config/configuration.js";
import { getPriceRowValue } from "../../market/price-inputs.js";
import { roundToValidPrice } from "../../market/prices.js";
import { getViewModel } from "../../webapp/navigation.js";

export function getPlayerSnipeSelection(view, controller) {
  if (!configuration.enabled || !view || !controller) {
    return null;
  }
  const criteria = getViewModel(controller)?.searchCriteria;
  if (criteria?.type != null && criteria.type !== SearchType.PLAYER) {
    return null;
  }
  const search = view._searchFilters?.getPlayerNameSearch();
  // The native market control can expose playerData through its model,
  // unlike the UTPlayerSearchControl used by other Paletools screens.
  const selected =
    typeof search?.getSelected === "function"
      ? search.getSelected()
      : getViewModel(controller)?.playerData;
  if (!Number.isSafeInteger(Number(selected?.id)) || Number(selected.id) <= 0) {
    return null;
  }
  if (
    typeof search?.getSelected !== "function" &&
    Number(criteria?.maskedDefId) !== Number(selected.id)
  ) {
    return null;
  }
  const player = repositories.Item.getStaticDataByDefId(selected.id) || selected;
  const name =
    player.name ||
    player.commonName ||
    [player.firstName, player.lastName].filter(Boolean).join(" ");
  return name
    ? {
        id: String(selected.id),
        name,
      }
    : null;
}

export function getPlayerSnipeMaximum(view) {
  const maxBuy = Number(getPriceRowValue(view._maxBuyNowPriceRow));
  return Number.isSafeInteger(maxBuy) &&
    maxBuy >= 200 &&
    maxBuy <= 14999000 &&
    roundToValidPrice(maxBuy, 200) === maxBuy
    ? maxBuy
    : null;
}
