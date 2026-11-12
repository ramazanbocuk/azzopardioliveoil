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
- [ ] Carrier contract, or Sendcloud (then the adapter must be built)
- [ ] Uptime monitor and log alert

## Before opening
- [ ] One real end-to-end purchase with a live card, then refund it from the admin
- [ ] One real message through each channel
- [ ] One practice database restore
- [ ] First administrator created; seed password removed; staff accounts created with the right roles
- [ ] `security.txt` with a contact address
- [ ] Screen-reader and keyboard walk-through of checkout
- [ ] Test in Safari and Firefox, and on real phones

## Known software gaps at hand-over

Built since the first hand-over: the 22-section admin, eleven order statuses, part-shipments, carrier adapters, sales and VAT reports, suppliers, lot recall, reviews moderation, wholesale terms, journal articles, announcement, product photo upload and staff two-factor sign-in.

Still not built, or not proven:

- **Carriers:** DHL Express, FedEx and bpost adapters are written from the carriers' documentation and have never called a carrier. Each needs an account and a test booking. See `docs/shipping.md`.
- **Photos on the shop:** photos can be uploaded and are stored, but product pages still show the illustrated bottle.
- **Content:** home page sections, story pages and legal pages are edited in code, not in the admin.
- **Wholesale:** no application form for customers, no invoice payment terms, no minimum quantities or tiered price lists.
- **Marketing:** no newsletter sending, no abandoned-cart reminders, no advertising or analytics tags.
- **Accounting:** reports are working figures, not a VAT return; no credit notes; no separate invoice numbering; no link to accounting software.
- **Security:** two-factor sign-in is optional per person and cannot be made compulsory; no single sign-on.
- **Also:** Mollie, multilingual pages, saved customer addresses, bulk invoice and label printing, carrier pickup booking and return labels, tracking of refunds or disputes made directly in Stripe.
- **Admin API:** the admin screens call the service layer directly; the admin GraphQL endpoint still covers sign-in, products and stock only.
