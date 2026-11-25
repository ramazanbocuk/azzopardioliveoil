import { describe, expect, it } from "vitest";
import { LANGUAGES, LOCALE_CODES, browserLanguages, detectLocale, localeFor, localizePath, splitLocale, suggestedLocale, toLocale } from "@/i18n/config";
import { hasNoDecimals, isChargeable, roundToStep } from "@/i18n/currency";
import { allocateCents, computeTotals, discountAmount, taxBreakdown } from "@/server/pricing";
import { EMAIL_TEXT } from "@/i18n/emails";
import { fill, formatMoney, plural } from "@/i18n/format";
import { MESSAGES } from "@/i18n/messages";
import { ENGLISH_ONLY, alternatesFor } from "@/i18n/seo";

describe("choosing a locale for a visitor", () => {
  it("follows the order: earlier choice, browser language, country, English", () => {
    expect(detectLocale({ saved: "it-it", acceptLanguage: "de-DE", country: "FR" })).toBe("it-it");
    expect(detectLocale({ acceptLanguage: "de-DE,de;q=0.9,en;q=0.8", country: "FR" })).toBe("de-de");
    expect(detectLocale({ acceptLanguage: null, country: "DE" })).toBe("de-de");
    expect(detectLocale({ acceptLanguage: "pt", country: "ES" })).toBe("es-es");
    expect(detectLocale({ acceptLanguage: "pt", country: "PT" })).toBe("en");
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

  it("sends Korea, mainland China and Japan to their own language when the address has none", () => {
    expect(detectLocale({ acceptLanguage: "ko-KR,ko;q=0.9,en;q=0.8", country: "KR" })).toBe("ko-kr");
    expect(detectLocale({ acceptLanguage: "ja", country: "JP" })).toBe("ja-jp");
    expect(detectLocale({ acceptLanguage: "zh-CN,zh;q=0.9", country: "CN" })).toBe("zh-cn");
    expect(detectLocale({ acceptLanguage: null, country: "KR" })).toBe("ko-kr"); // no browser language: the country decides
    expect(detectLocale({ acceptLanguage: "en-US", country: "JP" })).toBe("en"); // an English browser in Japan reads English, and is offered Japanese on the page
    expect(detectLocale({ saved: "en", acceptLanguage: "ko", country: "KR" })).toBe("en"); // a choice made before wins
    expect(detectLocale({ acceptLanguage: "ja", country: "DE" })).toBe("ja-jp"); // the browser's language, wherever the visitor is
  });

  it("never gives Simplified Chinese to a browser that asks for Traditional", () => {
    expect(browserLanguages("zh-TW,zh;q=0.9,en;q=0.8")).toEqual(["zh", "en"]); // the bare "zh" that follows is still accepted
    expect(browserLanguages("zh-TW,en;q=0.8")).toEqual(["en"]);
    expect(browserLanguages("zh-Hant-HK")).toEqual([]);
    expect(browserLanguages("zh-Hans-CN")).toEqual(["zh"]);
    expect(detectLocale({ acceptLanguage: "zh-HK,en;q=0.5", country: "HK" })).toBe("en");
  });

  it("offers a language on the page without redirecting, once", () => {
    expect(suggestedLocale({ current: "en", country: "KR", chosen: null })).toBe("ko-kr");
    expect(suggestedLocale({ current: "de-de", country: "JP", chosen: null })).toBe("ja-jp");
    expect(suggestedLocale({ current: "en-us", country: "cn", chosen: null })).toBe("zh-cn");
    expect(suggestedLocale({ current: "ko-kr", country: "KR", chosen: null })).toBeNull(); // already reading Korean
    expect(suggestedLocale({ current: "en", country: "KR", chosen: "en" })).toBeNull(); // they chose English: never asked again
    expect(suggestedLocale({ current: "en", country: "DE", chosen: null })).toBeNull(); // Europe keeps its earlier rule
    expect(suggestedLocale({ current: "en", country: "TW", chosen: null })).toBeNull();
    expect(suggestedLocale({ current: "en", country: null, chosen: null })).toBeNull(); // unknown country: nothing is shown
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
    expect(Object.keys(all.languages ?? {}).sort()).toEqual(["de-DE", "en", "en-GB", "en-US", "es-ES", "fr-BE", "fr-FR", "it-IT", "ja-JP", "ko-KR", "nl-BE", "nl-NL", "x-default", "zh-CN"]);
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
  it("cover thirteen locales in nine languages", () => {
    expect(LOCALE_CODES).toEqual(["en", "en-gb", "en-us", "de-de", "nl-nl", "nl-be", "fr-fr", "fr-be", "it-it", "es-es", "ko-kr", "zh-cn", "ja-jp"]);
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
    expect(plural("ko-KR", 1, MESSAGES.ko.shop.count)).toBe("상품 1개");
    expect(plural("ja-JP", 3, MESSAGES.ja.shop.count)).toBe("3点");
    expect(plural("zh-CN", 2, MESSAGES.zh.shop.count)).toBe("2 件商品");
  });

  it("writes Chinese in Simplified characters only", () => {
    const flat = (value: unknown): string[] => (typeof value === "string" ? [value] : Object.values(value as object).flatMap(flat));
    // Common characters whose Traditional form differs. Not a proof, but it catches a pasted Traditional sentence.
    expect(flat(MESSAGES.zh).join("").match(/[訂單購買帳戶運費貨國語個們這優碼聯繫電郵]/g)).toBeNull();
  });
});

describe("yen and won, which have no smaller coin", () => {
  it("are stored in hundredths like every currency, and shown without decimals", () => {
    expect(hasNoDecimals("JPY")).toBe(true);
    expect(hasNoDecimals("KRW")).toBe(true);
    expect(hasNoDecimals("CNY")).toBe(false);
    expect(formatMoney("ja-JP", 480000, "JPY")).toMatch(/^[¥￥]4,800$/);
    expect(formatMoney("ko-KR", 4500000, "KRW")).toBe("₩45,000");
    expect(formatMoney("zh-CN", 26800, "CNY")).toMatch(/^[¥￥]268\.00$/);
    expect(formatMoney("en", 480000, "JPY")).toBe("¥4,800");
  });

  it("can only be charged in whole units", () => {
    expect(isChargeable(480000, "JPY")).toBe(true);
    expect(isChargeable(480050, "JPY")).toBe(false);
    expect(isChargeable(480050, "CNY")).toBe(true);
    expect(isChargeable(1999, "EUR")).toBe(true);
    expect(roundToStep(43200.5, "JPY")).toBe(43200);
    expect(roundToStep(43250, "KRW")).toBe(43300);
    expect(roundToStep(1234.5, "EUR")).toBe(1235);
  });

  it("round a percentage and the tax inside a price to whole units, and still add up", () => {
    const lines = [{ unitPriceCents: 485000, quantity: 1, weightGrams: 900 }, { unitPriceCents: 298000, quantity: 2, weightGrams: 500 }];
    const fifteen = { code: "TRADE", kind: "PERCENT" as const, value: 12.5, minSubtotalCents: 0, startsAt: null, endsAt: null, usageLimit: null, usedCount: 0, isActive: true };
    expect(discountAmount(fifteen, 1081000, "JPY").discountCents).toBe(135100); // 1,351.25 yen becomes 1,351
    expect(discountAmount(fifteen, 1081000, "EUR").discountCents).toBe(135125); // a euro amount keeps its cents

    const totals = computeTotals({ lines, discount: fifteen, shippingCents: 150000, taxRateBps: 800, currency: "JPY" });
    expect(totals.totalCents).toBe(1081000 - 135100 + 150000);
    expect(isChargeable(totals.totalCents, "JPY")).toBe(true);
    expect(isChargeable(totals.taxCents ?? 1, "JPY")).toBe(true);

    const parts = taxBreakdown({ lines, discountCents: totals.discountCents, shippingCents: 150000, taxRateBps: 800, currency: "JPY" });
    expect(parts.lineNetCents.reduce((a, b) => a + b, 0)).toBe(1081000 - 135100);
    expect((parts.shippingTaxCents ?? 0) + parts.lineTaxCents.reduce((a: number, b) => a + (b ?? 0), 0)).toBe(totals.taxCents);
    for (const amount of [...parts.lineNetCents, ...parts.lineTaxCents, parts.shippingTaxCents]) expect(isChargeable(amount ?? 0, "JPY")).toBe(true);
    expect(allocateCents(1000, [1, 1, 1], 100)).toEqual([400, 300, 300]);
    expect(allocateCents(1000, [1, 1, 1])).toEqual([334, 333, 333]); // other currencies are split to the cent, as before
  });
});
