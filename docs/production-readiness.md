# Production readiness

Phase 10 of the platform plan. Built 2026-11-19. **The site is still not deployed anywhere.** Everything here was built and tested on a development machine and in CI; none of it has run on a real host, behind a real domain, with live keys.

## What was added

### System status (Admin → System status, and `GET /api/status`)

One list of checks, worst first, each saying in plain words what is wrong: database and migrations, the scheduler's heartbeat, messages failed or waiting, website errors, payments (including a test key on the live site or a live key on staging), email, carriers, staff two-factor sign-in, the site address, the signing secret, the assistants' budget.

- It reads states and counts, never a key.
- `GET /api/status` returns the same checks as JSON for a monitoring tool. It needs `Authorization: Bearer <CRON_SECRET>`. 200 when nothing is failing, 503 when something is.
- `GET /api/health` is unchanged: public, says only up or down.
- **These checks run inside the website. They cannot tell you the site is down.** An uptime monitor outside the host must watch `/api/health`. The page also cannot know whether database backups exist.

### Error reports (`src/server/system.ts`)

Every unhandled server error is still logged as one JSON line. It is now also stored (`ErrorEvent`), one row per distinct error with a count, and the shop is emailed the first time each distinct error happens on a day.

- Ordinary refusals (not signed in, wrong role, not found) and page redirects are not errors and are not stored.
- No request body, cookie, header or query string is kept. Email addresses, keys and long identifiers are removed from messages.
- At most 500 distinct errors are kept and at most 8 error emails are sent a day, so provoking errors cannot fill the database or the inbox.
- A manager marks an error resolved; it reopens by itself if it happens again; resolved errors are deleted after 90 days.
- This is not an error-tracking service: it has no source maps, no browser-side errors, no grouping by release. If one is wanted later, its address must be allowed in the content security policy.

### Staging (`APP_ENV=staging`)

A staging site is the same production build with one variable set. On staging:

- A notice on every shop page and across the admin says it is a test copy.
- `robots.txt` disallows everything and every response carries `X-Robots-Tag: noindex, nofollow`.
- **A live Stripe key stops the server from starting.** Staging takes test money only.
- **Email goes only to addresses or domains listed in `STAGING_EMAIL_ALLOW`.** Anything else is recorded as skipped with the reason. This is enforced in the email channel itself, so no part of the code can forget it. Subjects are prefixed `[Staging]`.
- A mistyped `APP_ENV` leaves the site in production mode: a typo never switches a protection off.

Do not copy real customer data to staging unless you must; if you do, the email rule above is what stops it writing to customers.

### The admin panel on its own host (`ADMIN_HOST`)

Set `ADMIN_HOST=admin.your-domain` and the panel answers only there: on the shop's host `/admin` and the admin API return 404, and on the admin host everything except the panel, the APIs and static files goes to the panel. Unset, nothing changes. The rule trusts the `Host` header, which the hosting platform sets; on a host that passes a client-supplied `Host` through unchecked it would not be a protection.

## Security review (2026-11-19)

Checked, with the result:

| Area | Result |
|---|---|
| Production dependencies (`npm audit --omit=dev`) | 0 known vulnerabilities |
| Secrets in the repository or its history | None found (searched for Stripe, Resend, Anthropic and webhook key patterns in every commit). `.env` is not tracked |
| Raw SQL | No `$queryRawUnsafe` or `$executeRawUnsafe`; every raw query is a tagged template with parameters |
| HTML injection | Two uses of `dangerouslySetInnerHTML`: a fixed inline script, and JSON-LD with `<` escaped |
| File routes (exports, lot documents, product photos, labels) | Each builds the staff context and calls a service or `requireAdmin` before reading anything |
| Public file routes (product images, certificates) | Identifier format checked; certificates only when verified and published; `nosniff` and a locked-down content security policy on each |
| APIs | Storefront GraphQL: same-origin check, CSRF prevention, depth limit, introspection off in production. Admin GraphQL: every field calls `requireAdmin`. Assistant endpoint: origin check, body cap, rate limits. Scheduler and status: constant-time secret comparison. Stripe webhook: signature verified |
| Sessions | HttpOnly always, Secure in production, SameSite Strict for staff; staff sessions last 12 hours; tokens stored hashed |
| Passwords | Argon2; sign-in rate-limited per address and per account; same answer for unknown and wrong |
| Staff access | Role checked on the server for every action; two-factor compulsory in production |
| CSV exports | Cells starting with `=`, `+`, `-`, `@` are neutralised |
| Headers | Content security policy, HSTS, no framing, no sniffing, strict referrer policy; covered by a browser test |

Found and fixed in this phase: the new error store could have been filled, and the owner's inbox flooded, by someone provoking many distinct errors. Both are now capped.

Known and accepted (unchanged, see `security.md`): the content security policy allows inline scripts; rate limits rely on the proxy's `x-forwarded-for`; two-factor has no recovery codes or hardware keys.

**Not done: an independent penetration test.** This review was done by the same hand that wrote the code. Before taking real payments at any volume, have someone else test it.

## Load test (2026-11-19)

`scripts/loadtest.ts`, against a production build (`next start`) with its own PostgreSQL, **both running on one laptop**. Mixed traffic: home, shop and product pages, the catalogue API, reading the cart, adding to the cart, the health check.

| | 20 at a time, 20 s | 100 at a time, 20 s |
|---|---|---|
| Requests | 4,265 | 3,823 |
| Per second | 213 | 187 |
| Failed or 5xx | 0 | 0 |
| Pages, median / 95% | about 190 ms / 290 ms | about 1,330 ms / 1,700 ms |
| Catalogue API, median / 95% | 12 ms / 24 ms | 15 ms / 36 ms |
| Read cart, median / 95% | 9 ms / 21 ms | 12 ms / 30 ms |
| Add to cart, median / 95% | 40 ms / 70 ms | 52 ms / 125 ms |

What this shows and does not show:

- Nothing failed and nothing was lost under 100 simultaneous requests.
- The APIs and the database stayed fast. The pages were the limit: each page render costs the single Node process about 180 ms of work here, so at 100 at a time they queue.
- **These numbers describe a laptop, not the host.** On the recommended host the page shells are served from a CDN and renders run on many instances, which this test cannot measure. Run the same script against staging before launch: `npx tsx scripts/loadtest.ts https://staging.your-domain --concurrency 50 --seconds 60`. It adds items to carts, so never run it against the live shop by accident.
- Checkout and payment were not load-tested: they depend on Stripe.

## Tested

`tests/integration/system.test.ts`, 9 tests: environments; staging email rule in the channel and in the job runner; live key refused on staging; the admin host rule; error storage, scrubbing, daily email, limits, resolving, reopening and deletion; the status checks for a bare live site, a connected one, a silent scheduler, wrong payment keys, failed messages and errors; who may see the status; the monitor endpoint's secret. `e2e/system.spec.ts`: health, status and the proxy on a production build. All 265 tests and 25 browser tests pass.

## Not proven

- **Nothing has been deployed.** The Vercel and Neon instructions in `deployment.md` have never been followed for real.
- The staging notice, the staging robots rule and the admin host rule were tested as functions and by reading the configuration, not on a running staging site with its own host names.
- Error emails were tested up to the queue, with a stand-in for the email provider.
- The scheduler has never run on a host's timer.
- Backups and restore are documented (`backup-recovery.md`) and the backup script is tested, but a restore from the host's own point-in-time recovery has never been practised.

## What launch still needs from the owner

1. A domain, a hosting account and a database account (EU region).
2. A live Stripe account, with the webhook endpoint added.
3. A verified email sending domain at Resend.
4. New keys for the two that were pasted into a chat (Resend and Anthropic). Treat both as exposed.
5. An uptime monitor on `/api/health`.
6. Real products, producers, batches and laboratory reports; photography; legal texts reviewed; translations checked by native speakers.
7. Carrier accounts, if labels are to be booked from the admin.
8. Tax and food-law advice for each market.
9. An independent security test.

Then follow `deployment.md` on a staging address first, and `launch-checklist.md` before opening.
