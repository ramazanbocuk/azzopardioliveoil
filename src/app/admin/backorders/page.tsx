import Link from "next/link";
import { Card, Flash, Page, Stat, Table, cellLink, date } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { listBackorders } from "@/server/stock";

export const metadata = { title: "Backorders" };

export default async function BackordersPage({ searchParams }: PageProps<"/admin/backorders">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [data, params] = await Promise.all([listBackorders(ctx), searchParams]);
  const orders = new Set(data.lines.map((line) => line.orderId)).size;

  return (
    <Page title="Backorders" eyebrow="Paid for, waiting for stock">
      <Flash params={params} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Units owed" value={String(data.units)} note="Bottles customers have paid for that are not in stock." />
        <Stat label="Orders waiting" value={String(orders)} />
        <Stat label="Products to replenish" value={String(data.replenish.length)} />
      </div>

      <Card title="What to order" description="The total owed per product and size. A delivery booked into stock (Inventory → Purchasing, or Products → Update stock) is set aside for these orders automatically, oldest first, before anything goes back on sale.">
        <Table head={["Product", "SKU", "Units owed", "Orders"]} empty={data.replenish.length === 0 ? "Nothing is on backorder." : undefined}>
          {data.replenish.map((row) => (
            <tr key={row.sku}>
              <td>{row.name}</td>
              <td className="font-mono text-[0.8125rem]">{row.sku}</td>
              <td className="tabular-nums">{row.open}</td>
              <td className="tabular-nums">{row.orders}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Orders waiting" description="Oldest first: this is the order in which arriving stock is given out. A backorder appears only for products where “Allow orders when out of stock” is switched on, or when a payment arrived after its stock hold had lapsed.">
        <Table head={["Waiting since", "Order", "Customer", "Product", "Units owed", "On shelf now"]} empty={data.lines.length === 0 ? "No order is waiting for stock." : undefined}>
          {data.lines.map((line) => (
            <tr key={line.id}>
              <td className="whitespace-nowrap">{date(line.since)}</td>
              <td>
                <Link href={`/admin/orders/${line.orderId}`} className={cellLink}>
                  {line.number}
                </Link>
              </td>
              <td>
                {line.customer} <span className="text-stone-700">({line.country})</span>
              </td>
              <td>{line.name}</td>
              <td className="tabular-nums">{line.open}</td>
              <td className="tabular-nums">{line.available}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
