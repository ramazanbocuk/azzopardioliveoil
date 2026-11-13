import { describe, expect, it } from "vitest";
import { LANGUAGES, LOCALE_CODES, browserLanguages, detectLocale, localeFor, localizePath, splitLocale, toLocale } from "@/i18n/config";
import { EMAIL_TEXT } from "@/i18n/emails";
import { fill, formatMoney, plural } from "@/i18n/format";
import { MESSAGES } from "@/i18n/messages";
import { ENGLISH_ONLY, alternatesFor } from "@/i18n/seo";

describe("choosing a locale for a visitor", () => {
  it("follows the order: earlier choice, browser language, country, English", () => {
    expect(detectLocale({ saved: "it-it", acceptLanguage: "de-DE", country: "FR" })).toBe("it-it");
    expect(detectLocale({ acceptLanguage: "de-DE,de;q=0.9,en;q=0.8", country: "FR" })).toBe("de-de");
    expect(detectLocale({ acceptLanguage: null, country: "DE" })).toBe("de-de");
    expect(detectLocale({ acceptLanguage: "ja", country: "ES" })).toBe("es-es");
    expect(detectLocale({ acceptLanguage: "ja", country: "JP" })).toBe("en");
    expect(detectLocale({})).toBe("en");
    expect(detectLocale({ saved: "klingon", acceptLanguage: "nl" })).toBe("nl-nl"); // a tampered cookie is ignored
  });

  it("gives each market its regional variant", () => {
    expect(detectLocale({ acceptLanguage: "en-US", country: "US" })).toBe("en-us");
    expect(detectLocale({ acceptLanguage: "en-GB", country: "GB" })).toBe("en-gb");
    expect(detectLocale({ acceptLanguage: "en", country: "DE" })).toBe("en"); // an English browser in Germany reads English
    expect(detectLocale({ acceptLanguage: "nl", country: "NL" })).toBe("nl-nl");
    expect(detectLocale({ acceptLanguage: "fr", country: "FR" })).toBe("fr-fr");
  });

  it("never picks between French and Dutch for Belgium", () => {
    expect(detectLocale({ acceptLanguage: "fr-BE", country: "BE" })).toBe("fr-be");
    expect(detectLocale({ acceptLanguage: "nl-BE", country: "BE" })).toBe("nl-be");
    expect(detectLocale({ acceptLanguage: "en", country: "BE" })).toBe("en");
    expect(detectLocale({ acceptLanguage: null, country: "BE" })).toBe("en"); // asked on the page instead
  });

  it("reads Accept-Language by weight and ignores languages it does not have", () => {
    expect(browserLanguages("pt-BR,pt;q=0.9,es;q=0.6,en;q=0.7")).toEqual(["en", "es"]);
    expect(browserLanguages("de;q=0,fr")).toEqual(["fr"]);
    expect(browserLanguages("")).toEqual([]);
  });

  it("turns stored preferences into a locale", () => {
    expect(toLocale("de-de")).toBe("de-de");
    expect(toLocale("DE-DE")).toBe("de-de");
    expect(toLocale("fr")).toBe("fr-fr");
    expect(toLocale("en")).toBe("en"); // orders placed before languages existed
    expect(toLocale(null)).toBe("en");
    expect(localeFor("nl", "BE")).toBe("nl-be");
  });
});

describe("addresses", () => {
  it("adds and reads the locale without touching anything else", () => {
    expect(localizePath("de-de", "/shop")).toBe("/de-de/shop");
    expect(localizePath("de-de", "/")).toBe("/de-de");
    expect(localizePath("fr-be", "/products/oil?size=750#details")).toBe("/fr-be/products/oil?size=750#details");
    expect(localizePath("nl-nl", "/en/shop")).toBe("/nl-nl/shop"); // switching language keeps the page
    for (const untouched of ["/admin/orders", "/api/graphql", "/media/abc", "https://example.com/x", "#top", "mailto:a@b.co"]) expect(localizePath("de-de", untouched)).toBe(untouched);
    expect(splitLocale("/it-it/cart")).toEqual({ locale: "it-it", path: "/cart" });
    expect(splitLocale("/es-es")).toEqual({ locale: "es-es", path: "/" });
    expect(splitLocale("/shop")).toEqual({ locale: null, path: "/shop" });
    expect(splitLocale("/english/shop").locale).toBeNull();
  });

  it("announces a translation to search engines only where one exists", () => {
    const all = alternatesFor("de-de", "/shop");
    expect(all.canonical).toBe("/de-de/shop");
    expect(Object.keys(all.languages ?? {}).sort()).toEqual(["de-DE", "en", "en-GB", "en-US", "es-ES", "fr-BE", "fr-FR", "it-IT", "nl-BE", "nl-NL", "x-default"]);
    expect(all.languages?.["x-default"]).toBe("/en/shop");

    const english = alternatesFor("de-de", "/faq", ENGLISH_ONLY);
    expect(english.canonical).toBe("/en/faq"); // the German address shows English text, so it is not the canonical page
    expect(Object.keys(english.languages ?? {}).sort()).toEqual(["en", "en-GB", "en-US", "x-default"]);

    const partly = alternatesFor("fr-be", "/products/oil", ["en", "fr"]);
    expect(partly.canonical).toBe("/fr-be/products/oil");
    expect(Object.keys(partly.languages ?? {})).not.toContain("de-DE");
  });
});

/** Every {placeholder} in a nested dictionary, keyed by the path to its string. */
function placeholders(value: unknown, path = ""): Record<string, string[]> {
  if (typeof value === "string") return { [path]: [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort() };
  return Object.assign({}, ...Object.entries(value as object).map(([key, child]) => placeholders(child, `${path}.${key}`)));
}

describe("the dictionaries", () => {
  it("cover ten locales in six languages", () => {
    expect(LOCALE_CODES).toEqual(["en", "en-gb", "en-us", "de-de", "nl-nl", "nl-be", "fr-fr", "fr-be", "it-it", "es-es"]);
    expect(Object.keys(MESSAGES).sort()).toEqual([...LANGUAGES].sort());
  });

  it.each(LANGUAGES.filter((language) => language !== "en"))("%s keeps every placeholder of the English text, and leaves nothing empty", (language) => {
    expect(placeholders(MESSAGES[language])).toEqual(placeholders(MESSAGES.en));
    expect(placeholders(EMAIL_TEXT[language])).toEqual(placeholders(EMAIL_TEXT.en));
    const empty = (value: unknown): boolean => (typeof value === "string" ? value.trim() === "" : Object.values(value as object).some(empty));
    expect(empty(MESSAGES[language])).toBe(false);
    expect(empty(EMAIL_TEXT[language])).toBe(false);
  });

  it.each(LANGUAGES.filter((language) => language !== "en"))("%s is actually translated, not a copy of English", (language) => {
    const flat = (value: unknown): string[] => (typeof value === "string" ? [value] : Object.values(value as object).flatMap(flat));
    const english = flat({ ...MESSAGES.en, server: {} });
    const other = flat({ ...MESSAGES[language], server: {} });
    const same = other.filter((text, index) => text === english[index]).length;
    expect(same / other.length).toBeLessThan(0.12); // a few words are legitimately identical ("Menu", "Total", "Cookies")
  });

  it("formats counts, money and placeholders per locale", () => {
    expect(plural("en", 1, MESSAGES.en.shop.count)).toBe("1 bottle");
    expect(plural("de-DE", 3, MESSAGES.de.shop.count)).toBe("3 Flaschen");
    expect(plural("fr-FR", 0, MESSAGES.fr.shop.count)).toBe("0 bouteille"); // French counts zero as singular
    expect(fill("Lot {lot} for {name}", { lot: "AZ-1" })).toBe("Lot AZ-1 for {name}");
    expect(formatMoney("en", 3200)).toBe("€32.00");
    expect(formatMoney("de-DE", 3200).replace(/\s/g, " ")).toBe("32,00 €");
  });
});
