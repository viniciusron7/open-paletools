/**
 * UI text lookup: `translate(key, params)` and `formatNumber` (EA's localized number format).
 * The language tables are src/i18n/{en,es,it,pt,de,fr}.js; `translate` is imported by almost
 * every UI module and plugin.
 *
 * Invariants:
 * - Lookup order: the table of `services.Localization.locale.language`, then English, then EA's
 *   `services.Localization.localize(key, params)` with a leading '*' stripped, so EA keys can be
 *   passed too. Empty strings count as missing.
 * - `params` only reach EA's localize; Paletools strings are returned without substitution.
 * - It reads `services.Localization` on every call and throws if the Web App has not created it
 *   yet.
 * - Keys (e.g. 'plugins.<name>.settings.title') are referenced by name from the code. The
 *   tables are not parallel: each other table lacks many of the English keys (e.g. all
 *   'plugins.priceTracker.*'), which `translate` then takes from English.
 *   Misspelled keys such as 'plugins.sbcBuilderEnhacer.settings.title' exist in all six tables.
 */
import { germanTranslations } from "./de.js";
import { englishTranslations } from "./en.js";
import { spanishTranslations } from "./es.js";
import { frenchTranslations } from "./fr.js";
import { italianTranslations } from "./it.js";
import { portugueseTranslations } from "./pt.js";

const translations = {
  en: englishTranslations,
  es: spanishTranslations,
  it: italianTranslations,
  pt: portugueseTranslations,
  de: germanTranslations,
  fr: frenchTranslations,
};

export function translate(translationKey, localizationParams) {
  const language = services.Localization.locale.language;
  if (translations[language] && translations[language][translationKey]) {
    return translations[language][translationKey];
  }
  if (translations.en[translationKey]) {
    return translations.en[translationKey];
  }
  const localizedText = services.Localization.localize(translationKey, localizationParams);
  return localizedText.length > 1 && localizedText.charAt(0) === "*"
    ? localizedText.substring(1)
    : localizedText;
}

export function formatNumber(numericValue) {
  return services.Localization.localizeNumber(numericValue);
}
