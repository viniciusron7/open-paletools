/**
 * Gallery plugin definition `galleryPlugin` (order 10005), installed by the plugin list in
 * src/bootstrap/boot.js: injects the album and gallery styles and adds a Gallery home-hub tile
 * and a settings button that open the gallery (`openGallery`). The settings also hold
 * `buyEnabled` (the Buy button of the album view, 27.2.1, off by default; switching it on asks
 * `plugins.dangerous` and stays off if not confirmed).
 *
 * Hooks:
 * - After-hook (`hookPrototypeMethod`) on `UTHomeHubView._generate`, always registered in `run()`
 *   (flags checked at generate time): inserts the tile once per view (`_paletoolsGalleryTile`)
 *   after `this._albumTile` (set by the album hook, registered first) or `this._sbcTile`.
 *
 * Invariants:
 * - `openGallery` decodes the bundled `gallery-data.json.gz` (base64 -> gzip
 *   `DecompressionStream` -> JSON) once, memoized in `galleryDataLoadPromise`; on failure the
 *   memo is reset so the next open retries; categories/bonus tags are pushed only on success.
 * - `isGalleryOpening` prevents concurrent opens; the loading shield is hidden in `finally`.
 * - Stylesheet ids `paletools-album` (shared with the album plugin) and `paletools-gallery`; the
 *   tile gets `ut-tile-gallery` and `col-1-2` when the album is enabled, else `col-1-1`.
 */
import { configuration, persistConfiguration } from "../../config/configuration.js";
import { addClasses, appendElements, createElement, insertAfter } from "../../core/dom.js";
import { hookPrototypeMethod } from "../../core/prototype-override.js";
import { translate } from "../../i18n/translations.js";
import {
  galleryBonusTags,
  galleryCategories,
  registerGalleryCacheInvalidation,
} from "./gallery-data.js";
import { GalleryViewController } from "./gallery-view-controller.js";
import { showErrorNotification } from "../../ui/notifications.js";
import { appendToggle } from "../../ui/settings-controls.js";
import { upsertStylesheet } from "../../ui/stylesheets.js";
import { hideLoadingShield, showLoadingShield } from "../../webapp/loading-shield.js";
import { getActiveNavigationController } from "../../webapp/navigation.js";
import albumStyles from "../album/album.css";
import compressedGalleryData from "./gallery-data.json.gz";
import galleryCss from "./gallery.css";

let galleryDataLoadPromise;

let galleryPluginDefinition;

const gallerySettings = configuration.plugins.gallery;

let isGalleryOpening = false;

async function openGallery() {
  if (configuration.enabled && gallerySettings.enabled && !isGalleryOpening) {
    isGalleryOpening = true;
    showLoadingShield();
    try {
      await (galleryDataLoadPromise ||
        (galleryDataLoadPromise = (async function (base64Data) {
          const bytes = Uint8Array.from(atob(base64Data), (character) => character.charCodeAt(0));
          const decompressedStream = new Blob([bytes])
            .stream()
            .pipeThrough(new DecompressionStream("gzip"));
          return new Response(decompressedStream).json();
        })(compressedGalleryData)
          .then((galleryData) => {
            galleryCategories.push(...galleryData.categories);
            galleryBonusTags.push(...galleryData.bonusTags);
          })
          .catch((error) => {
            galleryDataLoadPromise = null;
            throw error;
          })),
      galleryDataLoadPromise);
      if (!configuration.enabled || !gallerySettings.enabled) {
        return;
      }
      const galleryController = new GalleryViewController();
      galleryController.init();
      getActiveNavigationController().pushViewController(galleryController);
    } catch {
      showErrorNotification(translate("plugins.gallery.error"));
    } finally {
      isGalleryOpening = false;
      hideLoadingShield();
    }
  }
}

galleryPluginDefinition = {
  run: function () {
    registerGalleryCacheInvalidation();
    upsertStylesheet("paletools-album", albumStyles);
    upsertStylesheet("paletools-gallery", galleryCss);
    hookPrototypeMethod(UTHomeHubView, "_generate", null, function () {
      if (!configuration.enabled || !gallerySettings.enabled || this._paletoolsGalleryTile) {
        return;
      }
      const paletoolsGalleryTile = new UTGraphicalInfoTileView();
      paletoolsGalleryTile.init();
      paletoolsGalleryTile.title = translate("plugins.gallery.settings.title");
      paletoolsGalleryTile.addTarget(this, openGallery, EventType.TAP);
      addClasses(
        paletoolsGalleryTile,
        "col-1-" + (configuration.plugins.album.enabled ? 2 : 1),
        "ut-tile-gallery",
      );
      insertAfter(paletoolsGalleryTile, this._albumTile || this._sbcTile);
      this._paletoolsGalleryTile = paletoolsGalleryTile;
    });
  },
  order: 10005,
  settings: {
    name: "gallery",
    title: "plugins.gallery.settings.title",
    menu: function () {
      const menuContainer = createElement("div");
      appendToggle(menuContainer, "enabled", gallerySettings.enabled, (isEnabled) => {
        gallerySettings.enabled = isEnabled;
        persistConfiguration();
      });
      appendToggle(
        menuContainer,
        "plugins.gallery.settings.buyEnabled",
        gallerySettings.buyEnabled,
        (isEnabled) => {
          if (isEnabled && !confirm(translate("plugins.dangerous"))) {
            return false;
          }
          gallerySettings.buyEnabled = isEnabled;
          persistConfiguration();
        },
      );
      const openButton = createElement("button", {
        className: "btn-standard",
        type: "button",
      });
      openButton.textContent = translate("plugins.gallery.open");
      openButton.addEventListener("click", openGallery);
      appendElements(menuContainer, openButton);
      return menuContainer;
    },
  },
};

export const galleryPlugin = galleryPluginDefinition;
