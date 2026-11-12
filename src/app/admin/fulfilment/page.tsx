import Link from "next/link";
import { Badge, Card, Flash, LinkButton, Page, Stat, Table, cellLink, dateTime, money } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { fulfilmentBoard } from "@/server/fulfilment";
import { FULFILMENT_LABEL } from "@/server/orderStatus";

export const metadata = { title: "Shipping & fulfilment" };

const kilos = (grams: number) => `${(grams / 1000).toLocaleString("en-GB", { maximumFractionDigits: 2 })} kg`;

export default async function FulfilmentPage({ searchParams }: PageProps<"/admin/fulfilment">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [board, params] = await Promise.all([fulfilmentBoard(ctx), searchParams]);
  const connected = board.carriers.filter((carrier) => carrier.connected);

  return (
    <Page title="Shipping & fulfilment" eyebrow={`${board.waiting.length} order${board.waiting.length === 1 ? "" : "s"} waiting to ship`} actions={<LinkButton href="/admin/orders?fulfilment=READY">Ready to ship</LinkButton>}>
      <Flash params={params} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Waiting to ship" value={String(board.waiting.length)} />
        <Stat label="Units to pack" value={String(board.waiting.reduce((sum, row) => sum + row.units, 0))} />
        <Stat label="Carriers connected" value={`${connected.length} of ${board.carriers.length}`} />
      </div>

      <Card title="Carriers" description="A carrier is connected when its credentials are in the server environment. Until then labels cannot be booked with it, and shipments are recorded by hand.">
        <Table head={["Carrier", "State", "Environment", "Live rates", "Cancel by API", "Missing"]}>
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
        <Table head={["Order", "Paid", "Ship to", "Destination", "Units left", "Goods weight", "Requested", "Fulfilment", "Total"]} empty={board.waiting.length === 0 ? "Nothing is waiting to ship." : undefined}>
          {board.waiting.map(({ order, units, weightGrams, needsCustoms }) => (
            <tr key={order.id}>
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
