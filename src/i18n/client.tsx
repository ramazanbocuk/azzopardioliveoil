"use client";

import { createContext, use, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { LOCALES, SHIP_COOKIE, languageOf, localizePath, tagOf, type Language, type Locale } from "./config";
import { marketOf, type Currency, type MarketRule } from "./currency";
import { fill, formatDate, formatMoney, plural } from "./format";
import type { Messages, Plural } from "./messages/en";

type Value = { locale: Locale; messages: Messages; markets: MarketRule[] };
const I18nContext = createContext<Value | null>(null);

/** Hands the page's locale and interface text to client components. Rendered once, in the root layout. */
export function I18nProvider({ locale, messages, markets, children }: Value & { children: ReactNode }) {
  const value = useMemo(() => ({ locale, messages, markets }), [locale, messages, markets]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

export type I18n = {
  locale: Locale;
  language: Language;
  tag: string;
  m: Messages;
  /** "/shop" → "/de-de/shop". */
  href: (path: string) => string;
  fill: typeof fill;
  plural: (count: number, forms: Plural, values?: Record<string, string | number>) => string;
  /** The currency of the country the visitor has things delivered to. Prices on the page are shown in it. */
  currency: Currency;
  /** Formats an amount. Pass the currency for anything that carries its own (a cart, an order); otherwise the visitor's is used. */
  money: (cents: number, currency?: string) => string;
  /** What a size costs in the visitor's currency, or null when it is not sold there. Never a conversion. */
  price: (variant: { prices: Record<string, number> }) => number | null;
  date: (value: string | Date, options?: Intl.DateTimeFormatOptions) => string;
  /** A message the server wrote in English, in the reader's language when a translation exists. */
  server: (english: string) => string;
};

export function useI18n(): I18n {
  const value = use(I18nContext);
  if (!value) throw new Error("useI18n must be used inside the storefront layout.");
  // The delivery country the visitor chose; until the page has loaded, and when none was chosen, the country its address names.
  const shipTo = useSyncExternalStore(subscribeShipTo, readShipTo, () => null);
  return useMemo(() => {
    const currency = marketOf(value.markets, shipTo ?? LOCALES[value.locale].country).currency;
    const tag = tagOf(value.locale);
    const known = value.messages.server as Record<string, string>;
    return {
      locale: value.locale,
      language: languageOf(value.locale),
      tag,
      m: value.messages,
      href: (path) => localizePath(value.locale, path),
      fill,
      plural: (count, forms, values) => plural(tag, count, forms, values),
      currency,
      money: (cents, other) => formatMoney(tag, cents, other ?? currency),
      price: (variant) => variant.prices[currency] ?? null,
      date: (date, options) => formatDate(tag, date, options),
      server: (english) => known[english] ?? english,
    };
  }, [value, shipTo]);
}

const SHIP_EVENT = "azz:ship";
const readShipTo = () => document.cookie.match(new RegExp(`(?:^|; )${SHIP_COOKIE}=([A-Z]{2})`))?.[1] ?? null;
function subscribeShipTo(listener: () => void) {
  window.addEventListener(SHIP_EVENT, listener);
  return () => window.removeEventListener(SHIP_EVENT, listener);
}

/** Remembers the delivery country on this device and reprices the page. It holds no secret, so scripts may read it. */
export function rememberShipTo(country: string) {
  if (!/^[A-Z]{2}$/.test(country) || readShipTo() === country) return;
  document.cookie = `${SHIP_COOKIE}=${country}; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}${window.location.protocol === "https:" ? "; Secure" : ""}`;
  window.dispatchEvent(new Event(SHIP_EVENT));
}
