# Orders, stock and several shipments

Phase 5 of the master platform brief. Built on 2026-11-15. Carrier connections are described in `docs/shipping.md`.

## The numbers on an order line

| Number | Meaning |
|---|---|
| Ordered | What the customer bought |
| Shipped | Units that have left in a shipment |
| Removed | Units taken off the order after payment because they will not be supplied |
| Backorder | Units paid for that are still waiting for stock |
| Can ship | Ordered − removed − shipped − backorder: what is on the shelf for this order today |

An order is "shipped" only when every unit still on it has left. Until then it is "partially shipped". A unit on backorder cannot be put in a shipment, by hand or through a carrier label: the server refuses.

## One order, several shipments

- Open the order, choose the quantity of each line for this parcel and, optionally, the lot it is packed from. Repeat when the rest is ready. Each shipment has its own carrier, tracking number, boxes and packing slip.
- The lot is recorded per shipped line, so two parcels of one product can come from two bottlings and each stays traceable. A lot must exist for that product.
- **Packing slip per shipment:** lists that parcel's lines, quantities and lots, "Shipment 2 of 2", and what is still to follow.
- **The customer** sees one order with a card per shipment (contents, status, date, carrier, tracking link) and a "still to come" card saying what is being prepared and what is waiting for stock. This is on the order confirmation page, the order tracking page and in their account, in their language.
- **One email per shipment**, in the customer's language, listing what is in that parcel, its own tracking, and either what is still to follow or that the parcel completes the order.

## Backorders

Off by default. Switched on per product (Products → a product → "Allow orders when out of stock"), with an optional sentence about the wait that the owner writes.

- With the switch off, nothing changes: a quantity beyond the shelf is refused in the cart and at checkout.
- With it on, the cart and checkout say how many are in stock now and how many follow later in a separate parcel, at no extra shipping cost. The product page says it is not in stock and can be ordered.
- At checkout the units on the shelf are held; the rest is noted on the line. When the payment is confirmed, the held units are sold and a **backorder** is created for the rest.
- A backorder is also created when a payment arrives after its stock hold had lapsed and the bottles have gone. The customer has paid, so the units are owed; staff are alerted in the audit log (`order.paid_without_stock`).
- **Arriving stock** (a purchase order received, a stock adjustment, a restocked refund, a lapsed hold) goes first to open backorders, oldest order first, before anything returns to sale. The order's staff timeline says so.
- **Admin → Backorders** lists units owed per product (what to order) and the orders waiting, oldest first. The dashboard shows partly shipped orders and units on backorder.

## Taking units off a paid order

Managers can remove units that will not be supplied (order page → "Take units off the order"). Units still waiting for stock are cancelled first; any others go back on sale. **No money moves**: the refund is a separate step, and the staff timeline records what those units cost so it is not forgotten. A full refund closes whatever is still owed, so a later delivery is not set aside for an order that is owed nothing; restocking returns only units that had actually left the shelf.

## Stock holds

`Variant.stock` is what can still be sold or is held for unpaid orders; a paid unit leaves it at payment. `Variant.reserved` is the held part. Every hold now has a `StockReservation` row (order, line, quantity, expiry; HELD, CONVERTED or RELEASED), so staff can see which unpaid order is holding which bottles. The counter is the running total of the HELD rows.

## Not done

- **Stock per batch.** Stock is still counted per size, not per lot. The lot is recorded when a line is shipped, not reserved in advance.
- **Tracking events as rows, and delivery exceptions** (Phase 6). A shipment's status is updated from the carrier when one is connected; none is.
- **WhatsApp and in-account notifications** per shipment. Email only.
- **Automatic refund** when units are removed. Deliberately manual.
- **Returns of part of a shipment** beyond the existing return request and partial refund.
- A real carrier label per shipment remains unproven (no carrier account).
