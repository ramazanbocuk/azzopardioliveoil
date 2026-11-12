import Link from "next/link";
import { Badge, Card, Flash, LinkButton, Page, Stat, Submit, Table, cellLink, dateTime, money } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { inventoryOverview } from "@/server/backoffice";
import { adjustStock } from "../actions";

export const metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: PageProps<"/admin/inventory">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [stock, params] = await Promise.all([inventoryOverview(ctx), searchParams]);

  return (
    <Page title="Inventory" eyebrow={`${stock.rows.length} variants`} actions={<LinkButton href="/admin/export/inventory">Export (CSV)</LinkButton>}>
      <Flash params={params} />
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Units on hand" value={String(stock.unitsOnHand)} />
        <Stat label="Held for unpaid orders" value={String(stock.unitsReserved)} />
        <Stat label="Low or out of stock" value={String(stock.lowCount)} />
        <Stat label="Value at retail price" value={money(stock.retailValueCents)} note="Selling price × units, VAT included. Not a cost valuation." />
      </div>

      <Card title="Stock levels" description="Available = on hand − held. Every change is written to the ledger below with who made it and why.">
        <Table head={["Product", "SKU", "On hand", "Held", "Available", "Alert at", "State", "Adjust"]} empty={stock.rows.length === 0 ? "No products yet." : undefined}>
          {stock.rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link href={`/admin/products/${row.product.id}`} className={cellLink}>
                  {row.product.name}
                </Link>
                <span className="text-small block text-stone-700">{row.label}</span>
              </td>
              <td className="font-mono text-[0.8125rem]">{row.sku}</td>
              <td className="tabular-nums">{row.stock}</td>
              <td className="tabular-nums">{row.reserved}</td>
              <td className="tabular-nums font-medium">{row.available}</td>
              <td className="tabular-nums">{row.lowStockThreshold}</td>
              <td>{!row.isActive ? <Badge>NOT ON SALE</Badge> : row.available <= 0 ? <Badge tone="FAILED">OUT OF STOCK</Badge> : row.low ? <Badge tone="UNPAID">LOW</Badge> : <Badge tone="PAID">IN STOCK</Badge>}</td>
              <td>
                <form action={adjustStock.bind(null, row.product.id, row.id)} className="flex flex-wrap items-end gap-2">
                  <input name="delta" type="number" required placeholder="+12 / −3" aria-label={`Change in units for ${row.sku}`} className="h-9 w-24 border border-ink/25 px-2 tabular-nums" />
                  <select name="reason" aria-label="Reason" className="h-9 border border-ink/25 bg-white px-2 text-[0.875rem]" defaultValue="RECEIVED">
                    <option value="RECEIVED">Received</option>
                    <option value="ADJUSTMENT">Count correction</option>
                    <option value="RETURN">Customer return</option>
                    <option value="DAMAGED">Damaged</option>
                  </select>
                  <input name="note" placeholder="Note" aria-label="Note" className="h-9 w-32 border border-ink/25 px-2" />
                  <Submit variant="secondary" className="!h-9 !px-3">Apply</Submit>
                </form>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Stock ledger" description="The last 60 movements.">
        <Table head={["When", "Product", "Change", "Reason", "By", "Note"]} empty={stock.movements.length === 0 ? "No movements yet." : undefined}>
          {stock.movements.map((movement) => (
            <tr key={movement.id}>
              <td className="whitespace-nowrap">{dateTime(movement.createdAt)}</td>
              <td>
                {movement.variant.product.name} {movement.variant.label}
                <span className="block font-mono text-[0.75rem] text-stone-700">{movement.variant.sku}</span>
              </td>
              <td className={`tabular-nums font-medium ${movement.delta < 0 ? "text-terracotta-700" : "text-olive-700"}`}>{movement.delta > 0 ? `+${movement.delta}` : movement.delta}</td>
              <td>{movement.reason.toLowerCase()}</td>
              <td>{movement.by}</td>
              <td className="text-stone-700">
                {movement.note ?? ""}
                {movement.orderId && (
                  <Link href={`/admin/orders/${movement.orderId}`} className={cellLink}>
                    order
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
