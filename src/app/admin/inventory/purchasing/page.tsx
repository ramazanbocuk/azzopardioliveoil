import { Badge, Card, Field, Flash, LinkButton, Page, Select, Submit, Table, TextArea, date, money } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { listPurchaseOrders } from "@/server/backoffice";
import { createPurchaseOrder, purchaseOrderStatus, receivePurchaseOrder } from "../../actions";

export const metadata = { title: "Purchasing" };

export default async function PurchasingPage({ searchParams }: PageProps<"/admin/inventory/purchasing">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [orders, suppliers, variants, params] = await Promise.all([
    listPurchaseOrders(ctx),
    ctx.db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true } }),
    ctx.db.variant.findMany({ where: { product: { deletedAt: null } }, orderBy: [{ product: { name: "asc" } }, { position: "asc" }], select: { sku: true, label: true, costCents: true, stock: true, reserved: true, product: { select: { name: true } } } }),
    searchParams,
  ]);
  const open = orders.filter((order) => order.status === "DRAFT" || order.status === "ORDERED");

  return (
    <Page title="Purchasing" eyebrow={`${open.length} open purchase order${open.length === 1 ? "" : "s"}`} actions={<LinkButton href="/admin/inventory">Stock levels</LinkButton>}>
      <Flash params={params} />
      <Card title="New purchase order" description="Stock you are ordering from a supplier. Nothing changes in stock until the delivery is received.">
        {suppliers.length === 0 ? (
          <p className="text-stone-700">Add a supplier under Suppliers first.</p>
        ) : (
          <form action={createPurchaseOrder} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Select label="Supplier" name="supplierId" required defaultValue="">
                <option value="" disabled>
                  Choose a supplier
                </option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name} ({supplier.kind})
                  </option>
                ))}
              </Select>
              <Field label="Expected delivery" name="expectedAt" type="date" />
              <TextArea label="Notes" name="notes" rows={1} />
            </div>
            <Table head={["Product", "SKU", "Available now", "Order quantity", "Unit cost (€)"]}>
              {variants.map((variant) => (
                <tr key={variant.sku}>
                  <td>
                    {variant.product.name} {variant.label}
                  </td>
                  <td className="font-mono text-[0.8125rem]">{variant.sku}</td>
                  <td className="tabular-nums">{variant.stock - variant.reserved}</td>
                  <td>
                    <input name={`qty:${variant.sku}`} type="number" min={0} placeholder="0" aria-label={`Quantity of ${variant.sku}`} className="h-9 w-24 border border-ink/25 px-2 tabular-nums" />
                  </td>
                  <td>
                    <input name={`cost:${variant.sku}`} inputMode="decimal" defaultValue={variant.costCents === null ? "" : (variant.costCents / 100).toFixed(2)} aria-label={`Unit cost of ${variant.sku}`} className="h-9 w-24 border border-ink/25 px-2 tabular-nums" />
                  </td>
                </tr>
              ))}
            </Table>
            <Submit>Create draft purchase order</Submit>
          </form>
        )}
      </Card>

      <Card title="Purchase orders">
        <Table head={["Number", "Supplier", "State", "Lines", "Units", "Cost", "Expected", "Received", ""]} empty={orders.length === 0 ? "No purchase orders yet." : undefined}>
          {orders.map((order) => (
            <tr key={order.id}>
              <td className="font-mono">{order.number}</td>
              <td>{order.supplier.name}</td>
              <td>
                <Badge tone={order.status === "RECEIVED" ? "PAID" : order.status === "CANCELLED" ? "CANCELLED" : "UNPAID"}>{order.status}</Badge>
              </td>
              <td className="max-w-80 text-small">{order.lines.map((line) => `${line.quantity} × ${line.variant.product.name} ${line.variant.label}`).join(", ")}</td>
              <td className="tabular-nums">{order.units}</td>
              <td className="tabular-nums">{money(order.costCents)}</td>
              <td className="whitespace-nowrap">{date(order.expectedAt)}</td>
              <td className="whitespace-nowrap">{date(order.receivedAt)}</td>
              <td>
                {(order.status === "DRAFT" || order.status === "ORDERED") && (
                  <div className="flex flex-wrap gap-2">
                    {order.status === "DRAFT" && (
                      <form action={purchaseOrderStatus.bind(null, order.id, "ORDERED")}>
                        <Submit variant="secondary" className="!h-9 !px-3">Mark ordered</Submit>
                      </form>
                    )}
                    <form action={receivePurchaseOrder.bind(null, order.id)}>
                      <Submit className="!h-9 !px-3">Receive into stock</Submit>
                    </form>
                    <form action={purchaseOrderStatus.bind(null, order.id, "CANCELLED")}>
                      <Submit variant="danger" className="!h-9 !px-3">Cancel</Submit>
                    </form>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
        <p className="text-small mt-4 text-stone-700">Receiving adds every line to stock in full and records its unit cost on the product. Part-deliveries, and assigning a lot number on receipt, are not built: create the lot under Food traceability.</p>
      </Card>
    </Page>
  );
}
