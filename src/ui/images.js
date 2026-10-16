/**
 * Image URLs used by the UI: assets embedded by the build from src/assets/images (logos, captain,
 * donation buttons, FUT.GG icon, hideout image) plus one remote EA shield URL. Read by the
 * settings, donation and player-picks plugins and by src/market/external-prices/index.js.
 *
 * Invariants:
 * - Consumers read the keys `logosvg`, `logosvgtext`, `captain`, `paleJesus`, `paypal` and
 *   `mercadoPago`; `genericShield` and `futggIcon` have no reader in src/.
 * - `genericShield` is a remote EA Web App URL (es-es path), not a bundled asset.
 */
import captainImage from "../assets/images/captain.webp";
import futggIconImage from "../assets/images/futgg-icon.png";
import mercadoPagoImage from "../assets/images/mercado-pago.webp";
import paleJesusImage from "../assets/images/pale-jesus.webp";
import paletoolsLogoTextImage from "../assets/images/paletools-logo-text.svg";
import paletoolsLogoImage from "../assets/images/paletools-logo.svg";
import paypalImage from "../assets/images/paypal.webp";

export const paletoolsImages = {
  logosvg: paletoolsLogoImage,
  logosvgtext: paletoolsLogoTextImage,
  captain: captainImage,
  genericShield:
    "https://www.ea.com/es-es/ea-sports-fc/ultimate-team/web-app/images/dynamicObjectives/generic.png",
  paypal: paypalImage,
  mercadoPago: mercadoPagoImage,
  futggIcon: futggIconImage,
  paleJesus: paleJesusImage,
};
