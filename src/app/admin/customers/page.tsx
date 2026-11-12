import Link from "next/link";
import { Card, Field, Flash, LinkButton, Page, Submit, Table, cellLink, date, money } from "@/components/admin/ui";
import { listCustomers } from "@/server/admin";
import { adminCtx } from "@/server/adminSession";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const customers = await listCustomers(ctx, q);
  const spent = (c: (typeof customers)[number]) => c.orders.reduce((sum, order) => sum + order.totalCents, 0);
  const segment = (c: (typeof customers)[number]) => (c.orders.length >= 3 ? "Regular" : c.orders.length >= 1 ? "Customer" : "No paid order");

  return (
    <Page title="Customers" eyebrow={`${customers.length} shown`} actions={<LinkButton href="/admin/export/customers">Export (CSV)</LinkButton>}>
      <Flash params={params} />
      <Card>
        <form className="flex flex-wrap items-end gap-4">
          <Field label="Search" name="q" defaultValue={q} placeholder="Name or email" className="min-w-64 flex-1" />
          <Submit variant="secondary">Search</Submit>
        </form>
      </Card>
      <Card>
        <Table head={["Customer", "Joined", "Orders", "Paid total", "Segment", "Newsletter"]} empty={customers.length === 0 ? "No customer accounts yet. Guest orders appear under Orders." : undefined}>
          {customers.map((customer) => (
            <tr key={customer.id}>
              <td>
                <Link href={`/admin/customers/${customer.id}`} className={cellLink}>
                  {customer.firstName} {customer.lastName}
                </Link>
                <span className="text-small block text-stone-700">{customer.email}</span>
              </td>
              <td>{date(customer.createdAt)}</td>
              <td className="tabular-nums">{customer._count.orders}</td>
              <td className="tabular-nums">{money(spent(customer))}</td>
              <td>{segment(customer)}</td>
              <td>{customer.marketingOptIn ? "Yes" : "No"}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
