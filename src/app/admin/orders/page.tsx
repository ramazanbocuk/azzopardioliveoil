import Link from "next/link";
import { SelectAll } from "@/components/admin/SelectAll";
import { Badge, Card, Field, Flash, LinkButton, Page, Select, Submit, Table, cellLink, dateTime, money } from "@/components/admin/ui";
import { BULK_ACTIONS, listOrders } from "@/server/admin";
import { adminCtx } from "@/server/adminSession";
import { FULFILMENT_LABEL, ORDER_STATUSES, ORDER_STATUS_LABEL } from "@/server/orderStatus";
import { bulkOrders } from "../actions";

export const metadata = { title: "Orders" };

const PAYMENT_LABEL = { UNPAID: "Unpaid", PROCESSING: "Processing", PAID: "Paid", PARTIALLY_REFUNDED: "Partially refunded", REFUNDED: "Refunded", FAILED: "Failed" } as const;
const FILTERS = ["q", "status", "payment", "fulfilment", "country", "from", "to"] as const;

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const params = await searchParams;
  const filter = Object.fromEntries(FILTERS.map((key) => [key, typeof params[key] === "string" ? params[key] : ""])) as Record<(typeof FILTERS)[number], string>;
  const result = await listOrders(ctx, { ...filter, page: Number(params.page) || 1 });
  const active = Object.fromEntries(Object.entries(filter).filter(([, value]) => value));
  const query = (extra: Record<string, string> = {}) => new URLSearchParams({ ...active, ...extra }).toString();
  const here = `/admin/orders?${query({ page: String(result.page) })}`;
  const filtered = Object.keys(active).length > 0;

  return (
    <Page title="Orders" eyebrow={`${result.count} order${result.count === 1 ? "" : "s"}${filtered ? " match" : ""}`} actions={<LinkButton href={`/admin/export/orders?${query()}`}>{filtered ? "Export these (CSV)" : "Export (CSV)"}</LinkButton>}>
      <Flash params={params} />
      <Card>
        <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search" name="q" defaultValue={filter.q} placeholder="Order, email, name, SKU or tracking" className="sm:col-span-2" />
          <Select label="Status" name="status" defaultValue={filter.status}>
            <option value="">All statuses</option>
            {ORDER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {ORDER_STATUS_LABEL[value]}
              </option>
            ))}
          </Select>
          <Select label="Payment" name="payment" defaultValue={filter.payment}>
            <option value="">Any payment</option>
            {Object.entries(PAYMENT_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Select label="Fulfilment" name="fulfilment" defaultValue={filter.fulfilment}>
            <option value="">Any fulfilment</option>
            {Object.entries(FULFILMENT_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Select label="Destination" name="country" defaultValue={filter.country}>
            <option value="">All countries</option>
            {result.countries.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
          <Field label="Placed from" name="from" type="date" defaultValue={filter.from} />
          <Field label="Placed to" name="to" type="date" defaultValue={filter.to} />
          <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-4">
            <Submit variant="secondary">Filter</Submit>
            {filtered && <LinkButton href="/admin/orders">Clear filters</LinkButton>}
          </div>
        </form>
      </Card>

      <Card>
        <form action={bulkOrders.bind(null, here)}>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <Select label="With selected orders" name="action" defaultValue="" className="w-64">
              <option value="" disabled>
                Choose an action
              </option>
              {Object.entries(BULK_ACTIONS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Submit variant="secondary">Apply</Submit>
            <p className="text-small text-stone-700">Orders that cannot take the step are skipped and listed.</p>
          </div>
          <Table head={[<SelectAll key="all" name="ids" label="Select all orders on this page" />, "Order", "Placed", "Customer", "Ship to", "Items", "Status", "Payment", "Fulfilment", "Total"]} empty={result.rows.length === 0 ? "No orders match." : undefined}>
            {result.rows.map((order) => (
              <tr key={order.id}>
                <td>
                  <input type="checkbox" name="ids" value={order.id} aria-label={`Select order ${order.number}`} className="size-4 accent-olive-700" />
                </td>
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
                <td>{order.shipCountryCode}</td>
                <td className="tabular-nums">{order.items.reduce((sum, item) => sum + item.quantity, 0)}</td>
                <td>
                  <Badge tone={order.status}>{ORDER_STATUS_LABEL[order.status]}</Badge>
                </td>
                <td>
                  <Badge tone={order.paymentStatus}>{PAYMENT_LABEL[order.paymentStatus]}</Badge>
                </td>
                <td>
                  <Badge tone={order.fulfilmentStatus}>{FULFILMENT_LABEL[order.fulfilmentStatus]}</Badge>
                </td>
                <td className="tabular-nums">{money(order.totalCents)}</td>
              </tr>
            ))}
          </Table>
        </form>
        {result.pages > 1 && (
          <nav aria-label="Pages" className="mt-5 flex items-center justify-between">
            {result.page > 1 ? <LinkButton href={`/admin/orders?${query({ page: String(result.page - 1) })}`}>Previous</LinkButton> : <span />}
            <span className="text-small text-stone-700">
              Page {result.page} of {result.pages}
            </span>
            {result.page < result.pages ? <LinkButton href={`/admin/orders?${query({ page: String(result.page + 1) })}`}>Next</LinkButton> : <span />}
          </nav>
        )}
      </Card>
    </Page>
  );
}
