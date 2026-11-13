/**
 * Languages and locales of the storefront.
 *
 * Three things are deliberately separate and never derived from one another
 * after the first visit:
 *   - the LOCALE in the address (/de-de/…): which language the pages are in
 *     and how dates and numbers are written;
 *   - the DELIVERY COUNTRY: where the parcel goes, chosen by the customer;
 *   - the visitor's own country, used once to suggest a locale.
 *
 * This file has no server dependencies: the proxy, the server and the
 * browser all import it.
 */

export const LANGUAGES = ["en", "de", "nl", "fr", "it", "es"] as const;
export type Language = (typeof LANGUAGES)[number];

/** What each language calls itself. */
export const LANGUAGE_NAME: Record<Language, string> = { en: "English", de: "Deutsch", nl: "Nederlands", fr: "Français", it: "Italiano", es: "Español" };

type LocaleInfo = {
  language: Language;
  /** BCP 47 tag for Intl formatting and the hreflang attribute. */
  tag: string;
  /** Shown in the selector, in the locale's own language. */
  label: string;
  /** The country this locale is the regional variant for; null for the international one. */
  country: string | null;
};

/** The address prefixes, in the order the selector lists them. "en" is the international fallback. */
export const LOCALES = {
  en: { language: "en", tag: "en", label: "English (International)", country: null },
  "en-gb": { language: "en", tag: "en-GB", label: "English (United Kingdom)", country: "GB" },
  "en-us": { language: "en", tag: "en-US", label: "English (United States)", country: "US" },
  "de-de": { language: "de", tag: "de-DE", label: "Deutsch (Deutschland)", country: "DE" },
  "nl-nl": { language: "nl", tag: "nl-NL", label: "Nederlands (Nederland)", country: "NL" },
  "nl-be": { language: "nl", tag: "nl-BE", label: "Nederlands (België)", country: "BE" },
  "fr-fr": { language: "fr", tag: "fr-FR", label: "Français (France)", country: "FR" },
  "fr-be": { language: "fr", tag: "fr-BE", label: "Français (Belgique)", country: "BE" },
  "it-it": { language: "it", tag: "it-IT", label: "Italiano (Italia)", country: "IT" },
  "es-es": { language: "es", tag: "es-ES", label: "Español (España)", country: "ES" },
} as const satisfies Record<string, LocaleInfo>;

export type Locale = keyof typeof LOCALES;
export const LOCALE_CODES = Object.keys(LOCALES) as Locale[];
export const DEFAULT_LOCALE: Locale = "en";

export const isLocale = (value: string | undefined | null): value is Locale => !!value && Object.hasOwn(LOCALES, value);
export const isLanguage = (value: string | undefined | null): value is Language => !!value && (LANGUAGES as readonly string[]).includes(value);
export const languageOf = (locale: Locale): Language => LOCALES[locale].language;
export const tagOf = (locale: Locale): string => LOCALES[locale].tag;

/** Stored preference (customer account, order, newsletter) → a locale. Accepts a locale or a bare language; anything else is English. */
export function toLocale(value: string | null | undefined): Locale {
  const lower = value?.toLowerCase();
  if (isLocale(lower)) return lower;
  const language = lower?.slice(0, 2);
  return isLanguage(language) ? localeFor(language, null) : DEFAULT_LOCALE;
}

/** Remembers an explicit choice in the selector. Detection never writes it. */
export const LOCALE_COOKIE = "azz_locale";
/** The delivery country the visitor chose. Independent of the language. */
export const SHIP_COOKIE = "azz_ship";
/** The visitor's country as the host reported it, kept so the page can offer Belgium its languages. */
export const COUNTRY_COOKIE = "azz_country";
export const ONE_YEAR = 60 * 60 * 24 * 365;

/** The locale for a language in a country: the regional variant if there is one, otherwise the language's main one. */
export function localeFor(language: Language, country: string | null): Locale {
  const regional = LOCALE_CODES.find((code) => LOCALES[code].language === language && LOCALES[code].country === country);
  if (regional) return regional;
  const main: Record<Language, Locale> = { en: "en", de: "de-de", nl: "nl-nl", fr: "fr-fr", it: "it-it", es: "es-es" };
  return main[language];
}

/** Languages a country is offered when nothing else is known. Belgium has two and no default between them. */
const COUNTRY_LANGUAGES: Record<string, Language[]> = { US: ["en"], GB: ["en"], DE: ["de"], AT: ["de"], NL: ["nl"], BE: ["fr", "nl"], FR: ["fr"], IT: ["it"], ES: ["es"] };
export const languagesOfCountry = (country: string | null): Language[] => (country ? (COUNTRY_LANGUAGES[country] ?? []) : []);

/** Languages from an Accept-Language header, best first. */
export function browserLanguages(header: string | null | undefined): Language[] {
  if (!header) return [];
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { language: tag.trim().slice(0, 2).toLowerCase(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  return [...new Set(ranked.map((entry) => entry.language))].filter(isLanguage);
}

/**
 * Which locale to suggest to a visitor who arrives without one in the address.
 *   1. the choice they made before (cookie; a signed-in customer's saved language is copied into it),
 *   2. their browser's language,
 *   3. their country's language,
 *   4. English.
 * Belgium with a browser set to neither French nor Dutch gets international
 * English and is asked on the page; no language is picked for them.
 */
export function detectLocale(input: { saved?: string | null; acceptLanguage?: string | null; country?: string | null }): Locale {
  if (isLocale(input.saved)) return input.saved;
  const country = input.country?.toUpperCase() || null;
  const fromBrowser = browserLanguages(input.acceptLanguage)[0];
  if (fromBrowser) return localeFor(fromBrowser, country);
  const offered = languagesOfCountry(country);
  if (offered.length === 1) return localeFor(offered[0], country);
  return DEFAULT_LOCALE;
}

/** Splits "/de-de/shop" into its locale and the rest ("/shop"). A path without a locale returns null for it. */
export function splitLocale(pathname: string): { locale: Locale | null; path: string } {
  const [, first = "", ...rest] = pathname.split("/");
  if (!isLocale(first)) return { locale: null, path: pathname || "/" };
  return { locale: first, path: `/${rest.join("/")}`.replace(/\/$/, "") || "/" };
}

/** "/shop" in a locale → "/de-de/shop". External links, anchors and files are returned untouched. */
export function localizePath(locale: Locale, href: string): string {
  if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/api/") || href.startsWith("/admin") || href.startsWith("/media/")) return href;
  const { path } = splitLocale(href.split(/[?#]/)[0]);
  const tail = href.slice(href.split(/[?#]/)[0].length);
  return `/${locale}${path === "/" ? "" : path}${tail}`;
}
