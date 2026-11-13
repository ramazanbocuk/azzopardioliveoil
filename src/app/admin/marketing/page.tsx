import { Badge, Card, Flash, LinkButton, Page, Stat, Table, date, dateTime, money } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { marketingOverview } from "@/server/backoffice";

export const metadata = { title: "Marketing" };

export default async function MarketingPage({ searchParams }: PageProps<"/admin/marketing">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [data, params] = await Promise.all([marketingOverview(ctx), searchParams]);

  return (
    <Page
      title="Marketing"
      eyebrow={`${data.subscribed} newsletter subscriber${data.subscribed === 1 ? "" : "s"}`}
      actions={
        <>
          <LinkButton href="/admin/newsletter">Subscribers</LinkButton>
          <LinkButton href="/admin/discounts">Discount codes</LinkButton>
        </>
      }
    >
      <Flash params={params} />
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Subscribed" value={String(data.subscribed)} note="Confirmed by email (double opt-in)" />
        <Stat label="Waiting to confirm" value={String(data.pending)} />
        <Stat label="Unsubscribed" value={String(data.unsubscribed)} />
        <Stat label="Carts left for a day or more" value={String(data.abandoned.length)} note={`Worth ${money(data.abandoned.reduce((sum, cart) => sum + cart.valueCents, 0))}`} />
      </div>

      <Card title="Discount code performance" description="Paid orders only. Revenue is the order total, VAT included.">
        <Table head={["Code", "Kind", "Active", "Used", "Paid orders", "Discount given", "Revenue", "Ends"]} empty={data.discounts.length === 0 ? "No discount codes yet." : undefined}>
          {data.discounts.map((discount) => (
            <tr key={discount.id}>
              <td className="font-mono">{discount.code}</td>
              <td>{discount.kind === "PERCENT" ? `${discount.value}%` : discount.kind === "FIXED" ? money(discount.value, discount.currency) : "Free shipping"}</td>
              <td>
                <Badge tone={discount.isActive ? "PAID" : undefined}>{discount.isActive ? "ACTIVE" : "OFF"}</Badge>
              </td>
              <td className="tabular-nums">
                {discount.usedCount}
                {discount.usageLimit !== null ? ` / ${discount.usageLimit}` : ""}
              </td>
              <td className="tabular-nums">
                {discount.paidOrders}
                {discount.ordersInOtherCurrencies > 0 && <span className="text-small block text-stone-700">{discount.ordersInOtherCurrencies} in another currency, not in the amounts</span>}
              </td>
              <td className="tabular-nums">{money(discount.givenCents, discount.currency)}</td>
              <td className="tabular-nums">{money(discount.revenueCents, discount.currency)}</td>
              <td>{discount.endsAt ? date(discount.endsAt) : "—"}</td>
            </tr>
          ))}
        </Table>
        {data.wholesaleOrders > 0 && <p className="text-small mt-4 text-stone-700">{data.wholesaleOrders} paid order(s) used wholesale terms rather than a code.</p>}
      </Card>

      <Card title="Abandoned carts" description="Carts with items that have not changed for a day. An email address is known only when the visitor was signed in. No reminder email is sent: that needs the customer's marketing consent and a template, which are not set up.">
        <Table head={["Last changed", "Customer", "Marketing consent", "Items", "Units", "Value"]} empty={data.abandoned.length === 0 ? "No carts have been left." : undefined}>
          {data.abandoned.map((cart) => (
            <tr key={cart.id}>
              <td className="whitespace-nowrap">{dateTime(cart.updatedAt)}</td>
              <td>{cart.email ?? "Guest (unknown)"}</td>
              <td>{cart.email ? (cart.mayEmail ? "Yes" : "No") : "—"}</td>
              <td className="max-w-96">{cart.summary}</td>
              <td className="tabular-nums">{cart.units}</td>
              <td className="tabular-nums">{money(cart.valueCents)}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Not built">
        <p className="text-stone-700">Sending newsletters or campaigns from here, abandoned-cart reminders, referral or loyalty schemes, and advertising or analytics pixels. Subscribers can be exported from Subscribers for use in an email tool, within the consent they gave.</p>
      </Card>
    </Page>
  );
}
