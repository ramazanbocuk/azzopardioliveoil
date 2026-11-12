import Link from "next/link";
import { Badge, Card, Check, Field, Flash, LinkButton, Page, Submit, Table, TextArea, cellLink, dateTime, euros, money } from "@/components/admin/ui";
import { getOrder } from "@/server/admin";
import { adminCtx } from "@/server/adminSession";
import { addNote, cancelOrder, deliver, refund, returnStatus, setLot, ship, startPacking } from "../../actions";

export const metadata = { title: "Order" };

export default async function OrderPage({ params, searchParams }: PageProps<"/admin/orders/[id]">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [{ id }, flash] = await Promise.all([params, searchParams]);
  const order = await getOrder(ctx, id);
  const refunded = order.payments.flatMap((p) => p.refunds).reduce((sum, r) => sum + r.amountCents, 0);
  const refundable = order.payments.filter((p) => p.status === "PAID" || p.status === "PARTIALLY_REFUNDED").reduce((sum, p) => sum + p.amountCents, 0) - refunded;
  const canShip = order.status === "PAID" || order.status === "FULFILLING";

  return (
    <Page
      title={order.number ?? "Order"}
      eyebrow={`Placed ${dateTime(order.placedAt)}`}
      actions={
        <>
          <LinkButton href={`/admin/orders/${order.id}/invoice`} target="_blank">Invoice</LinkButton>
          <LinkButton href={`/admin/orders/${order.id}/packing-slip`} target="_blank">Packing slip</LinkButton>
        </>
      }
    >
      <Flash params={flash} />
      <div className="flex flex-wrap gap-2">
        <Badge>{order.status}</Badge>
        <Badge>{order.paymentStatus}</Badge>
      </div>

      <div className="grid gap-8 xl:grid-cols-3">
        <div className="space-y-8 xl:col-span-2">
          <Card title="Items" description="Record the lot each line is packed from. It then appears on the customer’s order and invoice.">
            <Table head={["Product", "Qty", "Unit", "Line", "Lot"]}>
              {order.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.productName} {item.variantLabel}
                    <span className="block font-mono text-[0.75rem] text-stone-700">{item.sku}</span>
                  </td>
                  <td className="tabular-nums">{item.quantity}</td>
                  <td className="tabular-nums">{money(item.unitPriceCents)}</td>
                  <td className="tabular-nums">{money(item.lineTotalCents)}</td>
                  <td>
                    <form action={setLot.bind(null, order.id, item.id)} className="flex items-center gap-2">
                      <input name="lotNumber" defaultValue={item.lotNumber ?? ""} aria-label={`Lot for ${item.productName} ${item.variantLabel}`} placeholder="AZ-0001" className="h-9 w-28 border border-ink/25 px-2 font-mono text-[0.8125rem]" />
                      <Submit variant="secondary" className="!h-9 !px-3">Set</Submit>
                    </form>
                  </td>
                </tr>
              ))}
            </Table>
            <dl className="ml-auto mt-5 max-w-xs space-y-1.5">
              {[
                ["Subtotal", money(order.subtotalCents)],
                ...(order.discountCents ? [[`Discount ${order.discountCode ?? ""}`, `−${money(order.discountCents)}`]] : []),
                [`Shipping · ${order.shippingRateName}`, money(order.shippingCents)],
                ["Includes VAT", order.taxCents === null ? "no rate set" : money(order.taxCents)],
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
            </dl>
          </Card>

          <Card title="Fulfilment">
            {order.status === "PENDING_PAYMENT" && (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-stone-700">Waiting for payment. Stock is held until {dateTime(order.reservedUntil)}.</p>
                <form action={cancelOrder.bind(null, order.id)}>
                  <Submit variant="danger">Cancel order</Submit>
                </form>
              </div>
            )}
            {order.status === "PAID" && (
              <form action={startPacking.bind(null, order.id)} className="mb-6">
                <Submit variant="secondary">Start packing</Submit>
              </form>
            )}
            {canShip && (
              <form action={ship.bind(null, order.id)} className="grid gap-4 sm:grid-cols-3">
                <Field label="Carrier" name="carrier" required placeholder="bpost" defaultValue={order.shippingCarrier ?? ""} />
                <Field label="Tracking number" name="trackingNumber" />
                <Field label="Tracking link" name="trackingUrl" type="url" placeholder="https://…" />
                <div className="sm:col-span-3">
                  <Submit>Mark as shipped</Submit>
                  <p className="text-small mt-2 text-stone-700">Tracking is entered by hand for now. Carrier labels and automatic tracking arrive with the shipping integration.</p>
                </div>
              </form>
            )}
            {order.shipments.map((shipment) => (
              <p key={shipment.id} className="mt-2">
                {shipment.carrier} · {shipment.trackingNumber ?? "no tracking number"} · shipped {dateTime(shipment.shippedAt)}
                {shipment.deliveredAt ? ` · delivered ${dateTime(shipment.deliveredAt)}` : ""}
              </p>
            ))}
            {order.status === "SHIPPED" && (
              <form action={deliver.bind(null, order.id)} className="mt-4">
                <Submit variant="secondary">Mark as delivered</Submit>
              </form>
            )}
            {["DELIVERED", "CANCELLED", "REFUNDED"].includes(order.status) && order.shipments.length === 0 && <p className="text-stone-700">Nothing to do.</p>}
          </Card>

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
            <address className="mt-4 border-t border-ink/10 pt-4 not-italic">
              {order.shipLine1}
              {order.shipLine2 && <span className="block">{order.shipLine2}</span>}
              <span className="block">
                {order.shipPostalCode} {order.shipCity}
              </span>
              <span className="block">{order.shipCountryCode}</span>
            </address>
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
                    Refunded {money(r.amountCents)} on {dateTime(r.createdAt)}
                    {r.reason ? ` — ${r.reason}` : ""}
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

          <Card title="Timeline">
            <ol className="space-y-3">
              {order.events.map((event) => (
                <li key={event.id}>
                  {event.message}
                  <span className="text-small block text-stone-700">{dateTime(event.createdAt)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </Page>
  );
}
