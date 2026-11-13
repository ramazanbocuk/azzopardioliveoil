"use client";

import { useMutation } from "@apollo/client/react";
import clsx from "clsx";
import { useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { rememberShipTo, useI18n } from "@/i18n/client";
import { COUNTRY_COOKIE, LANGUAGE_NAME, LOCALES, LOCALE_CODES, LOCALE_COOKIE, ONE_YEAR, SHIP_COOKIE, languagesOfCountry, localeFor, localizePath, splitLocale, type Locale } from "@/i18n/config";
import { countryName } from "@/i18n/format";
import { SetLanguage } from "@/lib/operations";

const readCookie = (name: string): string | null => (typeof document === "undefined" ? null : (document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))?.[1] ?? null));
const writeCookie = (name: string, value: string) => {
  document.cookie = `${name}=${value}; path=/; max-age=${ONE_YEAR}; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
};
const noop = () => () => {};

/** Saves the choice (this device, and the account when signed in), then opens the same page in the chosen language. */
function useChooseLocale() {
  const [save] = useMutation(SetLanguage);
  return async (locale: Locale) => {
    writeCookie(LOCALE_COOKIE, locale);
    // Saving to the account is a convenience; the language changes even if it fails.
    await save({ variables: { locale } }).catch(() => undefined);
    // Read at the moment of the click, so this component does not depend on the address while rendering.
    window.location.assign(localizePath(locale, splitLocale(window.location.pathname).path) + window.location.search);
  };
}

/**
 * Language and delivery country, chosen separately. Changing one never
 * changes the other: a customer may read German and have the parcel sent to
 * Belgium.
 */
export function LocaleSelector({ countries, placement }: { countries: string[]; placement: "header" | "footer" }) {
  const { m, locale, tag } = useI18n();
  const s = m.selector;
  const dialog = useRef<HTMLDialogElement>(null);
  const choose = useChooseLocale();
  const savedShip = useSyncExternalStore(noop, () => readCookie(SHIP_COOKIE), () => null);
  const [ship, setShip] = useState<string | null>(null);
  const shipTo = ship ?? (savedShip && countries.includes(savedShip) ? savedShip : "");

  const apply = async (form: FormData) => {
    const country = String(form.get("ship") ?? "");
    if (country) rememberShipTo(country);
    const next = String(form.get("locale") ?? locale) as Locale;
    if (next !== locale) await choose(next);
    else dialog.current?.close();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className={clsx("text-label inline-flex min-h-11 items-center gap-2 transition-opacity duration-300 hover:opacity-60", placement === "footer" ? "mt-8 border border-ivory/35 px-4 text-ivory" : "px-2")}
      >
        {/* The visible text is part of the button's name, as speech-control users say what they see. */}
        <span>{placement === "footer" ? `${LOCALES[locale].label}${shipTo ? ` · ${countryName(tag, shipTo)}` : ""}` : LOCALES[locale].language.toUpperCase()}</span>
        <span className="sr-only">, {s.open}</span>
      </button>

      <dialog ref={dialog} aria-labelledby={`locale-title-${placement}`} className="m-auto w-[min(92vw,30rem)] bg-ivory p-0 text-ink backdrop:bg-olive-950/60">
        <form action={apply} className="p-7">
          <h2 id={`locale-title-${placement}`} className="text-h3">
            {s.title}
          </h2>

          <div className="mt-7">
            <label htmlFor={`locale-${placement}`} className="text-label block opacity-80">
              {s.language}
            </label>
            <select id={`locale-${placement}`} name="locale" defaultValue={locale} className="mt-2 h-13 w-full border-b border-ink/35 bg-transparent outline-none focus:border-ink">
              {LOCALE_CODES.map((code) => (
                <option key={code} value={code} lang={LOCALES[code].tag}>
                  {LOCALES[code].label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-6">
            <label htmlFor={`ship-${placement}`} className="text-label block opacity-80">
              {s.shipTo}
            </label>
            <select id={`ship-${placement}`} aria-describedby={`ship-hint-${placement}`} name="ship" value={shipTo} onChange={(event) => setShip(event.target.value)} className="mt-2 h-13 w-full border-b border-ink/35 bg-transparent outline-none focus:border-ink">
              <option value="">{s.noCountry}</option>
              {countries.map((code) => (
                <option key={code} value={code}>
                  {countryName(tag, code)}
                </option>
              ))}
            </select>
            <p id={`ship-hint-${placement}`} className="text-small mt-2 opacity-70">
              {s.shipHint}
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button type="submit">{s.apply}</Button>
            <Button variant="text" onClick={() => dialog.current?.close()}>
              {m.common.cancel}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/**
 * Shown once to a visitor from a country with more than one language
 * (Belgium: French and Dutch) who has not chosen yet. No language is picked
 * for them; staying with the current one is also a choice and is remembered.
 */
export function LanguagePrompt() {
  const { m, locale, fill } = useI18n();
  const choose = useChooseLocale();
  const country = useSyncExternalStore(noop, () => readCookie(COUNTRY_COOKIE), () => null);
  const chosen = useSyncExternalStore(noop, () => readCookie(LOCALE_COOKIE), () => "server");
  const [dismissed, setDismissed] = useState(false);
  const offered = languagesOfCountry(country);
  if (chosen || dismissed || offered.length < 2) return null;

  const options = [...offered.map((language) => localeFor(language, country)), "en" as Locale].filter((code) => code !== locale);
  return (
    <aside aria-labelledby="language-prompt-title" className="fixed inset-x-4 top-[calc(var(--header-h)+0.75rem)] z-[56] mx-auto max-w-xl border border-ink/15 bg-ivory p-5 shadow-[0_20px_50px_-25px_rgb(0_0_0/0.5)]">
      <h2 id="language-prompt-title" className="text-label">
        {m.selector.promptTitle}
      </h2>
      <div className="mt-4 flex flex-wrap gap-2">
        {options.map((code) => (
          <Button key={code} size="sm" variant="secondary" lang={LOCALES[code].tag} onClick={() => choose(code)}>
            {LANGUAGE_NAME[LOCALES[code].language]}
          </Button>
        ))}
        <Button
          size="sm"
          onClick={() => {
            writeCookie(LOCALE_COOKIE, locale);
            setDismissed(true);
          }}
        >
          {fill(m.selector.keep, { language: LANGUAGE_NAME[LOCALES[locale].language] })}
        </Button>
      </div>
      <p className="text-small mt-3 opacity-70">{m.selector.promptText}</p>
    </aside>
  );
}
