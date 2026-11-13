"use client";

import { createContext, use, useMemo, type ReactNode } from "react";
import { languageOf, localizePath, tagOf, type Language, type Locale } from "./config";
import { fill, formatDate, formatMoney, plural } from "./format";
import type { Messages, Plural } from "./messages/en";

type Value = { locale: Locale; messages: Messages };
const I18nContext = createContext<Value | null>(null);

/** Hands the page's locale and interface text to client components. Rendered once, in the root layout. */
export function I18nProvider({ locale, messages, children }: Value & { children: ReactNode }) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
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
  money: (cents: number) => string;
  date: (value: string | Date, options?: Intl.DateTimeFormatOptions) => string;
  /** A message the server wrote in English, in the reader's language when a translation exists. */
  server: (english: string) => string;
};

export function useI18n(): I18n {
  const value = use(I18nContext);
  if (!value) throw new Error("useI18n must be used inside the storefront layout.");
  return useMemo(() => {
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
      money: (cents) => formatMoney(tag, cents),
      date: (date, options) => formatDate(tag, date, options),
      server: (english) => known[english] ?? english,
    };
  }, [value]);
}
