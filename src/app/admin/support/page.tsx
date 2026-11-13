import Link from "next/link";
import { Badge, Card, Field, Flash, LinkButton, Page, Select, Stat, Submit, cellLink, dateTime } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { SUPPORT_STATES, listSupportRequests } from "@/server/assistantAdmin";
import { can } from "@/server/permissions";
import { supportStatus } from "../actions";

export const metadata = { title: "Support requests" };

const STATE_LABEL: Record<string, string> = { OPEN: "Waiting for a reply", ANSWERED: "Answered", CLOSED: "Closed" };

export default async function SupportPage({ searchParams }: PageProps<"/admin/support">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "";
  const data = await listSupportRequests(ctx, status);
  const mayHandle = can(ctx.admin.role, "STAFF", "support");

  return (
    <Page
      title="Support requests"
      eyebrow="Questions the assistant passed to a person"
      actions={
        <>
          <LinkButton href="/admin/support?status=OPEN">Waiting</LinkButton>
          <LinkButton href="/admin/support">All</LinkButton>
        </>
      }
    >
      <Flash params={params} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Waiting for a reply" value={String(data.open)} />
        <Stat label="Of which urgent" value={String(data.urgent)} note="A complaint, a payment or refund problem, a parcel problem, or a safety concern." />
      </div>
      <p className="text-small text-stone-700">The customer was told the team will reply by email. Reply from the shop’s own mailbox, then mark the request answered here. Nothing is sent to the customer from this screen.</p>

      {data.rows.length === 0 && <Card>No request{status ? " in this state" : ""}.</Card>}
      {data.rows.map((request) => (
        <Card key={request.id} title={`${request.reference} · ${request.subject}`}>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={request.status === "OPEN" ? "UNPAID" : "PAID"}>{STATE_LABEL[request.status] ?? request.status}</Badge>
            {request.urgent && <Badge tone="CANCELLED">Urgent</Badge>}
            <span className="text-small text-stone-700">
              {dateTime(request.createdAt)} · {request.name ?? "No name given"} · <a href={`mailto:${request.email}`} className="underline underline-offset-4">{request.email}</a> · language {request.locale}
              {request.orderNumber ? ` · order ${request.orderNumber}` : ""}
            </span>
          </div>
          <p className="mt-4 whitespace-pre-wrap">{request.body}</p>
          <p className="text-small mt-3 text-stone-700">
            {request.conversationId && (
              <Link href={`/admin/assistant/${request.conversationId}`} className={cellLink}>
                Read the conversation
              </Link>
            )}
            {request.handledBy ? ` · Handled by ${request.handledBy} on ${dateTime(request.handledAt)}` : ""}
          </p>
          {mayHandle && (
            <form action={supportStatus.bind(null, request.id)} className="mt-5 grid gap-4 border-t border-ink/10 pt-5 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
              <Select label="State" name="status" defaultValue={request.status}>
                {SUPPORT_STATES.map((state) => (
                  <option key={state} value={state}>
                    {STATE_LABEL[state]}
                  </option>
                ))}
              </Select>
              <Field label="Note for colleagues (optional)" name="staffNote" defaultValue={request.staffNote ?? ""} maxLength={2000} />
              <Submit variant="secondary">Save</Submit>
            </form>
          )}
        </Card>
      ))}
    </Page>
  );
}
