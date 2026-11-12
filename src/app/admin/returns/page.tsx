import Link from "next/link";
import { Badge, Card, Flash, Page, Stat, Submit, Table, cellLink, dateTime, money } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { listReturnsAndRefunds } from "@/server/backoffice";
import { returnStatus } from "../actions";

export const metadata = { title: "Returns & refunds" };

export default async function ReturnsPage({ searchParams }: PageProps<"/admin/returns">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [data, params] = await Promise.all([listReturnsAndRefunds(ctx), searchParams]);

  return (
    <Page title="Returns & refunds" eyebrow={`${data.open} open return${data.open === 1 ? "" : "s"}`}>
      <Flash params={params} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Open returns" value={String(data.open)} />
        <Stat label="Returns on record" value={String(data.returns.length)} />
        <Stat label="Refunds issued" value={money(data.refunds.reduce((sum, refund) => sum + refund.amountCents, 0))} note={`${data.refunds.length} most recent`} />
      </div>

      <Card title="Return requests" description="Customers request a return from their account once an order is delivered. Approving does not move money: issue the refund from the order page when the goods are back.">
        <Table head={["Requested", "Order", "Customer", "Items", "Reason", "State", ""]} empty={data.returns.length === 0 ? "No return has been requested." : undefined}>
          {data.returns.map((request) => (
            <tr key={request.id}>
              <td className="whitespace-nowrap">{dateTime(request.createdAt)}</td>
              <td>
                <Link href={`/admin/orders/${request.order.id}`} className={cellLink}>
                  {request.order.number}
                </Link>
              </td>
              <td>
                {request.order.shipFirstName} {request.order.shipLastName}
                <span className="text-small block text-stone-700">{request.order.email}</span>
              </td>
              <td>{request.lines.map((line) => `${line.quantity} × ${line.name}`).join(", ") || "—"}</td>
              <td className="max-w-64">{request.reason}</td>
              <td>
                <Badge tone={request.status === "REJECTED" ? "FAILED" : request.status === "REQUESTED" ? "UNPAID" : "PAID"}>{request.status}</Badge>
              </td>
              <td>
                <div className="flex flex-wrap gap-2">
                  {(["APPROVED", "REJECTED", "RECEIVED"] as const).map((status) => (
                    <form key={status} action={returnStatus.bind(null, request.order.id, request.id, status)}>
                      <Submit variant="secondary" className="!h-9 !px-3" disabled={request.status === status || request.status === "REFUNDED"}>
                        {status === "APPROVED" ? "Approve" : status === "REJECTED" ? "Reject" : "Goods received"}
                      </Submit>
                    </form>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Refunds" description="Each refund was sent through the payment provider first and recorded only once the provider accepted it.">
        <Table head={["Issued", "Order", "Amount", "Reason", "By", "Provider reference"]} empty={data.refunds.length === 0 ? "No refund has been issued." : undefined}>
          {data.refunds.map((refund) => (
            <tr key={refund.id}>
              <td className="whitespace-nowrap">{dateTime(refund.createdAt)}</td>
              <td>
                <Link href={`/admin/orders/${refund.payment.order.id}`} className={cellLink}>
                  {refund.payment.order.number}
                </Link>
              </td>
              <td className="tabular-nums">{money(refund.amountCents)}</td>
              <td>{refund.reason ?? "—"}</td>
              <td>{refund.by}</td>
              <td className="font-mono text-[0.75rem] text-stone-700">{refund.providerRef ?? "—"}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
