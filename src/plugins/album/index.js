/**
 * Album plugin definition `albumPlugin` (order 10004), installed by the plugin list in
 * src/bootstrap/boot.js: adds an Album tile to the home hub that pushes `AlbumViewController`;
 * the settings menu holds the enable toggle and `buyEnabled` (the Buy button, 27.2.1, off by
 * default; switching it on asks `plugins.dangerous` and stays off if not confirmed).
 *
 * Hooks:
 * - Only if `configuration.enabled && album.enabled` at `run()`: after-hook
 *   (`hookPrototypeMethod`) on `UTHomeHubView._generate` that inserts `this._albumTile` after
 *   `this._sbcTile`; the same branch upserts stylesheet `paletools-album` and registers the album
 *   cache invalidation.
 *
 * Invariants:
 * - The gallery tile is inserted after `this._albumTile`, so this hook must be registered before
 *   the gallery's (order 10004 < 10005).
 * - The hook does not re-check the flags: disabling the album at runtime keeps the tile until
 *   reload (the controller then shows the `disabled` status).
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { addClasses, createElement, insertAfter } from "../../core/dom.js";
import { hookPrototypeMethod } from "../../core/prototype-override.js";
import { translate } from "../../i18n/translations.js";
import { registerAlbumCacheInvalidation } from "./album-data.js";
import { AlbumViewController } from "./album-view-controller.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { getActiveNavigationController } from "../../webapp/navigation.js";
import albumStyles from "./album.css";

let albumPluginDefinition;

const albumSettings = configuration.plugins.album;

albumPluginDefinition = {
  run: function () {
    if (configuration.enabled && albumSettings.enabled) {
      upsertStylesheet("paletools-album", albumStyles);
      registerAlbumCacheInvalidation();
      hookPrototypeMethod(UTHomeHubView, "_generate", null, function (...generateArguments) {
        this._albumTile = new UTGraphicalInfoTileView();
        this._albumTile.init();
        this._albumTile.title = translate("plugins.album.settings.title");
        this._albumTile.addTarget(
          this,
          () => {
            const albumController = new AlbumViewController();
            albumController.init();
            getActiveNavigationController().pushViewController(albumController);
          },
          EventType.TAP,
        );
        const tileColumns = configuration.plugins.album.enabled ? 2 : 1;
        addClasses(this._albumTile, "col-1-" + tileColumns, "ut-tile-album");
        insertAfter(this._albumTile, this._sbcTile);
      });
    }
  },
  order: 10004,
  settings: {
    name: "album",
    title: "plugins.album.settings.title",
    menu: function () {
      const menuContainer = createElement("div");
      appendToggle(menuContainer, "enabled", albumSettings.enabled, (isEnabled) => {
        albumSettings.enabled = isEnabled;
        persistConfiguration();
      });
      appendToggle(
        menuContainer,
        "plugins.album.settings.buyEnabled",
        albumSettings.buyEnabled,
        (isEnabled) => {
          if (isEnabled && !confirm(translate("plugins.dangerous"))) {
            return false;
          }
          albumSettings.buyEnabled = isEnabled;
          persistConfiguration();
        },
      );
      return menuContainer;
    },
  },
};

export const albumPlugin = albumPluginDefinition;
