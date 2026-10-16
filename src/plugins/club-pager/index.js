/**
 * Club pager plugin `clubPagerPlugin` (order 5), installed by the plugin list in
 * src/bootstrap/boot.js: sets the page size of club player searches to 20, 50, 100 or 150.
 *
 * Hooks:
 * - After-hook (`hookPrototypeMethod`) on
 *   `UTClubSearchResultsViewController.initWithSearchCriteria`, registered in `run()`.
 *
 * Invariants:
 * - Applies only when `configuration.enabled && clubPager.enabled` and the criteria type is
 *   `SearchType.PLAYER`; sets `clubViewModel.numItemsPerPage` and
 *   `searchCriteria.count = Math.min(pageSize + 1, 150)` (page size plus one, except 150 which
 *   requests exactly 150).
 * - `clubPager.pageSize` values outside `clubPagerPageSizes` fall back to 20.
 * - Controllers that never call `initWithSearchCriteria` (e.g. the album) are not affected.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { hookPrototypeMethod } from "../../core/prototype-override.js";
import { appendDropdown, appendToggle } from "../../ui/settings-controls.js";

let clubPagerPluginDefinition;

const clubPagerSettings = configuration.plugins.clubPager;

const clubPagerPageSizes = [20, 50, 100, 150];

function getClubPagerPageSize() {
  const pageSize = Number(clubPagerSettings.pageSize);
  return clubPagerPageSizes.includes(pageSize) ? pageSize : 20;
}

clubPagerPluginDefinition = {
  run: function () {
    hookPrototypeMethod(
      UTClubSearchResultsViewController,
      "initWithSearchCriteria",
      null,
      function () {
        (function (controller) {
          if (
            !configuration.enabled ||
            !clubPagerSettings.enabled ||
            controller.searchCriteria?.type !== SearchType.PLAYER
          ) {
            return;
          }
          const numItemsPerPage = getClubPagerPageSize();
          controller.clubViewModel.numItemsPerPage = numItemsPerPage;
          controller.searchCriteria.count = Math.min(numItemsPerPage + 1, 150);
        })(this);
      },
    );
  },
  order: 5,
  settings: {
    name: "club-pager",
    title: "plugins.clubPager.settings.title",
    menu: function () {
      const menuContainer = document.createElement("div");
      appendToggle(menuContainer, "enabled", clubPagerSettings.enabled, (isEnabled) => {
        clubPagerSettings.enabled = isEnabled;
        persistConfiguration();
      });
      appendDropdown(
        menuContainer,
        "plugins.clubPager.settings.pageSize",
        clubPagerPageSizes.map((pageSize) => ({
          label: String(pageSize),
          value: String(pageSize),
        })),
        String(getClubPagerPageSize()),
        (selectedPageSize) => {
          clubPagerSettings.pageSize = Number(selectedPageSize);
          persistConfiguration();
        },
      );
      return menuContainer;
    },
  },
};

export const clubPagerPlugin = clubPagerPluginDefinition;
