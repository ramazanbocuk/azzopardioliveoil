# Markets, currencies and compulsory two-factor sign-in

Phase 9 of the platform plan. Built 2026-11-18. **No order has been placed in dollars or pounds outside the automated tests, and no payment has been taken in either.**

## The rule

An amount is in exactly one currency. Nothing is ever converted, and amounts in different currencies are never added together.

- A **market** is a group of delivery countries sold to in one currency (`Market`: code, name, currency, countries, open or closed). Currencies: EUR, USD, GBP.
- **Euro is the base.** A country in no market is sold to in euro, at the price on the size (`Variant.priceCents`). The shop behaves exactly as before until a market is created.
- **Other currencies have their own prices**, typed in by the owner per size (`VariantPrice`). A size with no price in a currency is not sold in it: it cannot be added to a cart bound for that market, and a cart that already holds it cannot be checked out there.
- **The currency follows the delivery country, not the language.** A visitor reading German who has a parcel sent to New York pays in dollars.

## How the currency is chosen

1. The delivery country the visitor chose in the selector (cookie `azz_ship`).
2. Otherwise the country the page address names: `/en-us/` is the United States, `/en-gb/` the United Kingdom.
3. Otherwise euro.

The page and the server apply the same pure rule (`src/i18n/currency.ts`: `marketOf`, `priceIn`). The catalogue sends every price that was set; the page picks one and never calculates.

**Checkout decides again, from the address actually entered.** The browser sends the currency the customer was shown; if the delivery address is charged in another, the order is refused with a message and the cart is priced again. Nobody is charged at prices they did not see.

## What carries a currency

| Thing | Rule |
|---|---|
| Shipping zone | `ShippingZone.currency`. Its rates and free-shipping thresholds are amounts in that currency. It serves a country only when that country is sold to in the same currency |
| Discount code | `Discount.currency`. A fixed amount, or a minimum order, applies only to orders in that currency. A plain percentage works in any |
| Trade (wholesale) terms | A percentage: any currency |
| Order, payment, refund | The order's currency, fixed when it is placed. Stripe is asked for that currency. A refund goes back in it |
| Emails, invoices, order pages | The order's currency, in the number format of the customer's language |

## Stopping a sale

- **Close a market** (Admin → Markets & currencies): nothing is delivered to its countries.
- **Exclude a product from countries** (the product's page, "Not sent to these countries"): checkout refuses that product for those destinations.
- A country is offered at checkout only when its market is open and a shipping zone in that market's currency serves it.

The markets screen lists what would silently stop a sale: countries with no shipping zone in their currency, sizes on sale with no price in a market's currency, and zones written in a currency none of their countries uses.

## Reports

Sales, VAT, payments and the dashboard show **one currency at a time** (euro unless another is chosen; the selector appears once money has been received in a second currency). Customer and trade-account totals are in euro, with any other currency stated beside them in words ("+ 48.00 USD"). CSV exports name their currency. Both assistants write a non-euro amount with its code ("42.00 USD") and are told never to add currencies.

## Tax: what this does not do

- VAT is a rate per destination country (Admin → Shipping & VAT) applied to VAT-inclusive prices. Nothing is hardcoded.
- **United States sales tax is not calculated.** An order to a country with no rate records no tax at all, and the shop shows "VAT included" only beside euro prices.
- **United Kingdom import VAT and duties are not handled.**
- Whether prices in a market are shown with or without tax, and what must be collected, is a question for a tax adviser before that market opens.

## Opening a market: the order of work

1. Take tax and import advice for that country (food import rules included).
2. Type in the price of each size in the market's currency (product page).
3. Add a shipping zone in that currency with its rates (Shipping & VAT).
4. Create the market, open (Markets & currencies). Only an administrator can.
5. Place a test order to an address there with Stripe in test mode and read the confirmation email.

## Compulsory two-factor sign-in for staff

- **In production every staff account must have a second factor, and there is no setting that switches this off.** A signed-in member of staff without one sees a single screen, "Set up two-factor sign-in", and nothing else of the panel.
- It is enforced on the server as well as on the screen: `requireAdmin` and `requireStaff` refuse every action except setting up the second factor and managing one's own sessions. An administrator without a second factor cannot reset anyone else's.
- Outside production (tests, a developer's machine) it is enforced only when `ADMIN_TWO_FACTOR=required`, so a fresh local database is not locked before anyone has a phone enrolled. The server prints a warning when it is not being enforced.
- A lost phone: an administrator resets the person's second factor under Security; they are signed out and set it up again at next sign-in. If the only administrator loses theirs, `npm run admin:set-password` on the server resets the password and clears the second factor.

## Tested

`e2e/markets.spec.ts`, one browser test against a production build: a member of staff signs in for the first time, is shown only the setup screen, is refused a wrong code, enrols, enters a dollar price, a dollar shipping zone and a United States market in the admin; a customer then chooses delivery to the United States and sees dollar prices on the shop, product, cart and checkout pages, with "not available" on the sizes that have no dollar price. That test found a defect the server tests could not: the setup screen did not move on after "Start", because a layout is not rendered again after a server action (fixed with `refresh()`).

`tests/integration/markets.test.ts`, 10 tests: the rule; a cart priced in the delivery country's currency; a size with no price refused; a cart repriced when the delivery country changes; shipping in the destination's currency; a euro zone not serving a dollar country; an order placed in dollars with the payment provider asked for dollars; the mismatch guard; product exclusions; a closed market; markets and prices in the admin with their permissions; reports per currency; and two-factor enforcement, enrolment and its limits. All 256 tests and 24 browser tests pass.

## Not proven

- No real payment in USD or GBP. Stripe was replaced by a stand-in in the tests; the live account must be enabled for those currencies.
- The browser test stops at the checkout page showing dollar totals; it does not submit the order. Placing a dollar order is covered by the server test, with a stand-in for Stripe.
- Pounds have had no browser test; the code path is the same as dollars.
- New interface lines in five languages ("not available for delivery to your country") have had no native review. Refusal messages from the server about currency are in English only.
- Stock is one pool for all markets. There is no stock per market or warehouse.
- Carrier quotes and charges are shown in whatever currency the carrier states and are not compared with the order's currency.
