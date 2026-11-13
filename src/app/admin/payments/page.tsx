import Link from "next/link";
import { Badge, Card, Field, Flash, LinkButton, Page, Select, Stat, Submit, Table, cellLink, dateTime, money } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { listPayments } from "@/server/backoffice";
import { DISPUTE_LABEL } from "@/server/paymentSync";

export const metadata = { title: "Payments" };

const STATES = { UNPAID: "Not completed", PROCESSING: "Processing", PAID: "Paid", PARTIALLY_REFUNDED: "Partially refunded", REFUNDED: "Refunded", FAILED: "Failed" } as const;

export default async function PaymentsPage({ searchParams }: PageProps<"/admin/payments">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const params = await searchParams;
  const value = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const result = await listPayments(ctx, { status: value("status"), from: value("from"), to: value("to"), page: Number(params.page) || 1, currency: value("currency") });
  // The four totals are in one currency; each row below carries its own.
  const total = (cents: number) => money(cents, result.currency);
  const query = (page: number) => new URLSearchParams({ ...(value("status") ? { status: value("status") } : {}), from: result.range.fromText, to: result.range.toText, page: String(page) }).toString();

  return (
    <Page title="Payments" eyebrow={`${result.range.fromText} to ${result.range.toText}`}>
      <Flash params={params} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Received" value={total(result.receivedCents)} note={`${result.receivedCount} payment${result.receivedCount === 1 ? "" : "s"} started in this period`} />
        <Stat label="Refunded" value={total(result.refundedCents)} note={`${result.refundedCount} refund${result.refundedCount === 1 ? "" : "s"} issued in this period`} />
        <Stat label="Lost to disputes" value={total(result.lostCents)} note={`${result.lostCount} dispute${result.lostCount === 1 ? "" : "s"} lost in this period`} />
        <Stat label="Net of refunds and disputes" value={total(result.receivedCents - result.refundedCents - result.lostCents)} note="Before the payment provider's fees, which are not recorded here." />
      </div>
      <Card>
        <form className="flex flex-wrap items-end gap-4">
          <Field label="From" name="from" type="date" defaultValue={result.range.fromText} />
          {result.currencies.length > 1 && (
            <Select label="Totals in" name="currency" defaultValue={result.currency}>
              {result.currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          )}
          <Field label="To" name="to" type="date" defaultValue={result.range.toText} />
          <Select label="State" name="status" defaultValue={value("status")} className="w-56">
            <option value="">Any state</option>
            {Object.entries(STATES).map(([state, label]) => (
              <option key={state} value={state}>
                {label}
              </option>
            ))}
          </Select>
          <Submit variant="secondary">Filter</Submit>
        </form>
      </Card>
      <Card description="A payment is marked paid only by a signed message from the payment provider, never by the browser. Refunds are issued from the order page; a refund made directly at the provider is picked up from the provider's own report.">
        <Table head={["Started", "Order", "Provider", "Method", "State", "Amount", "Refunded", "Provider reference"]} empty={result.rows.length === 0 ? "No payments in this period." : undefined}>
          {result.rows.map((payment) => (
            <tr key={payment.id}>
              <td className="whitespace-nowrap">{dateTime(payment.createdAt)}</td>
              <td>
                <Link href={`/admin/orders/${payment.order.id}`} className={cellLink}>
                  {payment.order.number}
                </Link>
                <span className="text-small block text-stone-700">{payment.order.email}</span>
              </td>
              <td>{payment.provider.toLowerCase()}</td>
              <td>{payment.method ?? "—"}</td>
              <td>
                <Badge tone={payment.status}>{STATES[payment.status]}</Badge>
              </td>
              <td className="tabular-nums">{money(payment.amountCents, payment.currency)}</td>
              <td className="tabular-nums">{payment.refunds.length ? money(payment.refunds.reduce((sum, refund) => sum + refund.amountCents, 0), payment.currency) : "—"}</td>
              <td className="max-w-48 truncate font-mono text-[0.75rem] text-stone-700" title={payment.providerRef}>
                {payment.providerRef}
              </td>
            </tr>
          ))}
        </Table>
        {result.pages > 1 && (
          <nav aria-label="Pages" className="mt-5 flex items-center justify-between">
            {result.page > 1 ? <LinkButton href={`/admin/payments?${query(result.page - 1)}`}>Previous</LinkButton> : <span />}
            <span className="text-small text-stone-700">
              Page {result.page} of {result.pages}
            </span>
            {result.page < result.pages ? <LinkButton href={`/admin/payments?${query(result.page + 1)}`}>Next</LinkButton> : <span />}
          </nav>
        )}
      </Card>
      <Card title="Disputes" description="A dispute is a cardholder asking their bank to take a payment back. Open disputes, and those opened in this period, are listed. They are answered at the payment provider, not here; this list only mirrors what the provider reports.">
        <Table head={["Opened", "Order", "Amount", "Reason given", "State", "Answer by"]} empty={result.disputes.length === 0 ? "No disputes." : undefined}>
          {result.disputes.map((dispute) => (
            <tr key={dispute.id}>
              <td className="whitespace-nowrap">{dateTime(dispute.createdAt)}</td>
              <td>
                <Link href={`/admin/orders/${dispute.payment.order.id}`} className={cellLink}>
                  {dispute.payment.order.number}
                </Link>
                <span className="text-small block text-stone-700">{dispute.payment.order.email}</span>
              </td>
              <td className="tabular-nums">{money(dispute.amountCents, dispute.currency)}</td>
              <td>{dispute.reason ? dispute.reason.replaceAll("_", " ") : "—"}</td>
              <td>{DISPUTE_LABEL[dispute.status] ?? dispute.status.replaceAll("_", " ")}</td>
              <td className="whitespace-nowrap">{dispute.closedAt || !dispute.evidenceDueAt ? "—" : dateTime(dispute.evidenceDueAt)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
