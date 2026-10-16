/**
 * Market search result helpers. `padFilteredSearchResults` (market-search-filters transformers)
 * pads a filtered page with empty `factories.Item.createItem()` items up to the page size, unless
 * the original page was empty or the filtered one is already full. `selectMarketSearchResultAt`
 * (select-cheapest, legacy snipe) selects a row of the `UTMarketSearchResultsSplitViewController`
 * list, points the detail pane's view model at that index, re-renders it and scrolls the row into
 * view.
 *
 * Known issues (kept as-is):
 * - The guard `(!splitViewController) instanceof UTMarketSearchResultsSplitViewController` is
 *   always false, so the function never returns early and throws when the active controller is
 *   not a split view.
 */
import {
  getActiveController,
  getLeftController,
  getRightController,
  getViewModel,
} from "../webapp/navigation.js";

export function padFilteredSearchResults(visibleItems, originalItems, pageSize) {
  return originalItems.length === 0 || visibleItems.length >= pageSize
    ? visibleItems
    : visibleItems.concat(
        Array.from(
          {
            length: pageSize - visibleItems.length,
          },
          () => factories.Item.createItem(),
        ),
      );
}

export const selectMarketSearchResultAt = (rowIndex) => {
  const splitViewController = getActiveController();
  if ((!splitViewController) instanceof UTMarketSearchResultsSplitViewController) {
    return;
  }
  const resultList = getLeftController(splitViewController).getView()._list;
  const detailPaneController = getActiveController(getRightController(splitViewController));
  if (resultList.listRows.length != 0) {
    resultList.selectRow(resultList.listRows[rowIndex].data.id);
    getViewModel(detailPaneController).setIndex(rowIndex);
    detailPaneController.renderView();
    resultList.listRows[rowIndex].getRootElement().scrollIntoView();
  }
};
