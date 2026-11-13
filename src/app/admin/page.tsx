import Link from "next/link";
import { Badge, Card, Flash, LinkButton, Page, Stat, Table, cellLink, dateTime, money } from "@/components/admin/ui";
import { dashboard } from "@/server/admin";
import { adminCtx } from "@/server/adminSession";

export const metadata = { title: "Dashboard" };

/** Revenue per day for the last 30 days, drawn as plain SVG bars. */
function RevenueChart({ days }: { days: { day: string; revenueCents: number; orders: number }[] }) {
  if (days.length === 0) return <p className="py-10 text-center text-stone-700">No paid orders in the last 30 days.</p>;
  const max = Math.max(...days.map((d) => d.revenueCents), 1);
  const width = 100 / days.length;
  return (
    <figure>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-44 w-full" role="img" aria-label={`Revenue per day, ${days.length} days with sales`}>
        {days.map((d, index) => {
          const height = (d.revenueCents / max) * 38;
          return (
            <rect key={d.day} x={index * width + width * 0.15} y={40 - height} width={width * 0.7} height={height} fill="#2f3a22">
              <title>{`${d.day}: ${money(d.revenueCents)} from ${d.orders} order${d.orders === 1 ? "" : "s"}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="text-small mt-2 flex justify-between text-stone-700">
        <span>{days[0].day}</span>
        <span>{days[days.length - 1].day}</span>
      </figcaption>
    </figure>
  );
}

export default async function DashboardPage({ searchParams }: PageProps<"/admin">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [stats, params] = await Promise.all([dashboard(ctx), searchParams]);
  // Revenue figures are in euro. Sales in other currencies are listed apart, never added in.
  const elsewhere = stats.otherCurrencies.map((row) => `${money(row.revenueCents, row.currency)} from ${row.paidOrders} order${row.paidOrders === 1 ? "" : "s"}`).join("; ");

  return (
    <Page title="Dashboard" eyebrow="Overview" actions={<LinkButton href="/admin/export/orders">Export orders (CSV)</LinkButton>}>
      <Flash params={params} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Total revenue" value={money(stats.revenueCents)} note={`${stats.paidOrders} paid order${stats.paidOrders === 1 ? "" : "s"} in euro${elsewhere ? `. Not included: ${elsewhere}` : ""}`} />
        <Stat label="This month" value={money(stats.monthRevenueCents)} />
        <Stat label="Average order" value={money(stats.averageOrderCents)} />
        <Stat label="Orders today" value={String(stats.ordersToday)} note={`${stats.awaitingFulfilment} waiting to be packed`} />
        <Stat label="Partly shipped" value={String(stats.partlyShipped)} note="Orders with a parcel sent and more to follow" />
        <Stat label="Parcels on their way" value={String(stats.parcelsInTransit)} note={stats.parcelProblems ? `${stats.parcelProblems} with a delivery problem: see Shipping & fulfilment` : "None with a reported problem"} />
        <Stat label="On backorder" value={`${stats.backorderedUnits} unit${stats.backorderedUnits === 1 ? "" : "s"}`} note={`Paid for and waiting for stock, on ${stats.backorderedOrders} order${stats.backorderedOrders === 1 ? "" : "s"}`} />
      </div>

      <div className="grid gap-8 xl:grid-cols-3">
        <Card title="Revenue, last 30 days" className="xl:col-span-2">
          <RevenueChart days={stats.daily} />
        </Card>
        <Card title="Customers">
          <dl className="space-y-4">
            <div className="flex justify-between">
              <dt>Accounts</dt>
              <dd className="tabular-nums">{stats.customers}</dd>
            </div>
            <div className="flex justify-between">
              <dt>New this month</dt>
              <dd className="tabular-nums">{stats.newCustomers}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Carts with items</dt>
              <dd className="tabular-nums">{stats.openCarts}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Abandoned over a day ago</dt>
              <dd className="tabular-nums">{stats.abandonedCarts}</dd>
            </div>
          </dl>
          <p className="text-small mt-5 text-stone-700">Carts are counted from the shop’s own records. Visitor and conversion-rate figures need an analytics tool, which is not installed.</p>
        </Card>
      </div>

      <div className="grid gap-8 xl:grid-cols-2">
        <Card title="Recent orders">
          <Table head={["Order", "Placed", "Status", "Total"]} empty={stats.recent.length === 0 ? "No orders yet." : undefined}>
            {stats.recent.map((order) => (
              <tr key={order.id}>
                <td>
                  <Link href={`/admin/orders/${order.id}`} className={cellLink}>
                    {order.number}
                  </Link>
                </td>
                <td>{dateTime(order.placedAt)}</td>
                <td>
                  <Badge>{order.status}</Badge>
                </td>
                <td className="tabular-nums">{money(order.totalCents, order.currency)}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <div className="space-y-8">
          <Card title="Best sellers">
            <Table head={["Product", "Units", "Revenue"]} empty={stats.bestSellers.length === 0 ? "No sales yet." : undefined}>
              {stats.bestSellers.map((row) => (
                <tr key={row.sku}>
                  <td>{row.name}</td>
                  <td className="tabular-nums">{row.units}</td>
                  <td className="tabular-nums">{money(row.revenueCents)}</td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Inventory alerts" description="Sizes at or below their low-stock level.">
            <Table head={["Size", "SKU", "Available"]} empty={stats.lowStock.length === 0 ? "Nothing is running low." : undefined}>
              {stats.lowStock.map((row) => (
                <tr key={row.sku}>
                  <td>
                    {row.name} {row.label}
                  </td>
                  <td className="font-mono text-[0.8125rem]">{row.sku}</td>
                  <td className={row.available <= 0 ? "font-medium text-terracotta-700" : "tabular-nums"}>{row.available <= 0 ? "Sold out" : row.available}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      </div>
    </Page>
  );
}
