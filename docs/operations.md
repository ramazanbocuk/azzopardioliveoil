# Operations

## Monitoring

| What | How | Status |
|---|---|---|
| Is the site up? | Point an uptime monitor at `GET /api/health` (200 = database reachable). Alert on two consecutive failures. | Endpoint built; no monitor set up |
| Server errors | Every unhandled error is logged as one JSON line with `"event":"request_error"`. Create a log alert on that string in the host's log tool. | Logging built; no alert set up |
| Configuration | Lines starting `[config]` at start-up list missing or test-mode integrations. | Built |
| Notifications | Admin → Notifications shows sent, waiting, skipped and failed messages. Check "failed" daily at first. | Built |
| Payments | Compare Stripe's dashboard with Admin → Orders weekly. Audit log entries `payment.amount_mismatch` or `order.paid_without_stock` need a person to look. | Built |
| Refunds and disputes at Stripe | Mirrored from Stripe's webhooks. Audit log entries `refund.currency_mismatch` and `refund.failed`, and any open dispute under Admin → Payments, need a person. | Built; not yet seen with a real Stripe refund |
| Stock | Dashboard → Inventory alerts. | Built |

No error-tracking service (such as Sentry) is installed. Adding one means allowing its address in the content security policy in `next.config.ts`.

## Routine tasks

- **Daily:** new orders, failed notifications, low stock.
- **Weekly:** reconcile payments; review the audit log for unexpected staff actions.
- **Monthly:** `npm audit --omit=dev`; apply dependency updates on a branch and let CI run; practice a restore quarterly.
- **When staff leave:** deactivate their account under Staff the same day.

## If something goes wrong

| Symptom | First steps |
|---|---|
| Orders stay "awaiting payment" after customers pay | Stripe dashboard → Webhooks: are deliveries failing? Check `STRIPE_WEBHOOK_SECRET`. Stripe retries for days; once fixed, orders update themselves. Never mark an order paid by hand in the database. |
| No notifications | Admin → Notifications: "skipped" names the missing setting; "failed" shows the provider's error. Fix, then Retry. Confirm the scheduler is calling `/api/cron/jobs`. |
| Stock looks wrong | Each change is in the inventory ledger (`InventoryMovement`) with who and why. Correct through Products → Update stock, never directly in the database. |
| A staff member cannot sign in | Five wrong passwords lock sign-in for 15 minutes. Changing `SEED_ADMIN_PASSWORD` after the account exists does nothing by itself: the seed only creates the first administrator. To set a new password, put it in `SEED_ADMIN_PASSWORD` and run `npm run admin:set-password`; this also signs that person out everywhere and clears the lock. |
| A staff member lost the phone with their authenticator app | An administrator opens Admin → Security and resets that person's two-factor sign-in; they are signed out and can set it up again. If the only administrator is locked out, run `npm run admin:set-password` on the server: it sets the password from `SEED_ADMIN_PASSWORD` and clears two-factor sign-in. |
| Site down | `/api/health`. If 503, the database is unreachable: check the database host's status. If the build failed, redeploy the previous build. |
| Suspected break-in | Deactivate affected staff accounts; rotate `APP_SECRET` (invalidates outstanding reset links), the Stripe keys and any exposed provider key; review the audit log; assess whether a personal-data breach must be reported to the Belgian Data Protection Authority within 72 hours. |

## Rotating secrets

Change the value in the host's environment settings and redeploy. `APP_SECRET`: outstanding reset and newsletter links stop working. `CRON_SECRET`: nothing else to do on Vercel. Stripe and other provider keys: create the new key first, deploy, then revoke the old one.
