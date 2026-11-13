import Link from "next/link";
import { Badge, Card, Field, Flash, LinkButton, Page, Stat, Submit, Table, TextArea, cellLink, date, dateTime, money } from "@/components/admin/ui";
import { customerProfile } from "@/server/backoffice";
import { adminCtx } from "@/server/adminSession";
import { addCustomerNote, eraseCustomer, setCustomerTags } from "../../actions";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params, searchParams }: PageProps<"/admin/customers/[id]">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [{ id }, flash] = await Promise.all([params, searchParams]);
  const { customer, notes, metrics } = await customerProfile(ctx, id);

  return (
    <Page title={`${customer.firstName} ${customer.lastName}`} eyebrow="Customer" actions={<LinkButton href="/admin/customers">All customers</LinkButton>}>
      <Flash params={flash} />
      <div className="flex flex-wrap gap-2">
        {customer.wholesaleStatus === "APPROVED" && <Badge tone="PAID">{`WHOLESALE ${customer.wholesaleDiscountBps / 100}%`}</Badge>}
        {metrics.paidOrders >= 2 && <Badge tone="PROCESSING">REPEAT CUSTOMER</Badge>}
        {customer.tags.map((tag) => (
          <Badge key={tag} tone={tag === "VIP" ? "UNPAID" : undefined}>
            {tag}
          </Badge>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Paid orders" value={String(metrics.paidOrders)} note={metrics.firstOrderAt ? `First ${date(metrics.firstOrderAt)}` : undefined} />
        <Stat label="Total spent" value={money(metrics.spentCents)} note={[metrics.otherSpend ? `In euro. Also ${metrics.otherSpend}, not included in these figures` : "", metrics.lastOrderAt ? `Last order ${date(metrics.lastOrderAt)}` : ""].filter(Boolean).join(". ") || undefined} />
        <Stat label="Average order" value={metrics.paidOrders ? money(metrics.averageCents) : "—"} />
        <Stat label="Refunded" value={money(metrics.refundedCents)} note={`${metrics.returns} return request${metrics.returns === 1 ? "" : "s"}`} />
        <Stat label="Lifetime value" value={money(metrics.lifetimeCents)} note="Spent less refunds, VAT included" />
      </div>
      <div className="grid gap-8 xl:grid-cols-3">
        <Card title="Contact">
          <p className="break-words">{customer.email}</p>
          <p className="text-stone-700">{customer.phone ?? "No phone number"}</p>
          <p className="text-small mt-4 text-stone-700">
            Joined {date(customer.createdAt)} · Newsletter: {customer.marketingOptIn ? "yes" : "no"}
          </p>
          {customer.companyName && (
            <p className="mt-4 border-t border-ink/10 pt-4">
              {customer.companyName}
              {customer.companyVatNumber && <span className="block text-stone-700">VAT {customer.companyVatNumber}</span>}
              <Link href="/admin/wholesale" className={`${cellLink} text-small mt-1 inline-block`}>
                Wholesale terms
              </Link>
            </p>
          )}
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
                <td className="tabular-nums">{money(order.totalCents, order.currency)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      <div className="grid gap-8 xl:grid-cols-3">
        <Card title="Tags" description="Short labels for grouping customers, such as VIP, Restaurant or Press. Separate with commas.">
          <form action={setCustomerTags.bind(null, customer.id)} className="space-y-3">
            <Field label="Tags" name="tags" defaultValue={customer.tags.join(", ")} placeholder="VIP, Restaurant" />
            <Submit variant="secondary">Save tags</Submit>
          </form>
        </Card>
        <Card title="Staff notes" description="Never shown to the customer, but included if they ask for a copy of their data: write accordingly." className="xl:col-span-2">
          <form action={addCustomerNote.bind(null, customer.id)}>
            <TextArea label="Add a note" name="body" required rows={2} />
            <Submit variant="secondary" className="mt-3">Add note</Submit>
          </form>
          <ul className="mt-5 space-y-4">
            {notes.map((note) => (
              <li key={note.id} className="border-t border-ink/10 pt-3">
                <p className="whitespace-pre-wrap">{note.body}</p>
                <p className="text-small mt-1 text-stone-700">
                  {note.by} · {dateTime(note.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="Data protection request" description="Administrators only. Use when a customer asks for their personal data to be deleted.">
        <form action={eraseCustomer.bind(null, customer.id)} className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-[64ch] text-stone-700">Removes the name, email, phone, addresses, favourites, reviews, tags, staff notes, wholesale terms and sign-in from this account. Orders are kept, as invoices must be retained by law, but are detached from the account. This cannot be undone.</p>
          <Submit variant="danger">Erase personal data</Submit>
        </form>
      </Card>
    </Page>
  );
}
