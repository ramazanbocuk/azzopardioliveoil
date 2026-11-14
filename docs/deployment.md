# Deployment

**Status: prepared, not deployed.** Nothing here has been run against a real host; no hosting or database account exists yet. Treat the first deployment as a rehearsal on a staging address.

Recommended setup: **Vercel** (Frankfurt, `fra1`) for the application and **Neon** (Frankfurt) for PostgreSQL, so customer data stays in the EU. Any Node 24 host with PostgreSQL 15+ works; the Vercel-specific parts are `vercel.json` only.

## 1. Database

1. Create a Neon project in an EU region. Enable point-in-time recovery (history retention) for at least 7 days.
2. Copy the **pooled** connection string, ending in `?sslmode=require`.

## 2. Application

1. Push the repository to GitHub and import it into Vercel.
2. Set the environment variables below for the Production environment.
3. Deploy. The build command (`npm run build:deploy`) applies database migrations, then builds. The build reads the catalogue from the database, so `DATABASE_URL` must be reachable at build time.
4. Create the first administrator once, from your own machine, pointing at the production database:
   set `DATABASE_URL`, `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in a local `.env`, run `npm run db:seed`, then remove the password from `.env`.
   The seed also creates the placeholder product and shipping zone if none exist: replace them in the admin before opening the shop.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string. The direct one: migrations use it |
| `DATABASE_URL_POOLED` | On Vercel | The database's pooled connection string. The running site uses it when set; without it, many server copies exhaust a managed database's direct connections ("too many connections") |
| `DATABASE_POOL_MAX` | No | Connections per server process. Default: 5 pooled or 2 direct on Vercel, 10 elsewhere |
| `APP_URL` | Yes | Public address, `https://…`, no trailing slash |
| `APP_SECRET` | Yes | 32+ random characters; signs reset and newsletter links |
| `CRON_SECRET` | Yes | 24+ random characters; protects the scheduler. Vercel Cron sends it automatically |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | To take payment | Live keys at launch |
| `RESEND_API_KEY`, `EMAIL_FROM` | To send email | Domain must be verified in Resend |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG` | For WhatsApp alerts | See `notifications.md` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Optional | SMS alerts |
| `ANTHROPIC_API_KEY`, `ASSISTANT_MODEL`, `ASSISTANT_EFFORT` | For the assistants | See `assistant.md`. Both stay off until switched on with a budget in the admin |
| Carrier keys (`BPOST_…`, `DHL_EXPRESS_…`, `UPS_…`, `FEDEX_…`) | To book labels | See `shipping.md` |
| `APP_ENV` | On staging only | `staging`. See "Staging" below |
| `STAGING_EMAIL_ALLOW` | On staging only | Addresses or `@domains` that may be emailed from staging |
| `ADMIN_HOST` | Optional | The admin panel's own host name; the panel then answers only there |

The server refuses to start in production if a required variable is missing, and logs a `[config] warning` line for each integration that is not connected.

Generate secrets with `openssl rand -base64 48`. Never put any of these in the repository or in the admin panel.

## 3. Scheduler

`vercel.json` schedules `GET /api/cron/jobs` once a day (04:00 UTC), because Vercel's free plan refuses a deployment with anything more frequent. **That is enough to try the site, not to run a shop**: with a daily run, order emails wait up to a day, unpaid orders keep their stock that long, and System status reports the scheduler as late. Before opening, either move to a paid Vercel plan and set the schedule back to `*/5 * * * *`, or have an outside timer call the same address every 5 minutes with the header `Authorization: Bearer <CRON_SECRET>`. It sends queued notifications, retries failures, cancels unpaid orders whose stock hold expired, and purges expired sessions. Schedules more frequent than daily need a paid Vercel plan. On another host, call the same address with the header `Authorization: Bearer <CRON_SECRET>`.

## 4. Payment webhook

In Stripe, add an endpoint `https://<your-domain>/api/webhooks/stripe` for these events:

- Payments: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
- Refunds: `refund.created`, `refund.updated`, `refund.failed`
- Disputes: `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`

Without the refund and dispute events the shop still takes payments, but a refund made in the Stripe Dashboard, a refund the bank bounces, or a dispute will not appear in the admin panel. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.

## 4b. Visitor country

The language suggestion uses the visitor's country from the `x-vercel-ip-country` header (Vercel sets it) or `cf-ipcountry` (Cloudflare). On another host, have the edge set one of them and strip any copy sent by the client. Without it, only the browser language is used and Belgian visitors are not shown the language prompt.

## 5. Domain and HTTPS

Point the domain at the host, then set `APP_URL` to it and redeploy. The site sends HSTS with `preload`; only submit the domain to the browser preload list once you are certain every subdomain will always use HTTPS.

## 5b. Staging

Deploy the same repository a second time, to its own address and **its own database**, with `APP_ENV=staging`, Stripe **test** keys, and `STAGING_EMAIL_ALLOW` set to your own address. Staging then shows a test-site notice, tells search engines not to index it, refuses to start with a live Stripe key, and emails only the addresses you listed. Do the first deployment here, and try every later change here first. See `production-readiness.md`.

## 5c. The admin panel's own address

Once the domain exists, add `admin.your-domain` to the same deployment and set `ADMIN_HOST=admin.your-domain`. The panel then answers only on that host.

## 6. After the first deploy

- Sign in to `/admin` and open **System status**. Every line should read "In order" except those you have chosen not to connect. On a live site the scheduler must show a run within the last few minutes.
- The first sign-in asks you to set up two-factor sign-in with an authenticator app; so will every staff account.

- `GET /api/health` returns `{"status":"ok"}`.
- `/robots.txt` and `/sitemap.xml` show the production domain.
- Place a test order with a Stripe test card and confirm: order becomes Paid, stock drops, the four notification jobs appear in Admin → Notifications.
- Sign in to `/admin`, complete Settings (legal name, address, VAT number, notification recipients) and Shipping & VAT.
- Work through `launch-checklist.md`.

## Rolling back

Redeploy the previous build from the host's deployment list. Migrations so far only add tables and columns, so the previous code runs on the newer schema. If a future migration removes or renames something, restore the database to the matching point (see `backup-recovery.md`) rather than rolling code back alone.

## Continuous integration

`.github/workflows/ci.yml` runs type-check, lint, unit and integration tests, a dependency audit and the end-to-end browser tests on every push and pull request. It runs on GitHub on every pull request and has passed on each one merged.
