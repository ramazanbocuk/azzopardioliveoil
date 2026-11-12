import { Badge, Card, LinkButton, Page, Table, dateTime } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth";
import { adminCtx } from "@/server/adminSession";

export const metadata = { title: "Newsletter" };

export default async function NewsletterPage() {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  requireAdmin(ctx);
  const subscribers = await ctx.db.newsletterSubscriber.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  const confirmed = subscribers.filter((s) => s.status === "SUBSCRIBED").length;

  return (
    <Page title="Newsletter" eyebrow={`${subscribers.length} address${subscribers.length === 1 ? "" : "es"}, ${confirmed} confirmed`} actions={<LinkButton href="/admin/export/newsletter">Export (CSV)</LinkButton>}>
      <p className="border-l-2 border-terracotta-700 bg-terracotta-500/10 px-4 py-3 text-terracotta-700">
        Confirmation emails are not being sent yet, so every address stays “pending”. Do not send marketing email to pending addresses: they have not confirmed their consent.
      </p>
      <Card>
        <Table head={["Email", "Status", "Language", "Added"]} empty={subscribers.length === 0 ? "No sign-ups yet." : undefined}>
          {subscribers.map((subscriber) => (
            <tr key={subscriber.id}>
              <td>{subscriber.email}</td>
              <td>
                <Badge tone={subscriber.status === "SUBSCRIBED" ? "PAID" : "PENDING_PAYMENT"}>{subscriber.status}</Badge>
              </td>
              <td>{subscriber.locale}</td>
              <td>{dateTime(subscriber.createdAt)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
