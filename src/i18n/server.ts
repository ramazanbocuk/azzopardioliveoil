import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { locale as rootLocale } from "next/root-params";
import { LANGUAGES, isLocale, languageOf, localizePath, tagOf, type Language, type Locale } from "./config";
import { MESSAGES, type Messages } from "./messages";
import { alternatesFor } from "./seo";

/**
 * The locale of the page being rendered, read from the address (/de-de/…).
 * Works in any Server Component under app/[locale]; not in route handlers or
 * server actions, which receive the locale from the caller instead.
 */
export async function getLocale(): Promise<Locale> {
  const value = await rootLocale();
  if (!isLocale(value)) notFound();
  return value;
}

export async function getI18n(): Promise<{ locale: Locale; language: Language; tag: string; m: Messages; href: (path: string) => string }> {
  const locale = await getLocale();
  return { locale, language: languageOf(locale), tag: tagOf(locale), m: MESSAGES[languageOf(locale)], href: (path) => localizePath(locale, path) };
}

/** Redirects within the current locale. */
export async function localRedirect(path: string): Promise<never> {
  redirect(localizePath(await getLocale(), path));
}

/**
 * Page metadata with the right canonical address and language alternates.
 * Pass the languages the page's text really exists in; the default is all.
 */
export function localizedMetadata(path: string, meta: Metadata, languages: readonly Language[] = LANGUAGES) {
  return async (): Promise<Metadata> => ({ ...meta, alternates: alternatesFor(await getLocale(), path, languages) });
}
