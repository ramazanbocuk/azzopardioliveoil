# Architecture audit and plan — master platform brief

Date: 2026-11-13. Audited at commit `b943d1b` on `main`.

This answers Phase 1 (audit) and outlines Phase 2 (architecture) of the master brief. The owner approved it on 2026-11-13.

**Progress:** Phase 3, internationalisation, is built (2026-11-14); see `docs/internationalisation.md` for what it covers and what it does not. Phase 4, product intelligence, is built (2026-11-14); see `docs/product-intelligence.md`. Phase 5, the order and fulfilment engine, is built (2026-11-15); see `docs/fulfilment.md`. Phase 6, shipping integrations, is built as far as it can be without a carrier account (2026-11-15); see `docs/shipping.md`. Phase 7, the customer assistant, is built but has never spoken to the real model (2026-11-16); see `docs/assistant.md`. Phase 8, the staff assistant with its approval queue, is built and likewise has never spoken to the real model (2026-11-17); same document. Phases 9 and 10 are not started. The tables below describe the state before Phase 3.

## 1. What exists today

**Stack.** One Next.js 16 application (React 19, TypeScript), PostgreSQL through Prisma 7, a GraphQL API for the storefront (Apollo Server + Pothos), server actions over a service layer for the admin, Stripe Checkout, Resend email, a Postgres-backed job queue with retries, Tailwind, GSAP. About 47 database tables, 15 migrations, 167 automated tests plus 15 browser tests, CI on GitHub. Not deployed anywhere.

**Working and tested**

| Area | State |
|---|---|
| Storefront: catalogue, cart, checkout, accounts, reviews, journal, order tracking | Working, English only |
| Payments: Stripe Checkout, signed webhooks, refunds, refund and dispute sync | Working in Stripe test mode; never run live |
| Orders: payment and fulfilment status, timeline, internal notes, invoices, packing slips, commercial invoice | Working |
| Partial shipment of an order (choose quantities, several shipments, separate tracking numbers, over-shipping blocked) | Working in the admin |
| Inventory: stock, reservations at checkout, movement ledger, purchase orders, suppliers | Working |
| Admin: 22 sections, nine staff roles with per-area permissions, two-factor sign-in, sessions, audit log | Working |
| GDPR: data export, erasure, consent records | Working; legal texts are placeholders |
| Email notifications (8 events) | Working through Resend with a test sender address |

**Written but never run against the real service**

- DHL, FedEx and bpost label booking and tracking. No carrier account exists, so no real label has ever been produced.
- WhatsApp and SMS notifications. No account connected.

**Technical debt and weaknesses**

- Admin is not on GraphQL; it uses server actions. Sound, but it differs from the earlier brief.
- Product photos are stored in the database. Fine for a small catalogue, not for a large one.
- No error-tracking service, no uptime monitor, no staging environment, no load test.
- Rate limiting and the job queue live in PostgreSQL. Adequate at this size; Redis is not needed yet.
- Two-factor sign-in is optional for staff, not compulsory.
- The Resend key was pasted into a chat and should be replaced.
- Tracking events are stored as one JSON field per shipment, not as rows.

## 2. Gap against the master brief

| Brief section | Exists | Missing |
|---|---|---|
| 1. Positioning | Brand, design system | **All storefront copy presents a single Sicilian estate** (9 files). The brief now says five source countries and no Sicilian positioning. Every page text, the hero and "Our story" must be rewritten, with real producers supplied by the owner |
| 2A. Customer AI | Nothing | Everything: chat interface, product and order tools, knowledge base, guardrails, six languages, handover to a person |
| 2B. Admin AI | Nothing. The services it would call (reports, inventory, orders, permissions, audit) exist | Everything: assistant, read / draft / execute permission tiers, approval queue, usage and cost tracking, conversation history, evaluation |
| 3. Multilingual | `Order.locale` field, `ProductTranslation` and `CategoryTranslation` tables (unused), fixed `lang="en"` | Locale URLs, detection, selector, translated interface text, translated emails, admin translation workflow, hreflang, localized sitemaps |
| 4. Partial fulfilment | `Shipment`, `ShipmentItem`, `Parcel`, `ShipmentLabel`, per-line shipped quantity, a "partially shipped" status | Backorders (checkout refuses out-of-stock items today), per-shipment packing slip, customer view of several shipment timelines, a notification per shipment in the customer's language, UPS, tracking events as rows |
| 5. Product intelligence | `Batch` (lot, harvest date, grove, mill, dates), `BatchDocument` (analysis, certification, with a "verified by" stamp), `Supplier`, free-text origin and cultivar | Producers, regions and olive varieties as records; polyphenol, acidity, peroxide and other lab values per batch; lab name, method and test date; tasting profile; stock per batch |
| 6. Admin (25 modules) | 22 sections | Producers, regions, varieties, lab certificates, translations, both AI areas, knowledge base, support centre, markets and tax. `admin.azzopardi.com` needs the domain |
| 7. International | Shipping zones, weight bands, free-shipping threshold, `TaxRate` per country, customs fields | USD and GBP (everything is EUR), prices per market, product availability per destination, address validation, the idea of a "market" |
| 8. Design | Design system, GSAP motion, accessibility tests | Redesign of content for the new positioning; photography from the owner |
| 9. Security | Most of it | Compulsory staff two-factor, error reporting, monitoring, separate authorization for each AI |
| 10. Architecture | Next.js, GraphQL, Prisma, PostgreSQL, jobs, carrier adapters | LLM provider layer, knowledge retrieval |
| 11. Acceptance tests | See section 5 | |

## 3. Architecture decisions

These are the engineering choices I recommend. The ones marked **owner** change cost, law or the brand and need a yes.

1. **Keep one Next.js application. Do not add NestJS.** The service layer already separates business logic from pages. A second backend would double deployment and auth for no gain at this size.
2. **No Redis yet.** Add it only if chat traffic or rate limiting outgrows PostgreSQL.
3. **Locale in the URL** (`/de-de/…`), with every storefront route moved under a `[locale]` segment and a proxy that suggests a language once and never redirects again after a choice. Language, shipping country and currency are three separate cookies and three separate fields on the order. This moves every storefront file and is the largest structural change.
4. **Translations in the database for products and content, in files for interface text.** AI may draft; a person approves before anything is published. Legal pages, ingredients, allergens and nutrition are never auto-published.
5. **Product intelligence as records**: `Producer`, `Region`, `OliveVariety`, a many-to-many between product and variety, and `LabResult` rows attached to a batch (measure, value, unit, method, laboratory, test date, certificate file, verified by). The storefront shows a lab value only when it is verified.
6. **Fulfilment model.** The brief lists `Fulfilment`, `Package`, `ShippingLabel`. The existing `Shipment`, `Parcel` and `ShipmentLabel` are the same things and hold live data, so they stay under their current names. New tables: `TrackingEvent`, `StockReservation`, `Backorder`. Stock moves from a per-variant counter to per-batch quantities so that each batch carries its own stock and lab results.
7. **Backorders (owner).** Today a customer cannot buy what is not in stock. Selling on backorder means taking money for goods that are not there. Recommendation: off by default, switchable per product by the owner, with the wait stated at checkout.
8. **Carriers (owner).** The brief names bpost, DHL and UPS. FedEx is already written. Recommendation: add UPS, keep FedEx switched off. Each needs a business account and API credentials from the owner; without them no real label can be produced or tested.
9. **Currencies (owner).** Recommendation: fixed prices per market set by the owner in EUR, USD and GBP, not live conversion. Stripe charges in the market's currency. Reports state the currency and never add different currencies together.
10. **AI.** One provider layer with Claude as the default model. Neither assistant touches the database: each gets a short list of typed tools that call the existing services, so the existing permission checks and audit log apply. The customer assistant's tools are read-only plus "add to cart" after the customer confirms. The admin assistant's tools are grouped as read, draft and execute; execute needs the staff member's own permission and an explicit confirmation, and refunds, tax, permissions and deletions are never available to it. Knowledge retrieval starts with PostgreSQL full-text search over approved articles; pgvector only if that proves too weak. **Owner:** needs an Anthropic API key and a monthly spending limit.
11. **Health claims (owner, legal).** The assistant and the product pages will state measured values and nothing more. Any health wording about polyphenols is regulated in the EU, the UK and the USA and must be approved by a food-law adviser before it is entered. The platform will keep such text in an approval queue; it cannot decide whether a claim is lawful.
12. **Admin address.** `admin.azzopardi.com` will be served by the same application through a host rule once the domain exists.

## 4. Phases

Each phase ends with tests, a report of what is unproven, and a pull request.

| Phase | Content | Size | Blocked by |
|---|---|---|---|
| 3. Internationalisation | Locale routing and detection, selector, interface text in six languages, translated emails, admin translation screens, hreflang and sitemaps | Large | Translations need a native check before going live |
| 4. Product intelligence | Producers, regions, varieties, lab results per batch, tasting profile, storefront display, admin screens | Medium | Real producer and lab data from the owner |
| 5. Fulfilment engine | Per-batch stock, reservations as rows, backorders, shipment timelines in the customer account, per-shipment slip and notification | Large | Decision 7 |
| 6. Shipping | UPS adapter, tracking events as rows, delivery exceptions, proving bpost, DHL and UPS against sandbox accounts | Medium | Carrier accounts |
| 7. Customer AI | Chat, tools, knowledge base, guardrails, handover, support requests | Large | API key; Phases 3 and 4 for good answers |
| 8. Admin AI | Assistant, tiers, approval queue, usage and cost, evaluation | Large | API key |
| 9. Admin completion | Remaining modules, markets and currencies, compulsory two-factor | Medium | Decision 9 |
| 10. Production | Staging, monitoring, error reporting, security review, load test, deployment | Medium | Domain, hosting, live Stripe account |

Brand copy for the new positioning runs alongside Phase 3, since every page is being touched anyway.

## 5. Acceptance tests today

| Test | Today |
|---|---|
| 1. German visitor | **Passes** since Phase 3 (browser test) |
| 2. Belgian visitor | **Passes** since Phase 3 (browser test); the notification language is covered by an integration test |
| 3. Customer AI and lab data | **Application half passes** since Phase 7 (integration test with a scripted model): the assistant is given only the verified value of the right product and lot, and is told in words to say so when there is none. **The model half is unproven**: how the real model words its answer has not been tested, because there is no API key |
| 4. Admin AI, second shipments | **Application half passes** since Phase 8 (integration test with a scripted model): the staff assistant is given exactly the paid, partly sent orders with what is ready and what waits for stock. **The model half is unproven** |
| 5. Partial fulfilment | **Passes** since Phase 5 as an integration test: five products, two shipments, two tracking numbers, an email per shipment in the customer's language, both shipments under one order. With hand-entered tracking; a real carrier label is test 7 |
| 6. Refund permission | **Passes** in the dashboard (tested) and, since Phase 8, in the application around the assistant (tested): a role that cannot refund cannot make the assistant propose one, and an administrator's refund moves no money until they approve it. What the real model says when refusing is unproven |
| 7. Real carrier label | **Still cannot be run: no carrier account.** Four adapters (bpost, DHL, UPS, FedEx) are written and unit-tested against documented responses; none has called a carrier |

## 6. What only the owner can provide

- Producers, products, batches and laboratory certificates for the real range
- Carrier business accounts (bpost, DHL, UPS) and their API credentials
- Anthropic API key and a spending limit
- Prices in USD and GBP, and which countries each product may ship to
- Tax and import advice for selling food into the USA and the UK, and VAT registration decisions for the EU
- Legal review of health wording, terms, privacy and returns in each language
- The domain, hosting, a live Stripe account, a verified email sending domain
- Photography

## 7. Risks

- **Scope.** Phases 3, 5, 7 and 8 are each as large as everything built in the last tranche.
- **Unverifiable work.** Carrier labels, WhatsApp and live payments stay unproven until accounts exist. They will be reported as unproven, not as done.
- **Translation quality.** Machine drafts in five languages need native review, above all for food and legal text.
- **AI accuracy.** The assistant can only be as correct as the product data entered. Empty lab fields mean "not available", never a guess.
- **Regulation.** Selling food across borders and making polyphenol claims carry legal duties the software cannot discharge.
