# Korea, mainland China and Japan

Started 2026-11-25 from the owners' brief "Global Asian market expansion". The brief as received stopped in the middle of its fifth part (market-specific SEO), so this covers parts 1 to 4. **Nothing here has been seen by a native speaker, no order has been placed in won, yuan or yen outside the automated tests, and none of the three markets is open.**

## 1. What the audit found

The shop already had everything the brief asks to be extended, so nothing was rebuilt:

| Subject | How it works today | Where |
|---|---|---|
| Languages | The language is in the address (`/de-de/shop`). One dictionary per language, typed against English, so a missing line is a build error | `src/i18n/config.ts`, `src/i18n/messages/` |
| Finding the visitor's country | A header the host sets (`x-vercel-ip-country` or `cf-ipcountry`). No paid service, no lookup of our own | `src/proxy.ts` |
| Choosing a language | Only an address without a language is redirected, once: earlier choice, then browser language, then country, then English. An address with a language is never redirected | `detectLocale` |
| Remembering | Cookie `azz_locale` (and the customer's account when signed in). Delivery country and visitor's country are separate cookies and never change the language | `LocaleSelector.tsx` |
| Currency | Follows the delivery country, never the language. Prices are typed in per currency and never converted | `docs/markets.md` |
| Search engines | Canonical address and hreflang alternates per page, built from the list of locales; a page still in English is never announced as a translation. Sitemap likewise. No redirect depends on who is asking | `src/i18n/seo.ts`, `src/app/sitemap.ts` |
| Outside services in the page | **None.** Fonts are served by the shop itself, there is no analytics, no tag manager, no map, no font or script from another company | `src/lib/fonts.ts` |
| Payment | Stripe's hosted page, one line for the server's total, in the order's currency | `src/server/payments.ts` |
| Assistant | Told the reader's language per conversation; answers in it | `src/server/ai/prompt.ts` |

Two things the audit found that the brief does not mention, both now handled:

- **Every amount assumed two decimal places.** Yen and won have none, and the payment provider counts them in whole units. Charging 4,800 yen as the shop stored it would have asked for 480,000.
- **The two typefaces have no Korean, Chinese or Japanese letters.**

## 2. What is built

**Three locales.** `/ko-kr` (한국어), `/zh-cn` (简体中文), `/ja-jp` (日本語). They appear in the language selector, in hreflang and in the sitemap by themselves, because all three are read from the one list.

**Interface text** in all three: menus, footer, shop, search, filters, product page labels, laboratory table, cart, checkout and its validation messages, order and tracking pages, shipments and backorders, account, password reset, contact, newsletter, cookie notice, assistant window, 404. **Customer emails** in all three: confirmation, shipped (whole and part), refund, newsletter confirmation, password reset, wholesale approval.

**Chinese is Simplified only.** A browser that asks for Traditional Chinese (Taiwan, Hong Kong, Macau) is not sent to `/zh-cn`; it gets English.

**Arriving.**
- An address without a language (`azzopardi…/shop`): a Korean browser goes to `/ko-kr/shop`, and so on. With no browser language, the country decides. This is the existing rule, with three languages added.
- An address with a language is never redirected. A visitor in Korea, mainland China or Japan who is reading another language is shown one small notice at the foot of the page, **in their own language**: "한국어로 쇼핑하시겠어요?" with "한국어로 보기" and "Continue in English". Either answer is remembered, so it is asked once. No country means no notice.
- European visitors are treated exactly as before (`suggestedLocale` offers these three markets only).
- Search engines are not treated differently from anyone else, and nothing is decided from who is asking. A crawler requesting `/ja-jp/shop` gets `/ja-jp/shop`.

**Currencies.** KRW, CNY and JPY can now be chosen for a market, a shipping zone, a discount and a price. Amounts are still stored in hundredths for every currency (4,800 yen is `480000`), so the one rule "an amount is in one currency and is never converted" is untouched. For yen and won:
- a price, shipping rate, fixed discount, minimum order or refund with a fraction of a unit is refused when it is typed in;
- a percentage discount and the VAT inside a price are rounded to a whole unit, and the parts still add up to the total;
- checkout refuses a total that is not a whole unit, as the last check;
- `toStripeAmount` / `fromStripeAmount` in `payments.ts` are the only place the provider's whole-unit counting exists (checkout, refunds, and the refund and dispute messages coming back).

**Letters.** Each of the three languages names the fonts its readers' own devices already have (`globals.css`). Nothing is downloaded and nothing comes from a font service. Headings in these scripts lose the tight letter-spacing drawn for Latin letters; Korean breaks between words.

**Admin.** Translations (products, categories, journal) lists the three new languages by itself. The price fields on a product, and the currency lists for shipping zones and discounts, come from the one list of currencies.

## 3. What a customer in these markets still sees in English

Unchanged from the European languages, and for the same reasons:

| Text | Why |
|---|---|
| Product, category and journal text | Translated per record in Admin → Translations, and shown only once a person publishes it. Until then English, with a line saying so |
| Home page, Our story, Origins, Harvest, Quality, FAQ, Shipping & returns | Hand-written English, marked as such; not announced to search engines as a translation. Translating them is the next piece of work (section 5) |
| Privacy, cookie and terms pages | Drafts, and legal text is not to be translated by the development team |
| Product names on past orders and in emails | The name at the time of ordering |
| Some server refusals (currency mismatch, a product not sold to a country) | About 40 messages are translated; the rest appear in English |

## 4. Opening one of these markets

Nothing is sold to Korea, China or Japan until an administrator does what `docs/markets.md` lists: prices typed in for each size, a shipping zone in that currency, the market created and opened, a test order. Before that, for each country:

- **Food import rules.** Olive oil is a food. Each of the three countries has its own rules for importing it for sale (registration of the foreign maker or exporter, labels in the local language, inspection or notification on arrival). Whether a parcel sent straight to a consumer falls under them, and what the label must say, is a question for an import adviser in that country. The shop cannot answer it and does not try.
- **Tax and duty.** The shop applies one VAT rate per destination country to prices that include it. It does not calculate import duty, Japanese consumption tax on imports, Korean VAT on imports or Chinese cross-border tax, and does not collect them. "VAT included" beside a price is shown for euro prices only.
- **Carriers.** No carrier adapter has ever called a carrier, for any country.
- **Payment.** Stripe must have each currency enabled on the live account. Which local methods it may offer (cards are not what most customers in mainland China or Korea use) depends on the country the Stripe account is registered in; ask Stripe. Stripe's method settings are in its dashboard, not in this code.

### Mainland China in particular

The page itself is clean: no font, script, map or tracker from a company that is blocked there. That is the part this code controls. The rest it does not:

- **Reaching the site.** The shop runs on Vercel, outside mainland China. Sites hosted outside are often slow there and sometimes unreachable, and that cannot be fixed in code. Hosting inside mainland China needs a Chinese business entity and an ICP filing.
- **Paying.** The payment page is Stripe's, on Stripe's own address. Whether it loads reliably in mainland China has not been tested, and cannot be from here.
- **Being found.** Google is not available there. How well Baidu lists a site hosted outside China has not been looked into; it belongs to the SEO part of the brief.
- **Email.** Delivery to QQ, 163 and similar mailboxes from a European sender has not been tested.
- **The country header.** Vercel reports `CN` for mainland China, `HK`, `MO` and `TW` separately; only `CN` is offered Simplified Chinese.

Selling into mainland China through a local marketplace and partner instead of one's own site is a common route and a business decision for the owners, with advice. `/zh-cn` as built is a readable, honest Chinese version of the shop for Chinese readers anywhere, and is not on its own a way into the mainland market.

## 5. Not done

- **Native review of all three languages.** A test checks that every line exists, that placeholders match and that the Chinese has no common Traditional characters. It cannot check that the wording is right, or right for a premium shop. Japanese honorific register in particular needs a native editor.
- **Editorial pages in the three languages** (home, story, origins, harvest, quality, FAQ, shipping). They are English for every language today.
- **Market-specific SEO** (the brief's part 5 and anything after it): keyword research for Naver, Baidu and Yahoo! Japan, their webmaster-tool verification, and anything else the missing part of the brief asks for. The page titles and descriptions use the ordinary name of the product in each language and nothing more.
- **Names and addresses the local way.** Checkout asks for first name then last name, and street before city, in every language. Emails greet with the first name ("太郎 様" rather than "山田 様").
- **Local payment methods, messaging apps and marketplaces** (KakaoPay, Naver Pay, Alipay, WeChat Pay, LINE, Konbini): nothing built.
- A browser test for the language notice and for a yen order. Both are covered by server and unit tests, and the notice was checked by hand in a browser.

## 6. Tested

`tests/unit/i18n.test.ts`: detection for the three countries; Traditional Chinese never sent to Simplified; the notice offered once, and never to Europe; thirteen locales in nine languages with every line and placeholder; counts in the three languages; whole-unit rounding of a percentage, the VAT and its split per line.

`tests/integration/markets.test.ts`: a Japan market in yen: a price, a shipping rate and a fixed discount with a fraction of a yen refused; a cart and an order in yen with a 15% code; the payment provider asked for the right amount; the conversion to and from the provider's whole units; the refund email showing "¥4,800" and not "4,800.00".
