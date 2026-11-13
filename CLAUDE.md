# Azzopardi — notes for working in this repository

Read `AGENTS.md` first: this Next.js version differs from older ones, and its own docs are in `node_modules/next/dist/docs/`.

## What this is

A bespoke ecommerce platform for Azzopardi (premium olive oil): one Next.js 16 application, PostgreSQL through Prisma, a GraphQL API for the storefront, server actions over a service layer for the admin panel, Stripe Checkout, Resend email.

The master brief is being built in phases. `docs/platform-audit.md` has the audit, the architecture decisions and the phase plan. Phase 3 (languages) is built: `docs/internationalisation.md`. Phase 4 (producers, varieties, lab results per batch) is built: `docs/product-intelligence.md`. Phase 5 (several shipments per order, backorders, stock holds) is built: `docs/fulfilment.md`. Phase 6 (UPS adapter, tracking events, delivery problems) is built without a carrier account: `docs/shipping.md`.

Phase 7 (customer assistant, knowledge base, support requests) is built but has never called the real model: `docs/assistant.md`. Phase 8 (staff assistant: read, draft, propose; approval queue) is built, with the same caveat; same document.

Phase 9 (markets, fixed prices per currency, compulsory staff two-factor) is built: `docs/markets.md`.

Phase 10 (system status, stored error reports, staging mode, admin host) is built: `docs/production-readiness.md`. Nothing is deployed.

## Commands

- `npm run dev` — development server (needs `npm run db:start` first). After schema changes or odd caching: `npm run dev:clean`.
- `npm run typecheck`, `npm run lint`, `npm test` (Vitest, own database), `npm run test:e2e` (Playwright against a production build, own database).
- `npx prisma migrate deploy && npx prisma generate` after adding a migration. Migrations are hand-written SQL.
- `npm run codegen` after changing a GraphQL operation or the storefront schema.

## Rules that are easy to break

- Storefront pages live under `src/app/[locale]/`. Internal links use `@/components/ui/Link`, never `next/link`, and are written without a locale (`/shop`).
- No visible text in storefront components: add a key to `src/i18n/messages/en.ts` and to the five other languages (the type forces it).
- Anything that reads the address in a layout-level client component (`usePathname`, `useSearchParams`) must sit behind `<Suspense>`, or the production build fails.
- Money and status changes happen in services under `src/server/`, never in pages. An order is paid only by a verified provider webhook; shipped only with a shipment.
- What may be dispatched is `readyToShip(item)` in `src/server/stock.ts`, never `quantity - shippedQuantity`: units on an open backorder are not on the shelf. Any code that adds stock or releases a hold must call `allocateBackorders` in the same transaction.
- Every admin service starts with `requireAdmin(ctx, level, area)`.
- Never state a certification, lab value, health claim or delivery date that is not in the database. Empty means "—".
- A laboratory value reaches customers only through `publicLabResults` (verified, published batch). Do not read `LabResult` directly in storefront code.
- An optional number in a zod schema is `z.union([...]).optional()`, not a union containing `z.undefined()`: the latter makes the key required.
- The model never touches the database. It can only call the tools in `src/server/ai/customerTools.ts`; each validates its input with zod, reads through the same services as the shop, and returns gaps as words ("not recorded"), never as empty fields the model could fill. No tool writes an order, a cart, a payment or a product.
- A staff-assistant tool calls an admin service with the staff member's own `ctx`, never `ctx.db` for anything that service guards. A tool that changes money, stock or an order does not exist: add a kind to `src/server/ai/proposals.ts` instead, with the same level and area as the panel's button, and let a person approve it. Never add a tool or a proposal kind for deleting, prices, tax, staff, roles, settings, addresses, payment details or publishing.
- A propose tool checks the role before it looks anything up, so a refusal reveals nothing.
- Tools of one model turn run one after another, not in parallel (two calls in one turn once created two support requests).
- Tests replace the model with `setModelProvider(script)`. They prove what the application does around the model, not how the model words an answer.
- An amount is in one currency and is never converted. Use `priceIn(variant, currency)`, never `variant.priceCents`, for anything a customer pays; a null price means "not sold there". Never sum `totalCents` or `amountCents` across orders without filtering on one currency.
- Format money with its currency: `money(cents, order.currency)` in the admin, `money(cents, cart.currency)` or `price(variant)` in the shop.
- A service open to every role uses `requireStaff(ctx)`, not a bare `ctx.admin` check: it also enforces two-factor sign-in.
- `src/server/environment.ts` is pure and imports nothing: the request proxy and the email channel depend on it. Keep it that way.
- Email leaves only through `sendEmail`, which refuses recipients not on the allow-list when `APP_ENV=staging`. Never call the provider from anywhere else.
- A new integration or background duty gets a line in `systemChecks` (`src/server/system.ts`) that says in plain words what is wrong when it is.
- Every folder under `src/app/admin/` that has a `page.tsx` also has a `loading.tsx` (one line, re-exporting `@/components/admin/Loading`). Admin pages read the session per request, so without it moving between pages blocks and Next.js reports "uncached data … outside of Suspense" in development. A loading file in a parent folder does not count for moves between its children; nor does a template.
- Report what is unproven. Carrier adapters (DHL, FedEx, bpost, UPS) have never called a carrier. Non-English text has not had a native review.
