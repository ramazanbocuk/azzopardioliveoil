# Notifications

When an order is **paid** (confirmed by the payment provider's signed webhook, never by the browser), four messages are queued in the same database transaction:

| Job | Channel | To |
|---|---|---|
| `notify.owner.whatsapp` | WhatsApp Business Platform | Recipient set in Admin → Settings |
| `notify.owner.email` | Resend | Recipient set in Admin → Settings |
| `notify.owner.sms` | Twilio (optional, off by default) | Recipient set in Admin → Settings |
| `notify.customer.confirmation` | Resend | The customer |

When staff mark an order shipped, `notify.customer.shipped` is queued. Newsletter sign-ups queue `email.newsletter.confirm`; the contact form queues `email.contact`.

## Guarantees

- **No duplicates from repeated webhooks.** Each job has a unique key (`kind:orderId`), so a second webhook for the same order cannot queue a second message.
- **One worker per job.** Jobs are claimed with `FOR UPDATE SKIP LOCKED`.
- **Retries.** A failed send is retried after 1 min, 5 min, 30 min, 2 h and 12 h, then marked failed and shown in Admin → Notifications.
- **No pretending.** A channel that is switched off or has no credentials is recorded as *skipped* with the reason.

Limit to know: email is sent with a provider idempotency key. WhatsApp and SMS have no such key, so if the server crashes in the instant between the provider accepting a message and the job being marked done, that one message could be sent twice.

## When jobs run

1. Immediately after the payment webhook responds, and after an order is marked shipped.
2. Every time the scheduler calls `GET /api/cron/jobs` with `Authorization: Bearer <CRON_SECRET>`. This also cancels unpaid orders whose stock hold has expired. **Run it every 5 minutes** (Vercel Cron, or any scheduler). Without it, retries and stock release do not happen.
3. On demand from Admin → Notifications ("Send waiting now", "Retry").

## Setting up each channel

Nothing below has been connected or tested against the real services. Each needs an account you create.

### Email — Resend
1. Create a Resend account and add your domain; add the DNS records it gives you.
2. Set `RESEND_API_KEY` and `EMAIL_FROM` (an address on that domain).

### WhatsApp — Meta Cloud API
1. Create a Meta Business account, verify the business, and add a WhatsApp Business phone number (a number not already used in the WhatsApp app).
2. Create a **utility** message template and submit it for approval. Suggested body, with six variables:

   ```
   New order received
   Order: {{1}}
   Customer: {{2}}
   Products: {{3}}
   Total: {{4}}
   Shipping: {{5}}
   Payment: {{6}}
   View the order in the admin dashboard.
   ```

   WhatsApp does not allow line breaks inside a variable, so products arrive on one line separated by semicolons.
3. Create a permanent system-user access token with the `whatsapp_business_messaging` permission.
4. Set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION` (from Meta's docs), `WHATSAPP_TEMPLATE_NAME` and `WHATSAPP_TEMPLATE_LANG`.
5. In Admin → Settings, enter the recipient number in international format.

### SMS — Twilio (optional)
Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, then switch SMS on in Admin → Settings.

## Shipping carriers

`src/server/shipping/carriers.ts` defines the interface every carrier adapter implements (create a label, read tracking). **No adapter is implemented.** Staff enter the carrier and tracking details by hand when shipping. A carrier API needs a contract and credentials; Sendcloud is the recommended first adapter because one account covers bpost, DHL and UPS. Customs data is part of the interface but unused, since only EU destinations are offered.
