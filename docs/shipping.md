# Shipping carriers

Labels can be booked with **bpost**, **DHL Express** and **FedEx** from an order page. Each carrier is an adapter in `src/server/shipping/` behind one interface (`carriers.ts`). A carrier is connected when its credentials are in the server environment; nothing else makes one appear, and nothing is simulated.

## Status: written from the carriers' documentation, never run against a carrier

No carrier account exists yet, so none of the three adapters has made a real call. The automated tests pin the requests each adapter sends and how it reads documented responses; they cannot prove a carrier accepts them. **The first booking for each carrier must be made in that carrier's test environment, and checked on the carrier's side, before any real parcel.** Expect small corrections at that point.

| Carrier | API | Source | Rates | Cancel by API | Test environment |
|---|---|---|---|---|---|
| DHL Express | MyDHL API (REST), reference v3.4.1 | developer.dhl.com | Yes, account rates | No: MyDHL has no cancel-shipment operation | `DHL_EXPRESS_ENV="test"` (default) |
| FedEx | OAuth + Rate, Ship, Track REST APIs | developer.fedex.com | Yes, account rates | Yes | `FEDEX_ENV="sandbox"` (default) |
| bpost | Shipping Manager API v5 (XML), manual v3.3.35 | bpost integration knowledge base | No: contract prices | Yes | None: use a test account, cancel test orders |

Known points to confirm on the first test call:

- **bpost** national box layout (`<atHome>`) and the cancel body follow the published XSDs rather than a worked example in the manual; the unit of `parcelValue` (sent in cents) must be checked.
- **bpost** needs street and house number separately. They are split from the address line; an address with no readable number is refused with a message rather than guessed.
- **DHL** label template is `ECOM26_84_001` (A6); product codes offered without rating are P (worldwide non-EU), U (worldwide EU), N (domestic).
- **FedEx** label is a 4×6 PDF (`PAPER_4X6`); duties are billed to the recipient (DAP).

## What you need from each carrier

- **DHL Express:** an Express customer account, then MyDHL API credentials (key, secret) and the account number.
- **FedEx:** a shipping account, then a project on developer.fedex.com giving a client id and secret.
- **bpost:** a business contract with Shipping Manager, giving the account id and API passphrase.

Put them in the environment (see `.env.example`), restart, and check **Admin → Shipping & fulfilment**: the carrier shows "Connected" with its environment.

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
