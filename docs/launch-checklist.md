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
Two-factor sign-in for staff · Mollie · carrier APIs and labels · product photo and document upload · homepage content management · multilingual pages (English only) · favourites synced to accounts · saved addresses and profile editing · nutrition table editor · admin GraphQL beyond sign-in, products and stock
