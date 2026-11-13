# Administrator's manual

How to run the shop from the admin panel at `/admin`. For setting up accounts and keys see `deployment.md` and `shipping.md`; for when something breaks see `operations.md`.

## Signing in

Every staff account needs two-factor sign-in. The first time you sign in you are asked to set it up with an authenticator app on your phone; the panel opens once that is done. If you lose the phone, an administrator resets it for you under Security.

Sign in with your email and password. If you have turned on two-factor sign-in (Security), enter the 6-digit code from your authenticator app as well. Five wrong passwords lock an address for 15 minutes. A lost phone: an administrator resets your two-factor sign-in under Security.

## The daily round

1. **Dashboard** — today's orders, revenue, low stock, orders waiting to ship.
2. **Shipping & fulfilment** — everything paid and not yet sent, oldest first.
3. Open an order → **Start processing** → pack → record the **lot** on each line → **Mark ready**.
4. **Book a carrier label** (enter boxes and weight → Compare services and prices → Book label → Print label), or **Record a shipment by hand** if no carrier is connected.
5. The customer is emailed the tracking link. Tracking is re-read every two hours and the order becomes Delivered when the carrier says so.

To send many at once: tick the orders on Shipping & fulfilment, choose a carrier and service, **Book labels**. Each order goes as one box weighing its goods plus the packaging weight from Settings.

## Orders

- **Statuses** are worked out from payment and fulfilment; you never set one by hand. Payment: unpaid, processing, paid, partially refunded, refunded, failed. Fulfilment: unfulfilled, processing, ready, partially shipped, shipped, delivered.
- **Filters**: status, payment, fulfilment, country, dates; search by order number, email, name, SKU or tracking number. **Export** downloads exactly what the filters show.
- **Bulk actions**: move to processing, mark ready, mark delivered. Orders that cannot take the step are skipped and listed.
- **Part-shipments**: set the units per line when recording or booking; the order is Shipped only when every unit has left.
- **Documents**: Invoice, Packing slip, Commercial invoice (for parcels leaving the EU). Print from the browser; "Save as PDF" gives a PDF.
- **Refund** (administrators and the accountant): sent through the payment provider first, recorded only if it succeeds; the customer is emailed.
- **Messages**: every email and alert for the order, with sent, skipped or failed and why.
- **Timeline**: who did what and when. Entries marked "staff only" are not shown to the customer.

## If a label booking goes wrong

- **The carrier refused** (bad address, missing data): its own message is shown, nothing was booked, fix and try again.
- **The carrier did not answer**: the order shows a red notice and booking is blocked for those items. Look in the carrier's own system. If a shipment exists, cancel it there or record it by hand. Then press **Release**. This is what stops a label being paid for twice.
- **Cancel a booked label**: on the shipment, while it is still "label created". DHL has no cancel API: it is cancelled in the shop only, and a label never handed over is not charged.

## Products and stock

- **Products**: name, copy, label facts (origin, variety, ingredients, storage), customs code and origin, variants with price, sale price, weight, barcode, unit cost, shelf location; photos.
- **Inventory**: on hand, held for unpaid orders, available, value at cost; adjust with a reason. Every change is in the ledger with who made it.
- **Purchasing** (from Inventory): create a purchase order for a supplier, mark it ordered, **Receive into stock** when it arrives. Receiving adds the units and records the unit cost, once.
- **Low stock**: when a sale takes a product to its alert level, one email a day goes to the notification address.

## Traceability and recall

- **Lots**: create each lot with its product, supplier, grove, mill and dates. Publishing a lot makes it visible to customers who enter its number.
- **Food traceability → Trace a lot**: every order that received it, with customer contact details, and an export. It is only as complete as the lot numbers recorded on order lines when packing.
- A recall is a legal process. The list tells you who to contact; your food-safety adviser and the authority tell you what you must do.

## Customers and wholesale

- **Customers**: accounts with spend, average order, last order; segments (repeat, VIP, wholesale, marketing consent); tags and staff notes. Notes are never shown to the customer but are part of their data if they ask for a copy.
- **Wholesale**: approve an existing account with a company name and a discount. It applies automatically when they are signed in and never combines with a code. They are emailed on approval.
- **Erase personal data** (administrators): removes the person's details, notes and tags; orders are kept for the legal retention period, detached from the account.

## Money and reports

- **Payments**: every payment and refund for a period, and the list of disputes. A refund made directly in Stripe appears on the order by itself, marked "at the payment provider", and the customer gets the refund email. Stock is never put back automatically. If a bank bounces a refund, it is marked failed, the order goes back to paid, and the shop is emailed.
- **Several shipments per order**: on the order page choose the quantities (and lot) for this parcel; repeat when the rest is ready. Each shipment has its own tracking, packing slip and customer email. See `docs/fulfilment.md`.
- **Tracking**: with a carrier connected, events arrive by themselves. Without one, open the shipment on the order page and use "Record tracking by hand" to add the tracking number and what you learn. Parcels with a problem, late or without a number are listed under Shipping & fulfilment. See `docs/shipping.md`.
- **Backorders**: off unless switched on per product. The Backorders screen lists what is owed and to whom; arriving stock is set aside for those orders automatically.
- **Taking units off an order**: managers only; it does not refund. Issue the refund afterwards.
- **Producers, Countries & regions, Olive varieties**: the reference lists. A producer is named on the shop only when marked public.
- **Harvest batches**: one per bottling, with its harvest year. Open "Documents and laboratory results" to upload the laboratory's report (PDF) and enter the values. Staff enter; a manager verifies the report and then each value. Only verified values of a published batch are shown to customers.
- **Laboratory results**: the list of what is still missing per batch and per product.
- **Translations**: products, categories and journal articles in German, Dutch, French, Italian and Spanish. Save a draft, then a manager publishes it; until then customers see English with a note. The overview shows what is missing or out of date. See `docs/internationalisation.md`.
- **Disputes** (chargebacks): when a cardholder contests a payment, the order shows a warning, the shop is emailed with the deadline, and the dispute is listed under Payments. Answer it in the Stripe Dashboard; it cannot be answered here. Do not ship a disputed order.
- **Analytics & reports**: sales by day, product, country, payment method; first-time and returning; export.
- **Accounting & VAT**: VAT by destination and rate; export for the accountant. Working figures, not a VAT return.
- **Shipping rates & VAT**: zones (any country codes), weight bands, free-shipping thresholds, VAT rate per country. Checkout offers exactly the countries that have a zone with an active rate.

## Staff and security

- **Staff & permissions**: create accounts, set roles. Roles: super administrator, administrator, operations manager, warehouse manager, shipping manager, customer support, accountant, marketing manager, read-only analyst (plus manager and staff, kept for older accounts). The screen shows what each can do.
- **Security**: your two-factor sign-in, signed-in devices (end a session to sign it out), failed sign-ins, security events.
- **Audit log**: every staff action.
- **Offboarding**: deactivate the account under Staff. It is signed out everywhere at once.

## Settings

- **System settings**: legal name, address, VAT number (printed on invoices); shipping origin, label printer (thermal 4×6 or A4), packaging weight, rate suggestion; notification recipients.
- **Integrations**: what is configured. Keys are set where the site is hosted, never in this panel.
- **Website content**: journal articles, announcement band.

## Customer assistant

- **Customer assistant**: whether it is answering and why not, this month's estimated spending against the budget, recent conversations (open one to read every message and every lookup it made), and the list of things it is able to do. Only an administrator can switch it on, and only with a monthly budget. When the budget is spent it stops and the shop is emailed once.
- **Knowledge base**: short articles the assistant may quote (storage, how to choose, gifts). It quotes only published articles marked for customers. Do not write health claims here: the assistant will repeat them.
- **Support requests**: questions the assistant passed to a person, with the customer's address and a summary. Urgent ones (damage, payment, complaint) are marked. Reply from the shop’s own mailbox, then mark the request answered.
- **Staff assistant**: ask it about orders, shipments, stock, sales and support requests; have it draft an email (it cannot send one), a translation draft or an unpublished article. It works with your own permissions. For a refund, taking units off an order, a stock adjustment or a support request's state it writes a **proposal**: read it, then press Approve or Reject. Nothing happens before you approve, and a proposal expires after 24 hours. It can be wrong: check what matters against the record it links to. Administrators see every proposal under Customer assistant.
- The assistant cannot place an order, take a payment, change an order or an address, or give a refund. It can only show an "add to cart" button the customer presses.

## Markets and currencies

- **Markets & currencies**: which countries are sold to in dollars or pounds. Everything else is sold in euro. Nothing is converted: a size is sold in another currency only if you typed its price in that currency on the product's page.
- Before opening a market: prices in its currency, a shipping zone in its currency (Shipping & VAT), and tax advice for that country. The screen warns about countries with no shipping and sizes with no price.
- Closing a market stops delivery to its countries. "Not sent to these countries" on a product stops that one product.
- Reports show one currency at a time; choose it at the top of the report.

## What the panel cannot do

See "Known software gaps" in `launch-checklist.md`.
