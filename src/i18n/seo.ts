import type { Metadata } from "next";
import { DEFAULT_LOCALE, LANGUAGES, LOCALES, LOCALE_CODES, languageOf, localizePath, type Language, type Locale } from "./config";

/**
 * Canonical address and language alternates (hreflang) for a page.
 *
 * `languages` lists the languages the page's own text really exists in.
 * A page shown in English inside a German address is not a German page:
 * it points its canonical at the English one and is left out of the
 * alternates, so search engines are never told a translation exists when it
 * does not.
 */
export function alternatesFor(locale: Locale, path: string, languages: readonly Language[] = LANGUAGES): NonNullable<Metadata["alternates"]> {
  const available = LOCALE_CODES.filter((code) => languages.includes(languageOf(code)));
  const self = available.includes(locale) ? locale : DEFAULT_LOCALE;
  return {
    canonical: localizePath(self, path),
    languages: {
      ...Object.fromEntries(available.map((code) => [LOCALES[code].tag, localizePath(code, path)])),
      "x-default": localizePath(DEFAULT_LOCALE, path),
    },
  };
}

/** Pages whose text has not been translated yet. */
export const ENGLISH_ONLY: readonly Language[] = ["en"];
