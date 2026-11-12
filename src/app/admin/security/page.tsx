import { Badge, Card, Field, Flash, LinkButton, Page, Stat, Submit, Table, dateTime } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { securityOverview } from "@/server/twoFactor";
import { beginTwoFactor, confirmTwoFactor, disableTwoFactor, resetTwoFactor, revokeSession } from "../actions";

export const metadata = { title: "Security" };

const device = (userAgent: string | null) => {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const system = /iPhone|iPad/.test(userAgent) ? "iOS" : /Android/.test(userAgent) ? "Android" : /Mac OS X/.test(userAgent) ? "macOS" : /Windows/.test(userAgent) ? "Windows" : /Linux/.test(userAgent) ? "Linux" : "";
  return [browser, system].filter(Boolean).join(" on ");
};

export default async function SecurityPage({ searchParams }: PageProps<"/admin/security">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [data, params] = await Promise.all([securityOverview(ctx), searchParams]);
  const withTwoFactor = data.staff.filter((user) => user.totpEnabledAt).length;

  return (
    <Page title="Security" eyebrow={data.me.totpOn ? "Two-factor sign-in is on for you" : "Two-factor sign-in is off for you"} actions={<LinkButton href="/admin/audit">Audit log</LinkButton>}>
      <Flash params={params} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Active sessions" value={String(data.sessions.length)} note={data.everyone ? "All staff" : "Yours"} />
        <Stat label="Failed sign-ins, last 24 hours" value={String(data.failedSignIns24h)} note="Five wrong passwords lock an address for 15 minutes." />
        {data.everyone && <Stat label="Staff with two-factor on" value={`${withTwoFactor} of ${data.staff.length}`} />}
      </div>

      <Card title="Two-factor sign-in" description="Adds a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy) to your password.">
        {data.me.totpOn ? (
          <form action={disableTwoFactor} className="flex flex-wrap items-end gap-4">
            <Field label="Your password, to turn it off" name="password" type="password" required autoComplete="current-password" className="w-72" />
            <Submit variant="danger">Turn off two-factor sign-in</Submit>
          </form>
        ) : data.me.pending ? (
          <div className="space-y-5">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Open your authenticator app and choose to add an account by entering a setup key.</li>
              <li>
                Enter this key (type: time-based):
                <code className="mt-2 block w-fit select-all break-all border border-ink/20 bg-stone-300/30 px-3 py-2 font-mono text-[0.9375rem] tracking-wider">{data.me.pending.secret.match(/.{1,4}/g)?.join(" ")}</code>
              </li>
              <li>Enter the 6-digit code the app now shows.</li>
            </ol>
            <form action={confirmTwoFactor} className="flex flex-wrap items-end gap-4">
              <Field label="6-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required className="w-40" />
              <Submit>Turn on two-factor sign-in</Submit>
            </form>
            <p className="text-small text-stone-700">The key is shown only while setup is unfinished. If you lose your phone later, an administrator can reset two-factor sign-in for you; the only administrator can use the command line (see the operations guide).</p>
          </div>
        ) : (
          <form action={beginTwoFactor}>
            <Submit>Set up two-factor sign-in</Submit>
          </form>
        )}
      </Card>

      <Card title="Signed-in devices" description="End a session to sign that device out at once.">
        <Table head={["Who", "Device", "IP address", "Signed in", "Expires", ""]}>
          {data.sessions.map((session) => (
            <tr key={session.id}>
              <td>
                {session.who}
                <span className="text-small block text-stone-700">{session.email}</span>
              </td>
              <td>
                {device(session.userAgent)}
                {session.current && <span className="text-small block text-olive-700">This device</span>}
              </td>
              <td className="font-mono text-[0.8125rem]">{session.ip ?? "—"}</td>
              <td className="whitespace-nowrap">{dateTime(session.createdAt)}</td>
              <td className="whitespace-nowrap">{dateTime(session.expiresAt)}</td>
              <td>
                <form action={revokeSession.bind(null, session.id)}>
                  <Submit variant="secondary" className="!h-9 !px-3">{session.current ? "Sign out" : "End session"}</Submit>
                </form>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      {data.everyone && (
        <>
          <Card title="Staff sign-in protection">
            <Table head={["Name", "Role", "Two-factor", "Last sign-in", ""]}>
              {data.staff.map((user) => (
                <tr key={user.id}>
                  <td>
                    {user.name}
                    <span className="text-small block text-stone-700">{user.email}</span>
                  </td>
                  <td>{user.role.toLowerCase()}</td>
                  <td>
                    <Badge tone={user.totpEnabledAt ? "PAID" : "UNPAID"}>{user.totpEnabledAt ? "ON" : "OFF"}</Badge>
                    {!user.isActive && <span className="text-small ml-2 text-stone-700">account deactivated</span>}
                  </td>
                  <td className="whitespace-nowrap">{dateTime(user.lastLoginAt)}</td>
                  <td>
                    {user.totpEnabledAt && user.id !== ctx.admin!.id && (
                      <form action={resetTwoFactor.bind(null, user.id)}>
                        <Submit variant="danger" className="!h-9 !px-3">Reset two-factor</Submit>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Recent security events">
            <Table head={["When", "Event", "IP address"]} empty={data.recent.length === 0 ? "Nothing recorded yet." : undefined}>
              {data.recent.map((event) => (
                <tr key={event.id}>
                  <td className="whitespace-nowrap">{dateTime(event.createdAt)}</td>
                  <td>
                    {event.action === "admin.login" ? "Signed in" : event.action === "admin.login.failed" ? "Failed sign-in" : event.action.replace("admin.", "").replaceAll(".", " ").replaceAll("_", " ")}
                    {event.action === "admin.login.failed" && typeof (event.data as { email?: string } | null)?.email === "string" && <span className="text-small block text-stone-700">{(event.data as { email: string }).email}</span>}
                  </td>
                  <td className="font-mono text-[0.8125rem]">{event.ip ?? "—"}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}

      <Card title="What protects the shop">
        <ul className="list-disc space-y-1.5 pl-5 text-stone-700">
          <li>Passwords are stored only as Argon2id hashes; sessions and reset links as hashes too.</li>
          <li>Staff sessions use a Strict, HttpOnly cookie and expire by themselves.</li>
          <li>Every staff action is checked against the person’s role on the server and written to the audit log.</li>
          <li>Card details never reach this site: payment happens on the payment provider’s page.</li>
          <li>Not built: forced two-factor for all staff, single sign-on, IP allow-lists, and alerts on unusual sign-ins.</li>
        </ul>
      </Card>
    </Page>
  );
}
