# Shipping carriers

Labels can be booked with **bpost**, **DHL Express**, **UPS** and **FedEx** from an order page. Each carrier is an adapter in `src/server/shipping/` behind one interface (`carriers.ts`). A carrier is connected when its credentials are in the server environment; nothing else makes one appear, and nothing is simulated.

## Status: written from the carriers' documentation, never run against a carrier

No carrier account exists yet, so none of the four adapters has made a real call. The automated tests pin the requests each adapter sends and how it reads documented responses; they cannot prove a carrier accepts them. **The first booking for each carrier must be made in that carrier's test environment, and checked on the carrier's side, before any real parcel.** Expect small corrections at that point.

| Carrier | API | Source | Rates | Cancel by API | Test environment |
|---|---|---|---|---|---|
| DHL Express | MyDHL API (REST), reference v3.4.1 | developer.dhl.com | Yes, account rates | No: MyDHL has no cancel-shipment operation | `DHL_EXPRESS_ENV="test"` (default) |
| UPS | OAuth + Rating v2409, Shipping v2409, Tracking v1 (REST) | UPS OpenAPI files (github.com/UPS-API/api-documentation), read 2026-11-15 | Yes, negotiated rates | Yes (void) | `UPS_ENV="test"` (default): the Customer Integration Environment |
| FedEx | OAuth + Rate, Ship, Track REST APIs | developer.fedex.com | Yes, account rates | Yes | `FEDEX_ENV="sandbox"` (default) |
| bpost | Shipping Manager API v5 (XML), manual v3.3.35 | bpost integration knowledge base | No: contract prices | Yes | None: use a test account, cancel test orders |

Known points to confirm on the first test call:

- **bpost** national box layout (`<atHome>`) and the cancel body follow the published XSDs rather than a worked example in the manual; the unit of `parcelValue` (sent in cents) must be checked.
- **bpost** needs street and house number separately. They are split from the address line; an address with no readable number is refused with a message rather than guessed.
- **DHL** label template is `ECOM26_84_001` (A6); product codes offered without rating are P (worldwide non-EU), U (worldwide EU), N (domestic).
- **FedEx** label is a 4×6 PDF (`PAPER_4X6`); duties are billed to the recipient (DAP).
- **UPS** returns labels as GIF images (it offers GIF, PNG and printer languages, not PDF), 4×6, one per box. Services offered without rating are Standard (11), Express Saver (65), Express (07), Expedited (08) and Express Plus (54). No reference number is sent at shipment level, because UPS restricts it on some international lanes; the order number travels as the transaction reference. The commercial invoice is requested through UPS paperless forms (`InternationalForms`, type 01), which the account must have enabled. The meaning of the one-letter tracking types (D, RS, X, O, I, P, M) follows UPS's documentation and must be checked against real tracking answers.

## What you need from each carrier

- **DHL Express:** an Express customer account, then MyDHL API credentials (key, secret) and the account number.
- **UPS:** a shipping account (six-character account number), then an application on developer.ups.com with the Rating, Shipping and Tracking products, giving a client id and secret.
- **FedEx:** a shipping account, then a project on developer.fedex.com giving a client id and secret.
- **bpost:** a business contract with Shipping Manager, giving the account id and API passphrase.

Put them in the environment (see `.env.example`), restart, and check **Admin → Shipping & fulfilment**: the carrier shows "Connected" with its environment. For UPS and FedEx an administrator can press **Test sign-in** there: it asks the carrier for an access token and books nothing. It proves the credentials, not the label; DHL and bpost have no such harmless call.

## Before the first label

1. **Settings → Shipping origin:** sender name, street and number, postal code, city, country, phone. No label is booked without them.
2. **Products:** HS code and country of origin on every product sold outside the EU. Booking outside the EU is refused until every line has one.
3. Confirm with a customs adviser what may be shipped where. The software fills in the declaration; it does not decide whether a food product may enter a country.

## How it behaves

- **Compare:** the order page asks every connected carrier with a rating API for prices, cheapest first. One carrier failing never hides the others. The suggestion rule (none, cheapest, fastest) is under Settings.
- **Book:** the carrier is called first. If it refuses, nothing is recorded and its own error message is shown. If it accepts, the label is stored exactly as issued and can be reprinted.
- **Part-shipments:** a booking covers the units not yet shipped.
- **Cancel:** possible while the parcel is still "label created". Where the carrier has no cancel API (DHL), the shipment is cancelled in the shop only and the screen says so.
- **Tracking:** the scheduler re-reads tracking for parcels in transit every two hours and marks the order delivered when the carrier reports delivery. Carriers' push notifications (webhooks) are not used.
- **By hand:** recording a shipment with a typed carrier and tracking number always works, connected or not.

## Never paying for a label twice

Before a carrier is called, an attempt is written under a lock on the order. While one is open for the same units, a second click, a retry or a second person is refused. If the carrier refuses, the attempt closes and the order can be booked again. If the carrier never answers, the outcome is unknown: the order shows a notice and stays blocked until someone has checked with the carrier and pressed Release. An alert email goes to the shop either way.

## Label formats and documents

- **Label printer** (Settings): thermal 4×6 inch, or A4. It is passed to the carrier as its own format name (DHL `ECOM26_84_001` / `ECOM26_84_A4_001`, FedEx `PAPER_4X6` / `PAPER_85X11_TOP_HALF_LABEL`, bpost `A6` / `A4`). **Confirm each name on the first test booking.**
- Labels are stored as issued and can be reprinted from the order or the shipping dashboard. Several boxes give several labels where the carrier issues one per box.
- **Bulk booking**: up to 50 orders at once from the shipping dashboard, one box each.
- **Commercial invoice**: printable from any order, for parcels leaving the EU. It needs the HS code and origin on each product and your EORI number, which is printed as a gap to fill.

## Not built

Automatic carrier choice without a person confirming; pickup booking; return labels; pickup points and lockers; printing many labels as one file; carrier push notifications (tracking is polled); label formats other than PDF (ZPL); insurance options; sending customs documents electronically.

## Tracking and delivery problems

Built in Phase 6 (2026-11-15).

- **Events are stored as records** (`TrackingEvent`), one per thing the carrier reported, each kept once however often the carrier repeats its history. The scheduler asks each connected carrier about parcels still on their way, at most every two hours per parcel.
- **Without a carrier connection** there are no automatic events. Staff can add a tracking number and record events by hand on the order page ("Record tracking by hand"): on its way, out for delivery, problem, delivered, returned. These are stored as entered by a named person and shown to the customer. A number issued by a carrier through its API cannot be edited.
- **A delivery problem** (the carrier's exception, a failed delivery, a return to sender) puts a flag on the shipment, a note on the order's staff timeline and one alert email to the shop. It clears by itself when the parcel moves again or is delivered. **The customer is not emailed about a problem automatically**: many pass within hours, and the others need a person to write. The customer's order page does show that the carrier reports a problem.
- **Delivered** is set per parcel; the order becomes delivered when its last parcel arrives.
- **Shipping & fulfilment → Parcels that need attention** lists: a reported problem; a parcel past the carrier's own delivery estimate (or, with no estimate, on the road for more than ten days); a label not collected after two days; no tracking update for more than four days; a shipment sent without a tracking number. The dashboard counts parcels on their way and those with a problem.
- **Delivery dates** shown to customers are the carrier's own estimate, labelled as such, and only when the carrier gave one. The shop never calculates one.

Not done: carrier webhooks (tracking is polled); pickups; return labels; insurance; a "delivered" email to the customer; WhatsApp. Only UPS reports problems separately from failure today; for DHL, FedEx and bpost a problem is recognised when the carrier reports the parcel failed or returned.
