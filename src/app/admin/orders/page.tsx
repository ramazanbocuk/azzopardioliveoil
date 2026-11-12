import Link from "next/link";
import { Badge, Card, Field, Flash, LinkButton, Page, Select, Submit, Table, cellLink, dateTime, money } from "@/components/admin/ui";
import { listOrders } from "@/server/admin";
import { adminCtx } from "@/server/adminSession";

export const metadata = { title: "Orders" };

const STATUSES = ["ALL", "PENDING_PAYMENT", "PAID", "FULFILLING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"];

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const status = typeof params.status === "string" ? params.status : "ALL";
  const result = await listOrders(ctx, { q, status, page: Number(params.page) || 1 });
  const pageLink = (page: number) => `/admin/orders?${new URLSearchParams({ q, status, page: String(page) })}`;

  return (
    <Page title="Orders" eyebrow={`${result.count} order${result.count === 1 ? "" : "s"}`} actions={<LinkButton href="/admin/export/orders">Export (CSV)</LinkButton>}>
      <Flash params={params} />
      <Card>
        <form className="flex flex-wrap items-end gap-4">
          <Field label="Search" name="q" defaultValue={q} placeholder="Order number, email or surname" className="min-w-64 flex-1" />
          <Select label="Status" name="status" defaultValue={status} className="w-52">
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value === "ALL" ? "All statuses" : value.replaceAll("_", " ").toLowerCase()}
              </option>
            ))}
          </Select>
          <Submit variant="secondary">Filter</Submit>
        </form>
      </Card>

      <Card>
        <Table head={["Order", "Placed", "Customer", "Items", "Status", "Payment", "Total"]} empty={result.rows.length === 0 ? "No orders match." : undefined}>
          {result.rows.map((order) => (
            <tr key={order.id}>
              <td>
                <Link href={`/admin/orders/${order.id}`} className={cellLink}>
                  {order.number}
                </Link>
              </td>
              <td className="whitespace-nowrap">{dateTime(order.placedAt)}</td>
              <td>
                {order.shipFirstName} {order.shipLastName}
                <span className="text-small block text-stone-700">{order.email}</span>
              </td>
              <td className="tabular-nums">{order.items.reduce((sum, item) => sum + item.quantity, 0)}</td>
              <td>
                <Badge>{order.status}</Badge>
              </td>
              <td>
                <Badge>{order.paymentStatus}</Badge>
              </td>
              <td className="tabular-nums">{money(order.totalCents)}</td>
            </tr>
          ))}
        </Table>
        {result.pages > 1 && (
          <nav aria-label="Pages" className="mt-5 flex items-center justify-between">
            {result.page > 1 ? <LinkButton href={pageLink(result.page - 1)}>Previous</LinkButton> : <span />}
            <span className="text-small text-stone-700">
              Page {result.page} of {result.pages}
            </span>
            {result.page < result.pages ? <LinkButton href={pageLink(result.page + 1)}>Next</LinkButton> : <span />}
          </nav>
        )}
      </Card>
    </Page>
  );
}
