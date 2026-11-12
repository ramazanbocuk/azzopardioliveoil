import Link from "next/link";
import { Badge, Card, Flash, LinkButton, Page, Submit, Table, cellLink, date, dateTime, money } from "@/components/admin/ui";
import { getCustomer } from "@/server/admin";
import { adminCtx } from "@/server/adminSession";
import { eraseCustomer } from "../../actions";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params, searchParams }: PageProps<"/admin/customers/[id]">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [{ id }, flash] = await Promise.all([params, searchParams]);
  const customer = await getCustomer(ctx, id);

  return (
    <Page title={`${customer.firstName} ${customer.lastName}`} eyebrow="Customer" actions={<LinkButton href="/admin/customers">All customers</LinkButton>}>
      <Flash params={flash} />
      <div className="grid gap-8 xl:grid-cols-3">
        <Card title="Contact">
          <p className="break-words">{customer.email}</p>
          <p className="text-stone-700">{customer.phone ?? "No phone number"}</p>
          <p className="text-small mt-4 text-stone-700">
            Joined {date(customer.createdAt)} · Newsletter: {customer.marketingOptIn ? "yes" : "no"}
          </p>
          {customer.addresses.map((address) => (
            <address key={address.id} className="mt-4 border-t border-ink/10 pt-4 not-italic">
              {address.line1}
              <span className="block">
                {address.postalCode} {address.city}, {address.countryCode}
              </span>
            </address>
          ))}
        </Card>
        <Card title="Orders" className="xl:col-span-2">
          <Table head={["Order", "Placed", "Status", "Total"]} empty={customer.orders.length === 0 ? "No orders on this account." : undefined}>
            {customer.orders.map((order) => (
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
                <td className="tabular-nums">{money(order.totalCents)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      <Card title="Data protection request" description="Administrators only. Use when a customer asks for their personal data to be deleted.">
        <form action={eraseCustomer.bind(null, customer.id)} className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-[64ch] text-stone-700">Removes the name, email, phone, addresses, favourites, reviews and sign-in from this account. Orders are kept, as invoices must be retained by law, but are detached from the account. This cannot be undone.</p>
          <Submit variant="danger">Erase personal data</Submit>
        </form>
      </Card>
    </Page>
  );
}
