# Azzopardi — notes for working in this repository

Read `AGENTS.md` first: this Next.js version differs from older ones, and its own docs are in `node_modules/next/dist/docs/`.

## What this is

A bespoke ecommerce platform for Azzopardi (premium olive oil): one Next.js 16 application, PostgreSQL through Prisma, a GraphQL API for the storefront, server actions over a service layer for the admin panel, Stripe Checkout, Resend email.

The master brief is being built in phases. `docs/platform-audit.md` has the audit, the architecture decisions and the phase plan. Phase 3 (languages) is built: `docs/internationalisation.md`. Phase 4 (producers, varieties, lab results per batch) is built: `docs/product-intelligence.md`.

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
- Every admin service starts with `requireAdmin(ctx, level, area)`.
- Never state a certification, lab value, health claim or delivery date that is not in the database. Empty means "—".
- A laboratory value reaches customers only through `publicLabResults` (verified, published batch). Do not read `LabResult` directly in storefront code.
- An optional number in a zod schema is `z.union([...]).optional()`, not a union containing `z.undefined()`: the latter makes the key required.
- Report what is unproven. Carrier adapters (DHL, FedEx, bpost) have never called a carrier. Non-English text has not had a native review.
