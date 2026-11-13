import Link from "next/link";
import { SelectAll } from "@/components/admin/SelectAll";
import { Badge, Card, Flash, LinkButton, Page, Stat, Submit, Table, cellLink, dateTime, money } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { fulfilmentBoard } from "@/server/fulfilment";
import { shipmentWatchlist } from "@/server/tracking";
import { can } from "@/server/permissions";
import { testCarrier } from "../actions";
import { FULFILMENT_LABEL } from "@/server/orderStatus";
import { connectedCarriers } from "@/server/shipping/registry";
import { bulkBookLabels } from "../actions";

export const metadata = { title: "Shipping & fulfilment" };

const kilos = (grams: number) => `${(grams / 1000).toLocaleString("en-GB", { maximumFractionDigits: 2 })} kg`;

export default async function FulfilmentPage({ searchParams }: PageProps<"/admin/fulfilment">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [board, watch, params] = await Promise.all([fulfilmentBoard(ctx), shipmentWatchlist(ctx), searchParams]);
  const mayTest = can(ctx.admin.role, "ADMINISTRATOR", "integrations");
  const connected = board.carriers.filter((carrier) => carrier.connected);
  const services = connectedCarriers().flatMap((carrier) => carrier.services.map((service) => ({ value: `${carrier.key}|${service.code}`, label: `${carrier.name} — ${service.name}` })));

  return (
    <Page title="Shipping & fulfilment" eyebrow={`${board.waiting.length} order${board.waiting.length === 1 ? "" : "s"} waiting to ship`} actions={<LinkButton href="/admin/orders?fulfilment=READY">Ready to ship</LinkButton>}>
      <Flash params={params} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Waiting to ship" value={String(board.waiting.length)} />
        <Stat label="Units to pack" value={String(board.waiting.reduce((sum, row) => sum + row.units, 0))} />
        <Stat label="Carriers connected" value={`${connected.length} of ${board.carriers.length}`} />
      </div>

      <Card
        title="Parcels that need attention"
        description={`${watch.inTransit} on their way, ${watch.awaitingCollection} waiting for the carrier. Listed here: a problem the carrier reports, a delivery estimate that has passed, a label not collected after ${2} days, no tracking update for more than 4 days, and shipments sent without a tracking number. Customers are not told about a problem automatically.`}
      >
        <Table head={["Order", "Customer", "Carrier", "Sent", "Last update", "Why"]} empty={watch.attention.length === 0 ? "No parcel needs attention." : undefined}>
          {watch.attention.map((row) => (
            <tr key={row.id}>
              <td>
                <Link href={`/admin/orders/${row.orderId}`} className={cellLink}>
                  {row.number}
                </Link>
              </td>
              <td>
                {row.customer} <span className="text-stone-700">({row.country})</span>
              </td>
              <td>
                {row.carrier}
                <span className="block font-mono text-[0.75rem] text-stone-700">{row.trackingNumber ?? "no number"}</span>
              </td>
              <td className="whitespace-nowrap">{dateTime(row.sentAt)}</td>
              <td>{row.lastEvent ? `${dateTime(row.lastEvent.at)} · ${row.lastEvent.description}` : "—"}</td>
              <td className={row.problem ? "text-terracotta-700" : undefined}>{row.reasons.join("; ")}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Carriers" description="A carrier is connected when its credentials are in the server environment. Until then labels cannot be booked with it, and shipments are recorded by hand.">
        <Table head={["Carrier", "State", "Environment", "Live rates", "Cancel by API", "Missing", ""]}>
          {board.carriers.map((carrier) => (
            <tr key={carrier.key}>
              <td>{carrier.name}</td>
              <td>
                <Badge tone={carrier.connected ? "PAID" : "UNPAID"}>{carrier.connected ? "CONNECTED" : "NOT CONNECTED"}</Badge>
              </td>
              <td>{carrier.environment ?? "—"}</td>
              <td>{carrier.connected ? (carrier.hasRates ? "Yes" : "No — contract prices") : "—"}</td>
              <td>{carrier.connected ? (carrier.canCancel ? "Yes" : "No") : "—"}</td>
              <td className="font-mono text-[0.75rem] text-stone-700">{carrier.missing.join(", ")}</td>
              <td>
                {mayTest && carrier.connected && carrier.canTest && (
                  <form action={testCarrier.bind(null, carrier.key)}>
                    <Submit variant="secondary">Test sign-in</Submit>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </Table>
        {!board.senderComplete && (
          <p className="mt-4 border-l-2 border-terracotta-700 bg-terracotta-500/10 px-4 py-3 text-terracotta-700">
            The sender address is incomplete, so no label can be booked. Fill it in under{" "}
            <Link href="/admin/settings" className="underline underline-offset-4">
              Settings → Shipping origin
            </Link>
            .
          </p>
        )}
      </Card>

      <Card title="Waiting to ship" description="Paid orders with units that have not left yet, oldest payment first. Open an order to compare rates, book a label or record a shipment.">
        <form action={bulkBookLabels}>
        {services.length > 0 ? (
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-small font-medium">Book labels for the selected orders with</span>
              <select name="choice" required defaultValue="" className="mt-1.5 block h-10 border border-ink/25 bg-white px-3 text-[0.9375rem]">
                <option value="" disabled>
                  Choose a carrier and service
                </option>
                {services.map((service) => (
                  <option key={service.value} value={service.value}>
                    {service.label}
                  </option>
                ))}
              </select>
            </label>
            <Submit>Book labels</Submit>
            <p className="text-small max-w-[60ch] text-stone-700">Up to 50 at a time. Each order ships as one box holding everything not yet sent, weighed as goods plus the packaging weight in Settings. Each label is a real booking with the carrier. Orders that fail are listed and do not stop the others.</p>
          </div>
        ) : (
          <p className="text-small mb-4 text-stone-700">Bulk label booking appears here once a carrier is connected.</p>
        )}
        <Table head={[<SelectAll key="all" name="ids" label="Select all waiting orders" />, "Order", "Paid", "Ship to", "Destination", "Units left", "Goods weight", "Requested", "Fulfilment", "Total"]} empty={board.waiting.length === 0 ? "Nothing is waiting to ship." : undefined}>
          {board.waiting.map(({ order, units, weightGrams, needsCustoms }) => (
            <tr key={order.id}>
              <td>
                <input type="checkbox" name="ids" value={order.id} aria-label={`Select order ${order.number}`} className="size-4 accent-olive-700" />
              </td>
              <td>
                <Link href={`/admin/orders/${order.id}`} className={cellLink}>
                  {order.number}
                </Link>
              </td>
              <td className="whitespace-nowrap">{dateTime(order.paidAt)}</td>
              <td>
                {order.shipFirstName} {order.shipLastName}
                <span className="text-small block text-stone-700">
                  {order.shipPostalCode} {order.shipCity}
                </span>
              </td>
              <td>
                {order.shipCountryCode}
                {needsCustoms && <span className="text-small block text-terracotta-700">Customs declaration</span>}
              </td>
              <td className="tabular-nums">{units}</td>
              <td className="tabular-nums">{weightGrams ? kilos(weightGrams) : "—"}</td>
              <td>
                {order.shippingRateName}
                {order.shippingCarrier && <span className="text-small block text-stone-700">{order.shippingCarrier}</span>}
              </td>
              <td>
                <Badge tone={order.fulfilmentStatus}>{FULFILMENT_LABEL[order.fulfilmentStatus]}</Badge>
              </td>
              <td className="tabular-nums">{money(order.totalCents)}</td>
            </tr>
          ))}
        </Table>
        </form>
      </Card>

      <Card title="Recent shipments">
        <Table head={["Order", "Carrier", "Service", "Tracking", "Boxes", "Label", "State", "Cost", "Estimated delivery", "Created"]} empty={board.shipments.length === 0 ? "No shipments yet." : undefined}>
          {board.shipments.map((shipment) => (
            <tr key={shipment.id}>
              <td>
                <Link href={`/admin/orders/${shipment.order.id}`} className={cellLink}>
                  {shipment.order.number}
                </Link>
                <span className="text-small block text-stone-700">{shipment.order.shipCountryCode}</span>
              </td>
              <td>{shipment.carrier}</td>
              <td>{shipment.service ?? "—"}</td>
              <td className="font-mono text-[0.8125rem]">{shipment.trackingNumber ?? "—"}</td>
              <td className="tabular-nums">{shipment.parcels.length || "—"}</td>
              <td>
                {shipment._count.labels > 0 ? (
                  <a href={`/admin/shipments/${shipment.id}/label/0`} target="_blank" rel="noreferrer" className={cellLink}>
                    Print
                  </a>
                ) : shipment.source === "manual" ? (
                  "Entered by hand"
                ) : (
                  "—"
                )}
              </td>
              <td>
                <Badge>{shipment.status}</Badge>
              </td>
              <td className="tabular-nums">{shipment.costCents === null ? "—" : money(shipment.costCents)}</td>
              <td className="whitespace-nowrap">{shipment.estimatedDeliveryAt ? dateTime(shipment.estimatedDeliveryAt) : "—"}</td>
              <td className="whitespace-nowrap">{dateTime(shipment.createdAt)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
