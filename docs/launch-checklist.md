# Launch checklist

The software cannot do these for you. Each is needed before taking real orders.

## Business information (only you have it)
- [ ] Legal entity name, registered address, enterprise and VAT numbers → Admin → Settings
- [ ] Contact email and phone → Admin → Settings
- [ ] Real product names, sizes, prices, packed weights, stock → Admin → Products (replace the placeholders)
- [ ] Label information for each product: origin, variety, ingredients, storage, nutrition declaration
- [ ] Lots: number, harvest, grove, mill, bottling and best-before dates → Admin → Lots
- [ ] Real shipping zones and rates → Admin → Shipping & VAT (replace "placeholder rate")
- [ ] Logo artwork; product and grove photography; final copy for Our Story, Groves, Harvest and the Journal

## Legal and tax (needs a professional)
- [ ] VAT: rate per destination country; whether cross-border EU sales exceed the threshold for destination-country VAT (One-Stop Shop); whether shipping carries the goods' rate
- [ ] Invoices: required content and whether sequential invoice numbers separate from order numbers are needed
- [ ] Privacy policy, cookie policy, terms and conditions, shipping and returns: complete the bracketed gaps and have them reviewed
- [ ] Right of withdrawal wording and who pays return shipping
- [ ] Food law: registration as a food business with the Belgian food safety agency; EU food-information rules for distance selling; olive oil marketing standards
- [ ] No health or nutrition claim is published without the supporting analysis and reviewed wording
- [ ] Packaging obligations in Belgium and in each country shipped to (for example Germany and France)
- [ ] Data-processing agreements with each provider; record of processing activities

## Accounts to create and connect
- [ ] Hosting and database (EU region), with point-in-time recovery on
- [ ] Domain name and DNS
- [ ] Stripe: live keys, webhook endpoint, payment methods enabled (cards, Bancontact, Apple Pay, Google Pay)
- [ ] Resend: domain verified
- [ ] WhatsApp Business Platform: business verified, number registered, template approved
- [ ] Anthropic: API key in the host's environment, a spending limit set in the Anthropic console as well as the monthly budget in the admin
- [ ] Carrier contract, or Sendcloud (then the adapter must be built)
- [ ] Uptime monitor and log alert

## Before opening
- [ ] One real end-to-end purchase with a live card, then refund it from the admin
- [ ] One refund made in the Stripe Dashboard (test mode), checked to appear on the order within a minute
- [ ] One real message through each channel
- [ ] Staff assistant, before switching it on: the privacy policy and record of processing cover customer and order details being sent to Anthropic; the six test questions in `assistant.md` asked by an administrator and by a support account, and the answers checked
- [ ] Customer assistant, before switching it on: the privacy policy names Anthropic as a processor and says conversations are kept (90 days for guests); a first session of real questions in each language read by a person; the test questions in `assistant.md` asked and the answers checked
- [ ] One practice database restore
- [ ] First administrator created; seed password removed; staff accounts created with the right roles
- [ ] `security.txt` with a contact address
- [ ] Screen-reader and keyboard walk-through of checkout
- [ ] Test in Safari and Firefox, and on real phones

## Known software gaps at hand-over

Measured against the full enterprise brief. "Not proven" means written and tested against documentation, never against the real service.

**Not proven**
- Staff assistant: never run against the real model either. Permissions, proposals and approval are tested with a scripted model; what a real model chooses to propose or say is not. No automated evaluation against the real model exists yet.
- Customer assistant: never run against the real model (no API key). The tools, limits, budget and records are tested with a scripted model; the wording of real answers, real token costs and the fallback model are not. See `assistant.md`.
- DHL Express, FedEx and bpost adapters: no carrier account exists, so none has called a carrier. Label format names and the bpost national box must be confirmed on a first test booking. See `shipping.md`.
- Stripe live mode, delayed payment methods, and email to addresses other than your own (needs a verified domain).

**Not built**
- *Payments:* PayPal as its own integration (it can be switched on inside Stripe Checkout), Mollie, recording the provider's fees. Refunds and disputes made at Stripe are mirrored, but only tested against signed sample events, not yet against a real refund or dispute in Stripe; a dispute cannot be answered from the admin panel; a lost dispute does not change the order's payment status or the sales and VAT reports; a refund in a currency other than the order's (Stripe Adaptive Pricing) is flagged for a person rather than recorded.
- *Shipping:* carrier push updates, pickup booking, return labels, insurance, one-file bulk label printing, ZPL labels, rules by package size.
- *Inventory:* several warehouses, part-received purchase orders, packaging variants, barcode scanning.
- *Products:* dimensions, VAT category per product (one rate per destination country applies to everything), videos, bundles, gift sets, subscriptions, translated product pages.
- *Wholesale:* separate price lists, minimum quantities, volume tiers, VAT-number validation with VIES, payment on invoice, a customer application form.
- *Accounting:* credit notes, separate invoice numbering, PDF files (invoices print from the browser), OSS returns, profitability (needs fees and full cost data).
- *Marketing:* sending newsletters, abandoned-cart emails, analytics or advertising tags, conversion rate.
- *Content:* home page, story pages and legal pages are edited in code. Uploaded product photos are stored but not yet shown on the shop.
- *Security:* compulsory two-factor sign-in, suspicious-sign-in alerts, single sign-on.
- *API:* the admin screens call the service layer directly. The admin GraphQL endpoint covers sign-in, products and stock only; it is not a full documented admin API.
- *Operations:* staging environment, error-tracking and performance monitoring services, load testing, a penetration test.
- *Emails:* order-processing and delivery-confirmation emails, failed-payment email to the customer, branded email design beyond the current template.

**Needs a person, not software**
- Everything under "Legal and tax" above, FAVV/AFSCA registration, packaging obligations, customs advice per destination, an EORI number for exports.
- *Languages:* the five non-English languages have had no native-speaker review; the home, story, FAQ and legal pages are English only; product text is English until translated in Admin → Translations. See `docs/internationalisation.md`.
- *Product data:* no producer, variety, harvest batch or laboratory report has been entered; the product page shows dashes and "no verified results" until they are. No health claim may be added without food-law advice. See `docs/product-intelligence.md`.
- *Carriers:* bpost, DHL Express, UPS and FedEx are written from documentation and none has made a real call; the first label for each must be booked in the carrier's test environment. Tracking is polled, not pushed. No pickups, return labels or insurance.
- *Fulfilment:* backorders are off for every product until switched on; stock is counted per size, not per lot; shipment notifications are email only. See `docs/fulfilment.md`.
