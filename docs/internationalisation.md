# Languages and locales

Phase 3 of the master platform brief. Built on 2026-11-14.

## What a visitor gets

Ten addresses in six languages:

| Address | Language | Default for |
|---|---|---|
| `/en` | English | everyone else (fallback) |
| `/en-gb` | English | United Kingdom |
| `/en-us` | English | United States |
| `/de-de` | German | Germany, Austria |
| `/nl-nl` | Dutch | Netherlands |
| `/nl-be` | Dutch | Belgium (offered) |
| `/fr-fr` | French | France |
| `/fr-be` | French | Belgium (offered) |
| `/it-it` | Italian | Italy |
| `/es-es` | Spanish | Spain |

**Choosing the locale.** An address without one (`/shop`) is redirected once, in this order: the language chosen before (cookie `azz_locale`; a signed-in customer's saved language is copied into it at sign-in), the browser's language, the country's language, English. An address that already has a locale is never redirected, so nobody is bounced between languages.

**Belgium** is never given French or Dutch by guesswork. A French or Dutch browser goes to `/fr-be` or `/nl-be`; any other goes to `/en`. In every case a visitor from Belgium who has not chosen yet is shown a prompt offering Français, Nederlands and English.

**Three separate things.** The language (in the address), the delivery country (cookie `azz_ship`, chosen in the selector, pre-selects the country at checkout) and the visitor's own country (cookie `azz_country`, used only for the suggestion) never change one another.

**The visitor's country** comes from a header the host sets: `x-vercel-ip-country` (Vercel) or `cf-ipcountry` (Cloudflare). On another host, set one of them at the edge; without it the country is unknown and only the browser language is used. Locally there is no such header.

## What is translated, and what is not

| Text | State |
|---|---|
| Menus, footer, shop, product page labels, cart, checkout, order pages, account, forms, cookie notice, 404 | All six languages, in `src/i18n/messages/*.ts` |
| Customer emails: order confirmation, shipped, refund, password reset, newsletter confirmation, wholesale approval | All six languages, in `src/i18n/emails.ts`, sent in the language stored with the order, account or subscription |
| Server messages customers see (validation, order timeline) | About 40 are translated; any other appears in English |
| Product, category and journal text | Translated per record in Admin → Translations; English until a translation is published |
| Home page, Our story, Groves, Harvest, Quality, FAQ, Shipping & returns, journal samples | **English only.** Shown inside every locale with a note saying so |
| Privacy, cookie and terms pages | **English only, and drafts.** Legal text must be written and translated by qualified people |
| Staff emails and the admin panel | English |
| Order line names on past orders and in emails | The name at the time of ordering, in English |

**Every non-English text was written by the development team and has not been checked by a native-speaking editor.** A test checks that each language has every key and placeholder; it cannot check that the wording is right.

A page that is still English says so on the page, marks its content `lang="en"`, points its canonical address at the `/en/…` version and is left out of the hreflang alternates and the sitemap for other languages. English is never presented to a search engine or a screen reader as a translation.

## Translating products (Admin → Translations)

- The overview is the missing-translation report: every product, category and article against every language, as Missing, Draft, Live, Outdated (the English changed after publishing) or Live + draft.
- The editor shows the English beside the field. **Save draft** changes nothing for customers. **Publish** (managers of website content and above) makes the saved draft what customers see. **Take off the shop** returns customers to English and keeps the draft.
- Every save, publication and withdrawal is kept in the record's history and in the audit log.
- Origin, variety, ingredients and storage are food information; the editor says so. A wrong translation there is a labelling error.
- Nothing is machine-translated. Drafting by AI belongs to Phase 8 and will only ever produce drafts.

## For developers

- `src/i18n/config.ts`: locales, detection, `localizePath`. No server imports; shared by the proxy, server and browser.
- `src/proxy.ts`: the redirect for addresses without a locale.
- `src/app/[locale]/layout.tsx`: root layout of the storefront. `locale` is a root parameter, read anywhere on the server with `getI18n()` (`src/i18n/server.ts`). The admin panel has its own root layout and no locale.
- Client components call `useI18n()`; internal links use `@/components/ui/Link`, which adds the locale.
- The storefront API receives the page's language in the `x-azz-locale` header and answers product and category names in it.
- Adding a language needs a dictionary file in `src/i18n/messages`, an entry in `src/i18n/emails.ts` and in `LOCALES`. It cannot be done from the admin panel.
- Translations of records: `src/server/translations.ts`, tables `Translation` and `TranslationRevision`.

## Not done

- Native-speaker review of all five languages.
- Translation of the editorial and legal pages (the editorial ones are to be rewritten for the new brand positioning first).
- Product names on stored order lines and in emails in the customer's language.
- Adding languages, or editing interface text, from the admin panel.
- Currencies other than EUR, and prices per market (Phase 9).
- WhatsApp messages in the customer's language (no WhatsApp account is connected).
