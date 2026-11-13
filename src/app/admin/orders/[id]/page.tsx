import Link from "next/link";
import { Badge, Card, Check, Field, Flash, LinkButton, Page, Submit, Table, TextArea, cellLink, dateTime, euros, money } from "@/components/admin/ui";
import { getOrder } from "@/server/admin";
import { AppError } from "@/server/errors";
import { compareRates, openAttempts, type RateComparison } from "@/server/fulfilment";
import { carrierStates } from "@/server/shipping/registry";
import { adminCtx } from "@/server/adminSession";
import { DISPUTE_LABEL } from "@/server/paymentSync";
import { FULFILMENT_LABEL, ORDER_STATUS_LABEL, PAYMENT_ALLOWS_FULFILMENT } from "@/server/orderStatus";
import { openBackorder, outstanding, readyToShip } from "@/server/stock";
import { can } from "@/server/permissions";
import { EVENT_KINDS, EVENT_KIND_LABEL } from "@/server/tracking";
import { addTrackingEvent, setTrackingNumber, cancelUnits, addNote, bookCarrierLabel, releaseShipmentAttempt, cancelOrder, cancelShipment, deliver, markReady, refund, returnStatus, setLot, ship, startPacking } from "../../actions";

export const metadata = { title: "Order" };

const percent = (bps: number) => `${(bps / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;
const kilos = (grams: number) => `${(grams / 1000).toLocaleString("en-GB", { maximumFractionDigits: 3 })} kg`;
const MESSAGE_LABEL: Record<string, string> = {
  "notify.customer.confirmation": "Order confirmation email to the customer",
  "notify.customer.shipped": "Shipping email to the customer",
  "notify.owner.email": "New-order email to the shop",
  "notify.owner.whatsapp": "New-order WhatsApp to the shop",
  "notify.owner.sms": "New-order SMS to the shop",
  "notify.customer.refund": "Refund email to the customer",
  "notify.owner.payment_alert": "Refund or dispute alert to the shop",
  "notify.owner.label_failed": "Failed-label alert to the shop",
};

function Address({ lines }: { lines: (string | null | undefined)[] }) {
  return (
    <address className="not-italic">
      {lines.filter(Boolean).map((line, index) => (
        <span key={index} className="block">
          {line}
        </span>
      ))}
    </address>
  );
}

export default async function OrderPage({ params, searchParams }: PageProps<"/admin/orders/[id]">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [{ id }, flash] = await Promise.all([params, searchParams]);
  const order = await getOrder(ctx, id);
  const refunded = order.payments.flatMap((p) => p.refunds).filter((r) => !r.failedAt).reduce((sum, r) => sum + r.amountCents, 0);
  const openDisputes = order.payments.flatMap((p) => p.disputes).filter((d) => !d.closedAt);
  const refundable = order.payments.filter((p) => p.status === "PAID" || p.status === "PARTIALLY_REFUNDED").reduce((sum, p) => sum + p.amountCents, 0) - refunded;

  const moneyHeld = !order.cancelledAt && PAYMENT_ALLOWS_FULFILMENT.includes(order.paymentStatus);
  // "left" is what can go in a parcel today: units still on backorder are not on the shelf for this order.
  const remaining = order.items.map((item) => ({ item, left: readyToShip(item) })).filter((row) => row.left > 0);
  const waitingUnits = order.items.reduce((sum, item) => sum + openBackorder(item.backorder), 0);
  const removable = moneyHeld ? order.items.filter((item) => outstanding(item) > 0) : [];
  const mayRemove = can(ctx.admin.role, "MANAGER", "orders");
  const canShip = moneyHeld && remaining.length > 0;
  const remainingGrams = remaining.reduce((sum, row) => sum + row.item.weightGrams * row.left, 0);
  const goodsTax = order.taxCents === null ? null : order.taxCents - (order.shippingTaxCents ?? 0);
  const sameBilling = order.billLine1 === order.shipLine1 && order.billPostalCode === order.shipPostalCode && order.billLastName === order.shipLastName && !order.billCompany;
  // Carrier label: the box details travel in the address, so "Compare rates" is a plain link that can be reloaded.
  const carriers = carrierStates().filter((carrier) => carrier.connected);
  const query = (key: string) => (typeof flash[key] === "string" ? (flash[key] as string) : "");
  const box = { boxes: query("boxes") || "1", weightKg: query("weightKg") || (remainingGrams ? (remainingGrams / 1000).toFixed(2) : ""), lengthCm: query("lengthCm"), widthCm: query("widthCm"), heightCm: query("heightCm") };
  let rates: RateComparison | null = null;
  let ratesError = "";
  if (canShip && carriers.length > 0 && query("rates") === "1") {
    const number = (value: string) => Number(value.replace(",", "."));
    const mm = (value: string) => (value.trim() ? Math.round(number(value) * 10) : null);
    const count = Math.min(20, Math.max(1, Math.round(number(box.boxes)) || 1));
    try {
      rates = await compareRates(ctx, order.id, Array.from({ length: count }, () => ({ weightGrams: Math.round(number(box.weightKg) * 1000), lengthMm: mm(box.lengthCm), widthMm: mm(box.widthCm), heightMm: mm(box.heightCm) })));
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      ratesError = error.message;
    }
  }
  const boxFields = (
    <>
      <input type="hidden" name="boxes" value={box.boxes} />
      <input type="hidden" name="weightKg" value={box.weightKg} />
      <input type="hidden" name="lengthCm" value={box.lengthCm} />
      <input type="hidden" name="widthCm" value={box.widthCm} />
      <input type="hidden" name="heightCm" value={box.heightCm} />
    </>
  );
  const attempts = await openAttempts(ctx, order.id);
  const itemName = (orderItemId: string) => {
    const item = order.items.find((candidate) => candidate.id === orderItemId);
    return item ? `${item.productName} ${item.variantLabel}` : "Removed line";
  };

  return (
    <Page
      title={order.number ?? "Order"}
      eyebrow={`Placed ${dateTime(order.placedAt)}`}
      actions={
        <>
          <LinkButton href={`/admin/orders/${order.id}/invoice`} target="_blank">Invoice</LinkButton>
          <LinkButton href={`/admin/orders/${order.id}/packing-slip`} target="_blank">Packing slip</LinkButton>
          <LinkButton href={`/admin/orders/${order.id}/commercial-invoice`} target="_blank">Commercial invoice</LinkButton>
        </>
      }
    >
      <Flash params={flash} />
      {openDisputes.length > 0 && (
        <p role="alert" className="border-l-2 border-terracotta-700 bg-terracotta-500/10 px-4 py-3 text-terracotta-700">
          The cardholder has disputed this payment with their bank. Do not ship until it is settled, and answer the dispute at the payment provider
          {openDisputes[0].evidenceDueAt ? ` by ${dateTime(openDisputes[0].evidenceDueAt)}` : ""}. It cannot be answered from here.
        </p>
      )}
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        {[
          ["Order", <Badge key="s" tone={order.status}>{ORDER_STATUS_LABEL[order.status]}</Badge>],
          ["Payment", <Badge key="p">{order.paymentStatus}</Badge>],
          ["Fulfilment", <Badge key="f" tone={order.fulfilmentStatus}>{FULFILMENT_LABEL[order.fulfilmentStatus]}</Badge>],
        ].map(([label, badge]) => (
          <div key={label as string} className="flex items-center gap-2">
            <dt className="text-small text-stone-700">{label}</dt>
            <dd>{badge}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-8 xl:grid-cols-3">
        <div className="min-w-0 space-y-8 xl:col-span-2">
          <Card title="Stock and dispatch" description="For each line: what was ordered, what is on the shelf now, what is held while payment is awaited, what has gone, what can go today, what is still waiting for stock, and what was taken off the order.">
            <Table head={["Product", "Ordered", "On shelf", "Held", "Shipped", "Can ship", "Backorder", "Removed"]}>
              {order.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.productName} {item.variantLabel}
                  </td>
                  <td className="tabular-nums">{item.quantity}</td>
                  <td className="tabular-nums">{item.variantId ? (order.availability[item.variantId] ?? "—") : "—"}</td>
                  <td className="tabular-nums">{item.reservations.reduce((sum, hold) => sum + hold.quantity, 0)}</td>
                  <td className="tabular-nums">{item.shippedQuantity}</td>
                  <td className="tabular-nums">{moneyHeld ? readyToShip(item) : 0}</td>
                  <td className="tabular-nums">{openBackorder(item.backorder) > 0 ? <strong className="text-terracotta-700">{openBackorder(item.backorder)}</strong> : 0}</td>
                  <td className="tabular-nums">{item.cancelledQuantity}</td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title="Items" description="Prices as charged. The lot of each parcel is recorded when it is packed; the lot shown here is the first one used for the line.">
            <Table head={["Product", "Qty", "Unit", "Line", "VAT", "First lot"]}>
              {order.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.productName} {item.variantLabel}
                    <span className="block font-mono text-[0.75rem] text-stone-700">{item.sku}</span>
                  </td>
                  <td className="tabular-nums">{item.quantity}</td>
                  <td className="tabular-nums">{money(item.unitPriceCents)}</td>
                  <td className="tabular-nums">{money(item.lineTotalCents)}</td>
                  <td className="whitespace-nowrap tabular-nums">
                    {item.taxCents === null ? "—" : money(item.taxCents)}
                    {item.taxRateBps !== null && <span className="text-small block text-stone-700">{percent(item.taxRateBps)}</span>}
                  </td>
                  <td>
                    <form action={setLot.bind(null, order.id, item.id)} className="flex items-center gap-2">
                      <input name="lotNumber" defaultValue={item.lotNumber ?? ""} aria-label={`Lot for ${item.productName} ${item.variantLabel}`} placeholder="AZ-0001" className="h-9 w-28 border border-ink/25 px-2 font-mono text-[0.8125rem]" />
                      <Submit variant="secondary" className="!h-9 !px-3">Set</Submit>
                    </form>
                  </td>
                </tr>
              ))}
            </Table>
            <dl className="ml-auto mt-5 max-w-sm space-y-1.5">
              {[
                ["Subtotal", money(order.subtotalCents)],
                ...(order.discountCents ? [[`Discount ${order.discountCode ?? ""}`, `−${money(order.discountCents)}`]] : []),
                [`Shipping · ${order.shippingRateName}`, money(order.shippingCents)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-6 text-[0.9375rem]">
                  <dt className="text-stone-700">{label}</dt>
                  <dd className="tabular-nums">{value}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-6 border-t border-ink/15 pt-2 font-medium">
                <dt>Total</dt>
                <dd className="tabular-nums">{money(order.totalCents)}</dd>
              </div>
              <div className="text-small space-y-1 pt-2 text-stone-700">
                {order.taxCents === null || order.taxRateBps === null ? (
                  <p>No VAT rate was set for {order.shipCountryCode} when this order was placed.</p>
                ) : (
                  <>
                    <div className="flex justify-between gap-6">
                      <dt>VAT {percent(order.taxRateBps)} on goods</dt>
                      <dd className="tabular-nums">{money(goodsTax ?? 0)}</dd>
                    </div>
                    <div className="flex justify-between gap-6">
                      <dt>VAT {percent(order.taxRateBps)} on shipping</dt>
                      <dd className="tabular-nums">{order.shippingTaxCents === null ? "—" : money(order.shippingTaxCents)}</dd>
                    </div>
                    <div className="flex justify-between gap-6">
                      <dt>VAT included in total</dt>
                      <dd className="tabular-nums">{money(order.taxCents)}</dd>
                    </div>
                    <div className="flex justify-between gap-6">
                      <dt>Total excluding VAT</dt>
                      <dd className="tabular-nums">{money(order.totalCents - order.taxCents)}</dd>
                    </div>
                  </>
                )}
              </div>
            </dl>
          </Card>

          <Card title="Fulfilment">
            {moneyHeld && waitingUnits > 0 && (
              <p role="status" className="mb-5 border-l-2 border-terracotta-700 bg-terracotta-500/10 px-4 py-3 text-terracotta-700">
                {waitingUnits} unit{waitingUnits === 1 ? " is" : "s are"} paid for but not in stock. {remaining.length > 0 ? "Ship what is ready now; the rest follows as its own shipment when stock arrives." : "Nothing can ship until stock arrives."} Arriving stock is set aside for this order automatically, oldest order first.
              </p>
            )}
            {!moneyHeld && !order.cancelledAt && order.paymentStatus !== "REFUNDED" && (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-stone-700">
                  {order.paymentStatus === "PROCESSING" ? "The customer’s bank is still confirming the payment. Nothing ships until it does." : `Waiting for payment. Stock is held until ${dateTime(order.reservedUntil)}.`}
                </p>
                {order.paymentStatus !== "PROCESSING" && (
                  <form action={cancelOrder.bind(null, order.id)}>
                    <Submit variant="danger">Cancel order</Submit>
                  </form>
                )}
              </div>
            )}
            {moneyHeld && (order.fulfilmentStatus === "UNFULFILLED" || order.fulfilmentStatus === "PROCESSING") && (
              <div className="mb-6 flex flex-wrap gap-3">
                {order.fulfilmentStatus === "UNFULFILLED" && (
                  <form action={startPacking.bind(null, order.id)}>
                    <Submit variant="secondary">Start processing</Submit>
                  </form>
                )}
                <form action={markReady.bind(null, order.id)}>
                  <Submit variant="secondary">Mark ready for fulfilment</Submit>
                </form>
              </div>
            )}

            {order.shipments.map((shipment, index) => (
              <div key={shipment.id} className="mb-5 border border-ink/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium">
                    Shipment {index + 1} · {shipment.carrier}
                    {shipment.service ? ` · ${shipment.service}` : ""}
                  </p>
                  <Badge>{shipment.status}</Badge>
                </div>
                <p className="text-small mt-1 text-stone-700">
                  {shipment.trackingNumber ? (
                    shipment.trackingUrl ? (
                      <a href={shipment.trackingUrl} target="_blank" rel="noreferrer" className={cellLink}>
                        {shipment.trackingNumber}
                      </a>
                    ) : (
                      shipment.trackingNumber
                    )
                  ) : (
                    "No tracking number"
                  )}{" "}
                  · sent {dateTime(shipment.shippedAt)}
                  {shipment.deliveredAt ? ` · delivered ${dateTime(shipment.deliveredAt)}` : ""}
                </p>
                {shipment.items.length > 0 && <p className="mt-2">{shipment.items.map((line) => `${line.quantity} × ${itemName(line.orderItemId)}${line.lotNumber ? ` (lot ${line.lotNumber})` : ""}`).join(", ")}</p>}
                <p className="mt-3">
                  <LinkButton href={`/admin/orders/${order.id}/packing-slip?shipment=${shipment.id}`} target="_blank">
                    Packing slip for this shipment
                  </LinkButton>
                </p>
                {shipment.labels.length > 0 && (
                  <p className="mt-3 flex flex-wrap gap-2">
                    {shipment.labels.map((label) => (
                      <LinkButton key={label.id} href={`/admin/shipments/${shipment.id}/label/${label.position}`} target="_blank">
                        {shipment.labels.length > 1 ? `Print label ${label.position + 1}` : "Print label"}
                      </LinkButton>
                    ))}
                  </p>
                )}
                {shipment.costCents !== null && <p className="text-small mt-2 text-stone-700">Carrier charge {money(shipment.costCents)}</p>}
                {shipment.exceptionAt && (
                  <p role="alert" className="mt-3 border-l-2 border-terracotta-700 bg-terracotta-500/10 px-3 py-2 text-terracotta-700">
                    Delivery problem since {dateTime(shipment.exceptionAt)}: {shipment.exceptionNote}. The customer has not been told automatically.
                  </p>
                )}
                {shipment.events.length > 0 && (
                  <ol className="text-small mt-3 space-y-1 border-t border-ink/10 pt-3 text-stone-700">
                    {shipment.events.slice(-8).map((event) => (
                      <li key={event.id}>
                        {dateTime(event.occurredAt)} · {event.description}
                        {event.location ? ` · ${event.location}` : ""}
                        {event.source === "manual" ? " · entered by staff" : ""}
                      </li>
                    ))}
                  </ol>
                )}
                {!shipment.cancelledAt && (
                  <details className="mt-3 border-t border-ink/10 pt-3">
                    <summary className="text-small cursor-pointer underline underline-offset-4">Record tracking by hand</summary>
                    <p className="text-small mt-2 text-stone-700">For a shipment sent without a carrier connection, or when you learn something the carrier’s system has not reported. It is stored as entered by you and shown to the customer.</p>
                    <form action={addTrackingEvent.bind(null, order.id, shipment.id)} className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 xl:items-end">
                      <label className="block">
                        <span className="text-small font-medium">What happened</span>
                        <select name="kind" defaultValue="INFO" className="mt-1.5 h-10 w-full border border-ink/25 bg-white px-3">
                          {EVENT_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {EVENT_KIND_LABEL[kind]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Field label="In a few words" name="description" required maxLength={300} placeholder="Arrived at the Brussels depot" />
                      <Field label="Place (optional)" name="location" maxLength={120} />
                      <Field label="When (empty = now)" name="occurredAt" type="datetime-local" />
                      <div>
                        <Submit variant="secondary">Record event</Submit>
                      </div>
                    </form>
                    {shipment.source !== "carrier" && (
                      <form action={setTrackingNumber.bind(null, order.id, shipment.id)} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                        <Field label="Tracking number" name="trackingNumber" required defaultValue={shipment.trackingNumber ?? ""} />
                        <Field label="Tracking link (optional)" name="trackingUrl" type="url" defaultValue={shipment.trackingUrl ?? ""} placeholder="https://…" />
                        <Submit variant="secondary">Save number</Submit>
                      </form>
                    )}
                  </details>
                )}
                {!shipment.cancelledAt && shipment.status === "LABEL_CREATED" && (
                  <form action={cancelShipment.bind(null, order.id, shipment.id)} className="mt-3">
                    <Submit variant="danger">Cancel this shipment</Submit>
                  </form>
                )}
                {shipment.parcels.length > 0 && (
                  <p className="text-small mt-1 text-stone-700">
                    {shipment.parcels.length} box{shipment.parcels.length === 1 ? "" : "es"}:{" "}
                    {shipment.parcels.map((parcel) => `${kilos(parcel.weightGrams)}${parcel.lengthMm && parcel.widthMm && parcel.heightMm ? ` (${parcel.lengthMm / 10} × ${parcel.widthMm / 10} × ${parcel.heightMm / 10} cm)` : ""}`).join("; ")}
                  </p>
                )}
              </div>
            ))}

            {attempts.map((attempt) => (
              <div key={attempt.id} role="alert" className="mb-5 border-l-2 border-terracotta-700 bg-terracotta-500/10 px-4 py-3 text-terracotta-700">
                <p className="font-medium">A booking with {attempt.carrier} on {dateTime(attempt.createdAt)} may or may not have gone through.</p>
                <p className="mt-1">{attempt.error}</p>
                <p className="mt-1">Check in {attempt.carrier}’s own system whether a shipment exists for this order. If one does, cancel it there or record it by hand below. Booking is blocked for these items until this is released, so the label cannot be paid for twice.</p>
                <form action={releaseShipmentAttempt.bind(null, order.id, attempt.id)} className="mt-3">
                  <Submit variant="danger">I have checked: nothing was booked. Release.</Submit>
                </form>
              </div>
            ))}
            {canShip && (
              <div className="mb-8 border border-ink/10 p-4">
                <h3 className="font-medium">Book a carrier label</h3>
                {carriers.length === 0 ? (
                  <p className="text-small mt-2 text-stone-700">
                    No carrier is connected, so labels cannot be booked from here yet. See{" "}
                    <Link href="/admin/fulfilment" className="underline underline-offset-4">
                      Shipping &amp; fulfilment
                    </Link>{" "}
                    for what each carrier needs. Until then, record the shipment by hand below.
                  </p>
                ) : (
                  <>
                    <p className="text-small mt-1 text-stone-700">Books everything not yet shipped. Connected: {carriers.map((carrier) => `${carrier.name} (${carrier.environment})`).join(", ")}.</p>
                    <form className="mt-4 grid gap-4 sm:grid-cols-5">
                      <input type="hidden" name="rates" value="1" />
                      <Field label="Boxes" name="boxes" type="number" min={1} max={20} defaultValue={box.boxes} required />
                      <Field label="Weight per box (kg)" name="weightKg" inputMode="decimal" defaultValue={box.weightKg} required hint="Including packaging." />
                      <Field label="Length (cm)" name="lengthCm" inputMode="decimal" defaultValue={box.lengthCm} />
                      <Field label="Width (cm)" name="widthCm" inputMode="decimal" defaultValue={box.widthCm} />
                      <Field label="Height (cm)" name="heightCm" inputMode="decimal" defaultValue={box.heightCm} />
                      <div className="sm:col-span-5">
                        <Submit variant="secondary">Compare services and prices</Submit>
                      </div>
                    </form>
                    {ratesError && <p role="alert" className="mt-4 border-l-2 border-terracotta-700 bg-terracotta-500/10 px-4 py-3 text-terracotta-700">{ratesError}</p>}
                    {rates && (
                      <div className="mt-5 space-y-5">
                        {rates.problems.map((problem) => (
                          <p key={problem.carrier} role="alert" className="border-l-2 border-terracotta-700 bg-terracotta-500/10 px-4 py-3 text-terracotta-700">
                            {problem.message}
                          </p>
                        ))}
                        {rates.quotes.length > 0 && (
                          <Table head={["Carrier", "Service", "Price", "Estimated delivery", ""]}>
                            {rates.quotes.map((quote) => (
                              <tr key={`${quote.carrier}-${quote.service}`}>
                                <td>{quote.carrierName}</td>
                                <td>
                                  {quote.serviceName}
                                  {quote.suggested && <span className="text-small block text-olive-700">Suggested: {rates.rule}</span>}
                                </td>
                                <td className="tabular-nums">
                                  {quote.currency === "EUR" ? money(quote.priceCents) : `${(quote.priceCents / 100).toFixed(2)} ${quote.currency}`}
                                </td>
                                <td className="whitespace-nowrap">{quote.estimatedDelivery ? dateTime(quote.estimatedDelivery) : "Not given"}</td>
                                <td>
                                  <form action={bookCarrierLabel.bind(null, order.id)}>
                                    {boxFields}
                                    <input type="hidden" name="choice" value={`${quote.carrier}|${quote.service}`} />
                                    <Submit className="!h-9 !px-3">Book label</Submit>
                                  </form>
                                </td>
                              </tr>
                            ))}
                          </Table>
                        )}
                        {rates.quotes.length === 0 && rates.problems.length === 0 && rates.withoutRates.length === 0 && <p className="text-stone-700">No carrier offered a service for this parcel and destination.</p>}
                        {rates.withoutRates.map((carrier) => (
                          <form key={carrier.carrier} action={bookCarrierLabel.bind(null, order.id)} className="flex flex-wrap items-end gap-3 border-t border-ink/10 pt-4">
                            {boxFields}
                            <label className="block">
                              <span className="text-small font-medium">{carrier.carrierName} service</span>
                              <select name="choice" required className="mt-1.5 block h-10 border border-ink/25 bg-white px-3 text-[0.9375rem]">
                                {carrier.services.map((service) => (
                                  <option key={service.code} value={`${carrier.carrier}|${service.code}`}>
                                    {service.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <Submit>Book {carrier.carrierName} label</Submit>
                            <p className="text-small w-full text-stone-700">{carrier.carrierName} has no price API: the charge follows your contract and is not shown here.</p>
                          </form>
                        ))}
                        <p className="text-small text-stone-700">Booking is a real order with the carrier in its {carriers.some((carrier) => carrier.environment === "production") ? "live or test" : "test"} environment, as listed above. Prices are the carrier’s own quote and can differ from the final invoice.</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {canShip && (
              <form action={ship.bind(null, order.id)} className="space-y-5">
                <h3 className="font-medium">{order.shipments.length ? "Record another shipment by hand" : "Record a shipment by hand"}</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  {remaining.map(({ item, left }) => (
                    <div key={item.id} className="grid grid-cols-[1fr_8rem] gap-3">
                      <Field label={`${item.productName} ${item.variantLabel} — units in this shipment (${left} can go)`} name={`qty:${item.id}`} type="number" min={0} max={left} defaultValue={left} required />
                      <Field label="Lot" name={`lot:${item.id}`} defaultValue={item.lotNumber ?? ""} placeholder="AZ-0001" />
                    </div>
                  ))}
                </div>
                <div className="grid gap-4 sm:grid-cols-4">
                  <Field label="Carrier" name="carrier" required placeholder="bpost" defaultValue={order.shippingCarrier ?? ""} />
                  <Field label="Service" name="service" placeholder="e.g. bpack 24h" />
                  <Field label="Tracking number" name="trackingNumber" />
                  <Field label="Tracking link" name="trackingUrl" type="url" placeholder="https://…" />
                </div>
                <div className="grid gap-4 sm:grid-cols-5">
                  <Field label="Boxes" name="boxes" type="number" min={1} max={20} defaultValue={1} required />
                  <Field label="Weight per box (kg)" name="weightKg" inputMode="decimal" defaultValue={remainingGrams ? (remainingGrams / 1000).toFixed(2) : ""} hint="Goods only; add packaging." />
                  <Field label="Length (cm)" name="lengthCm" inputMode="decimal" />
                  <Field label="Width (cm)" name="widthCm" inputMode="decimal" />
                  <Field label="Height (cm)" name="heightCm" inputMode="decimal" />
                </div>
                <div>
                  <Submit>Record shipment</Submit>
                  <p className="text-small mt-2 text-stone-700">Carrier, tracking and box details are typed in by hand. No label is booked and no carrier is contacted until a carrier account is connected.</p>
                </div>
              </form>
            )}
            {order.fulfilmentStatus === "SHIPPED" && (
              <form action={deliver.bind(null, order.id)} className="mt-4">
                <Submit variant="secondary">Mark as delivered</Submit>
              </form>
            )}
            {(order.cancelledAt || order.fulfilmentStatus === "DELIVERED" || (order.paymentStatus === "REFUNDED" && order.shipments.length === 0)) && <p className="text-stone-700">Nothing to do.</p>}
          </Card>

          {mayRemove && removable.length > 0 && (
            <Card title="Take units off the order" description="For units that will not be supplied. Units still waiting for stock are cancelled first; any others go back on sale. This does not return money: issue the refund below afterwards.">
              <form action={cancelUnits.bind(null, order.id)} className="grid gap-4 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
                <label className="block">
                  <span className="text-small font-medium">Line</span>
                  <select name="orderItemId" required className="mt-1.5 h-10 w-full border border-ink/25 bg-white px-3">
                    {removable.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.productName} {item.variantLabel} — {outstanding(item)} not shipped
                      </option>
                    ))}
                  </select>
                </label>
                <Field label="Units" name="quantity" type="number" min={1} defaultValue={1} required />
                <Submit variant="danger">Take off the order</Submit>
              </form>
            </Card>
          )}

          {refundable > 0 && (
            <Card title="Refund" description="Administrators only. The refund is sent through the payment provider first and recorded only if that succeeds.">
              <form action={refund.bind(null, order.id)} className="grid gap-4 sm:grid-cols-3">
                <Field label={`Amount (max ${euros(refundable)} €)`} name="amountCents" inputMode="decimal" required defaultValue={euros(refundable)} />
                <Field label="Reason" name="reason" className="sm:col-span-2" />
                <Check label="Put the bottles back into stock" name="restock" className="sm:col-span-2" />
                <div className="sm:col-span-3">
                  <Submit variant="danger">Send refund</Submit>
                </div>
              </form>
            </Card>
          )}

          {order.returns.length > 0 && (
            <Card title="Return requests">
              {order.returns.map((request) => (
                <div key={request.id} className="flex flex-wrap items-center justify-between gap-4 border-b border-ink/10 py-3 last:border-0">
                  <div>
                    <Badge tone="PAID">{request.status}</Badge>
                    <p className="mt-2">{request.reason}</p>
                    <p className="text-small text-stone-700">{dateTime(request.createdAt)}</p>
                  </div>
                  <div className="flex gap-2">
                    {(["APPROVED", "REJECTED", "RECEIVED"] as const).map((status) => (
                      <form key={status} action={returnStatus.bind(null, order.id, request.id, status)}>
                        <Submit variant="secondary" disabled={request.status === status}>{status.toLowerCase()}</Submit>
                      </form>
                    ))}
                  </div>
                </div>
              ))}
            </Card>
          )}

          <Card title="Messages" description="Every email and alert queued for this order, and what became of it.">
            {order.messages.length === 0 ? (
              <p className="text-stone-700">Nothing has been sent yet. Messages are queued once the order is paid.</p>
            ) : (
              <Table head={["Message", "State", "When", "Detail"]}>
                {order.messages.map((message) => (
                  <tr key={message.id}>
                    <td>{MESSAGE_LABEL[message.kind] ?? message.kind}</td>
                    <td>
                      <Badge tone={message.status === "DONE" ? "PAID" : message.status === "FAILED" ? "FAILED" : undefined}>{message.status === "DONE" ? "SENT" : message.status}</Badge>
                    </td>
                    <td className="whitespace-nowrap">{dateTime(message.doneAt ?? message.createdAt)}</td>
                    <td className="text-small text-stone-700">{message.lastError ?? ""}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-8">
          <Card title="Customer">
            <p>
              {order.shipFirstName} {order.shipLastName}
            </p>
            <p className="break-words text-stone-700">{order.email}</p>
            {order.shipPhone && <p className="text-stone-700">{order.shipPhone}</p>}
            {order.customer ? (
              <Link href={`/admin/customers/${order.customer.id}`} className={`${cellLink} mt-2 inline-block`}>
                View account
              </Link>
            ) : (
              <p className="text-small mt-2 text-stone-700">Guest checkout</p>
            )}
            <div className="mt-4 border-t border-ink/10 pt-4">
              <p className="text-small mb-1 font-medium">Shipping address</p>
              <Address lines={[`${order.shipFirstName} ${order.shipLastName}`, order.shipLine1, order.shipLine2, `${order.shipPostalCode} ${order.shipCity}`, order.shipRegion, order.shipCountryCode]} />
            </div>
            <div className="mt-4 border-t border-ink/10 pt-4">
              <p className="text-small mb-1 font-medium">Billing address</p>
              {sameBilling ? (
                <p className="text-stone-700">Same as shipping address.</p>
              ) : (
                <Address
                  lines={[order.billCompany, `${order.billFirstName} ${order.billLastName}`, order.billLine1, order.billLine2, `${order.billPostalCode} ${order.billCity}`, order.billRegion, order.billCountryCode, order.billVatNumber ? `VAT ${order.billVatNumber}` : null]}
                />
              )}
            </div>
            {order.customerNote && <p className="mt-4 border-t border-ink/10 pt-4">“{order.customerNote}”</p>}
          </Card>

          <Card title="Payments">
            {order.payments.length === 0 && <p className="text-stone-700">No payment has been started.</p>}
            {order.payments.map((payment) => (
              <div key={payment.id} className="border-b border-ink/10 py-2 last:border-0">
                <div className="flex justify-between gap-4">
                  <span>
                    {payment.provider.toLowerCase()} {payment.method ?? ""}
                  </span>
                  <span className="tabular-nums">{money(payment.amountCents)}</span>
                </div>
                <Badge>{payment.status}</Badge>
                {payment.refunds.map((r) => (
                  <p key={r.id} className="text-small mt-1 text-stone-700">
                    {r.failedAt ? "Refund failed, customer not refunded: " : "Refunded "}
                    {money(r.amountCents)} on {dateTime(r.createdAt)}
                    {r.adminUserId ? "" : " (at the payment provider)"}
                    {r.reason ? ` — ${r.reason}` : ""}
                  </p>
                ))}
                {payment.disputes.map((d) => (
                  <p key={d.id} className="text-small mt-1 text-stone-700">
                    Dispute over {money(d.amountCents)}: {DISPUTE_LABEL[d.status] ?? d.status.replaceAll("_", " ")}
                    {!d.closedAt && d.evidenceDueAt ? `, answer by ${dateTime(d.evidenceDueAt)}` : ""}
                  </p>
                ))}
              </div>
            ))}
          </Card>

          <Card title="Internal notes" description="Never shown to the customer.">
            <form action={addNote.bind(null, order.id)}>
              <TextArea label="Add a note" name="body" required rows={3} />
              <Submit variant="secondary" className="mt-3">Add note</Submit>
            </form>
            <ul className="mt-5 space-y-4">
              {order.notes.map((note) => (
                <li key={note.id} className="border-t border-ink/10 pt-3">
                  <p className="whitespace-pre-wrap">{note.body}</p>
                  <p className="text-small mt-1 text-stone-700">
                    {note.author.name} · {dateTime(note.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Timeline" description="Who did what, and when.">
            <ol className="space-y-3">
              {order.events.map((event) => (
                <li key={event.id}>
                  {event.message}
                  <span className="text-small block text-stone-700">
                    {dateTime(event.createdAt)} · {event.actor?.name ?? (["paid", "payment_failed", "payment_processing"].includes(event.kind) ? "Payment provider" : event.kind === "placed" ? "Customer" : "System")}
                    {event.isInternal ? " · staff only" : ""}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </Page>
  );
}
