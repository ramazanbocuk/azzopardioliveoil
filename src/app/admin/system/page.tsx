import { Badge, Card, Flash, LinkButton, Page, Stat, Submit, Table, dateTime } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { can } from "@/server/permissions";
import { systemOverview, type CheckState } from "@/server/system";
import { resolveSystemError } from "../actions";

export const metadata = { title: "System status" };

const TONE: Record<CheckState, string> = { ok: "PAID", warning: "UNPAID", failing: "CANCELLED" };
const WORD: Record<CheckState, string> = { ok: "In order", warning: "Needs attention", failing: "Not working" };
const HEADLINE: Record<CheckState, string> = { ok: "Everything checked is in order.", warning: "Something needs attention.", failing: "Something is not working." };
const ENVIRONMENT = { production: "Live site", staging: "Staging (test copy)", development: "Development machine" };

export default async function SystemPage({ searchParams }: PageProps<"/admin/system">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [data, params] = await Promise.all([systemOverview(ctx), searchParams]);
  const mayResolve = can(ctx.admin.role, "MANAGER", "integrations");
  const open = data.errors.filter((error) => !error.resolvedAt);
  const resolved = data.errors.filter((error) => error.resolvedAt);

  return (
    <Page title="System status" eyebrow={ENVIRONMENT[data.environment]} actions={<LinkButton href="/admin/notifications">Notifications</LinkButton>}>
      <Flash params={params} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Overall" value={WORD[data.state]} note={HEADLINE[data.state]} />
        <Stat label="Scheduler last ran" value={data.scheduler ? dateTime(new Date(data.scheduler.lastRunAt)) : "Never"} note="Sends email, releases unpaid stock holds, refreshes tracking, deletes expired data. Should run every 5 minutes." />
        <Stat label="Messages waiting" value={String(data.jobs.PENDING ?? 0)} note={`${data.jobs.FAILED ?? 0} failed, ${data.jobs.SKIPPED ?? 0} skipped`} />
        <Stat label="Open errors" value={String(open.length)} />
      </div>
      <p className="text-small text-stone-700">
        These checks run inside the website, so they cannot tell you when the whole site is down. For that, an uptime monitor outside the host must watch <code>/api/health</code>. Whether backups exist is also not something this page can know: see the host&rsquo;s database settings.
      </p>

      <Card title="Checks">
        <Table head={["", "What", "State"]}>
          {data.checks.map((check) => (
            <tr key={check.key}>
              <td className="w-px whitespace-nowrap align-top">
                <Badge tone={TONE[check.state]}>{WORD[check.state]}</Badge>
              </td>
              <td className="whitespace-nowrap align-top font-medium">{check.label}</td>
              <td className="align-top">{check.detail}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Website errors" description="Each row is one distinct failure the site could not handle; visitors saw an apology page. The shop is emailed the first time each one happens on a day. No customer data, form content or cookie is kept here. A developer needs the technical detail; mark an error resolved once it is fixed. If it happens again it reopens by itself.">
        {open.length === 0 && <p>No open error.</p>}
        <div className="space-y-5">
          {open.map((error) => (
            <article key={error.id} className="border border-ink/15 p-4">
              <p className="font-medium break-words">{error.message}</p>
              <p className="text-small mt-1 text-stone-700">
                {error.count} time{error.count === 1 ? "" : "s"} · first {dateTime(error.firstSeenAt)} · last {dateTime(error.lastSeenAt)}
                {error.route ? ` · ${error.method ?? ""} ${error.route}` : ""}
                {error.kind ? ` · ${error.kind}` : ""}
                {error.lastDigest ? ` · code shown to the visitor: ${error.lastDigest}` : ""}
              </p>
              {error.stack && (
                <details className="mt-3">
                  <summary className="text-small cursor-pointer">Technical detail</summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words border border-ink/10 bg-stone-300/20 p-3 font-mono text-[0.75rem] leading-relaxed">{error.stack}</pre>
                </details>
              )}
              {mayResolve && (
                <form action={resolveSystemError.bind(null, error.id)} className="mt-4">
                  <Submit variant="secondary">Mark resolved</Submit>
                </form>
              )}
            </article>
          ))}
        </div>
        {resolved.length > 0 && (
          <details className="mt-6">
            <summary className="cursor-pointer">Resolved ({resolved.length}). Deleted 90 days after being resolved.</summary>
            <ul className="text-small mt-3 space-y-2">
              {resolved.map((error) => (
                <li key={error.id} className="break-words">
                  {dateTime(error.resolvedAt)} · {error.message} · {error.count} time{error.count === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
    </Page>
  );
}
