import { Badge, Card, Flash, Page, Submit, Table, dateTime } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth";
import { adminCtx } from "@/server/adminSession";
import { retryJob, runJobsNow } from "../actions";

export const metadata = { title: "Notifications" };

const LABELS: Record<string, string> = {
  "notify.owner.whatsapp": "Owner · WhatsApp",
  "notify.owner.email": "Owner · email",
  "notify.owner.sms": "Owner · SMS",
  "notify.customer.confirmation": "Customer · order confirmation",
  "notify.customer.shipped": "Customer · shipped",
  "email.newsletter.confirm": "Newsletter · confirm address",
  "email.contact": "Contact form",
};
const TONE: Record<string, string> = { DONE: "PAID", PENDING: "PENDING_PAYMENT", PROCESSING: "PENDING_PAYMENT", FAILED: "FAILED", SKIPPED: "CANCELLED" };

/** A contact message stays readable here even if email delivery is not connected. */
function ContactMessage({ payload }: { payload: unknown }) {
  const message = payload as { name?: string; email?: string; reference?: string | null; body?: string };
  return (
    <details className="mt-1 text-ink">
      <summary className="cursor-pointer underline underline-offset-4">
        Message from {message.name} ({message.email})
      </summary>
      {message.reference && <p className="mt-2">Reference: {message.reference}</p>}
      <p className="mt-2 whitespace-pre-wrap">{message.body}</p>
    </details>
  );
}

export default async function NotificationsPage({ searchParams }: PageProps<"/admin/notifications">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  requireAdmin(ctx, "VIEW", "notifications");
  const [jobs, counts, params] = await Promise.all([ctx.db.outboxJob.findMany({ orderBy: { createdAt: "desc" }, take: 100 }), ctx.db.outboxJob.groupBy({ by: ["status"], _count: true }), searchParams]);
  const count = (status: string) => counts.find((row) => row.status === status)?._count ?? 0;

  return (
    <Page
      title="Notifications"
      eyebrow={`${count("DONE")} sent · ${count("PENDING")} waiting · ${count("SKIPPED")} skipped · ${count("FAILED")} failed`}
      actions={
        <form action={runJobsNow}>
          <Submit variant="secondary">Send waiting now</Submit>
        </form>
      }
    >
      <Flash params={params} />
      <Card title="Delivery log" description="Each message is queued once when its order is paid or shipped, then sent with retries. “Skipped” means the channel is switched off or not connected: nothing was sent. Retry a skipped or failed message after fixing the cause.">
        <Table head={["Queued", "Message", "Status", "Tries", "Detail", ""]} empty={jobs.length === 0 ? "Nothing queued yet." : undefined}>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td className="whitespace-nowrap">{dateTime(job.createdAt)}</td>
              <td>{LABELS[job.kind] ?? job.kind}</td>
              <td>
                <Badge tone={TONE[job.status]}>{job.status === "DONE" ? "SENT" : job.status}</Badge>
              </td>
              <td className="tabular-nums">{job.attempts}</td>
              <td className="max-w-sm text-[0.8125rem] text-stone-700">
                {job.lastError ?? (job.status === "PENDING" ? `Next attempt ${dateTime(job.runAfter)}` : "")}
                {job.kind === "email.contact" && <ContactMessage payload={job.payload} />}
              </td>
              <td className="text-right">
                {(job.status === "FAILED" || job.status === "SKIPPED") && (
                  <form action={retryJob.bind(null, job.id)}>
                    <Submit variant="secondary" className="!h-8 !px-3">Retry</Submit>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
