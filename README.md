# Azzopardi Olive Oil

Storefront, GraphQL API and (from Phase 6) administration panel for Azzopardi Olive Oil.

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · GSAP · PostgreSQL · Prisma 7 · Apollo Server 5 · Pothos · Vitest

> **Status:** All nine phases are built and tested locally. **Nothing is deployed and no external service is connected:** hosting, database, Stripe, Resend, WhatsApp and Twilio all need accounts and keys. Catalogue data, prices, shipping rates, legal pages and imagery are placeholders. Start with `docs/launch-checklist.md`.

## Requirements

- Node.js 24+
- Nothing else for local work: a PostgreSQL server is bundled for development and tests.

## Install

```bash
npm install
cp .env.example .env
```

## Run locally

Three terminals, or run the first in the background:

```bash
npm run db:start      # local PostgreSQL on port 54329 (data in .data/postgres)
npm run db:deploy     # apply migrations
npm run db:seed       # placeholder catalogue, shipping zone, optional first admin
npm run dev           # http://localhost:3000
```

If the page keeps reloading by itself, or a style change does not appear, the dev server's cache is stale (this can happen after running `npm run build` while it is open). Stop it and start it with `npm run dev:clean`.

To create the first administrator, set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` (12+ characters) in `.env` before seeding. The password is stored only as an Argon2id hash.

| Address | What |
|---|---|
| `/` | Storefront |
| `/design-system` | Design tokens and components |
| `POST /api/graphql` | Storefront API |
| `/admin` | Administration panel (staff sign-in) |
| `POST /api/admin/graphql` | Administration API foundation (sign-in, products, stock) |

## Test

```bash
npm test              # unit + integration (starts its own throwaway PostgreSQL on port 54330)
npm run test:e2e      # real browser against a production build, own database on port 54331
                      # first time only: npx playwright install chromium
npm run typecheck
npm run lint
npm run build         # needs the database running: catalogue pages are prerendered from it
npm run codegen       # regenerate typed GraphQL operations after a schema change
```

Integration tests run real GraphQL operations through the same HTTP adapter as production, against real PostgreSQL with the real migrations. They never touch the development database. The end-to-end suite drives Chromium through buying, registering, searching, the admin gate, security headers, WCAG checks (axe), reduced motion and phone-width layouts.

## Project layout

```
prisma/            schema, migrations, seed
src/app/           pages and the two API routes
src/components/    design system and page components
src/content/       placeholder content (replaced by the database in Phase 5)
src/graphql/       storefront schema, admin schema, server, data loaders
src/motion/        GSAP animation primitives
src/server/        domain services: auth, catalogue, cart, pricing, checkout, payments, admin
tests/             unit and integration tests
docs/              generated GraphQL schemas (npm run schema:print)
```

## Rules the code enforces

- **Money** is integer euro cents everywhere.
- **Totals are computed on the server** from database prices. The client never sends a price.
- **Orders are created unpaid.** Only a signature-verified payment webhook, for the exact order amount, marks one paid. Each webhook event is applied once.
- **Stock is reserved atomically** at checkout and released if payment does not arrive within 40 minutes (the release job still needs a scheduler, added at deployment).
- **Secrets are never stored:** session and cart tokens are kept as SHA-256 hashes, passwords as Argon2id.
- **Authorization is server-side:** every protected resolver and every admin service calls `requireCustomer` or `requireAdmin(role)`; every admin change is written to the audit log.
- **The admin panel uses server actions over the service layer** in `src/server/admin.ts`, not the admin GraphQL endpoint, which still only covers sign-in, products and stock.
- **Product facts, lots, analyses and certifications are never invented.** They are null until an administrator enters them; documents are public only once verified.
- **No VAT rates ship with the system.** Until a rate is entered for a country, orders to it record no VAT amount. Rates must be confirmed with an accountant.

## Documentation

| Document | Contents |
|---|---|
| `docs/launch-checklist.md` | Everything still needed before real orders, including known software gaps |
| `docs/deployment.md` | Hosting, environment variables, scheduler, payment webhook, rollback |
| `docs/backup-recovery.md` | Backups, restore procedure, what is and is not tested |
| `docs/operations.md` | Monitoring, routine tasks, incident first steps, rotating secrets |
| `docs/security.md` | Security measures, how each is checked, known gaps |
| `docs/notifications.md` | WhatsApp, email and SMS setup; delivery guarantees; carriers |
| `docs/schema.*.graphql` | Generated API reference |

Backups: `npm run db:backup`, `npm run db:restore -- <file>`.

## API reference

`docs/schema.storefront.graphql` and `docs/schema.admin.graphql` are generated from the code. Errors carry `extensions.code`: `BAD_INPUT`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `INVALID_CREDENTIALS`, `EMAIL_TAKEN`, `OUT_OF_STOCK`, `CART_EMPTY`, `DISCOUNT_INVALID`, `SHIPPING_UNAVAILABLE`, and `extensions.field` when one input is at fault.
