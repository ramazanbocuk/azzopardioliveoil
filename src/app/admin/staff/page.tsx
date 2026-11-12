import { Badge, Card, Field, Flash, Page, Select, Submit, Table, dateTime } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth";
import { adminCtx } from "@/server/adminSession";
import { AREAS, ROLES, ROLE_ORDER, levelOf } from "@/server/permissions";
import { createStaff, setStaffActive, setStaffRole } from "../actions";

export const metadata = { title: "Staff" };



export default async function StaffPage({ searchParams }: PageProps<"/admin/staff">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  requireAdmin(ctx, "VIEW", "staff");
  const [users, params] = await Promise.all([ctx.db.adminUser.findMany({ orderBy: { createdAt: "asc" } }), searchParams]);

  return (
    <Page title="Staff" eyebrow="Roles and permissions">
      <Flash params={params} />
      <Card title="Roles">
        <dl className="grid gap-4 md:grid-cols-3">
          <div><dt className="font-medium">Staff</dt><dd className="text-stone-700">Sees orders, products and customers. Packs and ships orders, records lots, adds notes.</dd></div>
          <div><dt className="font-medium">Manager</dt><dd className="text-stone-700">Everything staff can do, plus products, prices, stock, lots, discounts, shipping rates, returns and exports.</dd></div>
          <div><dt className="font-medium">Administrator</dt><dd className="text-stone-700">Everything, plus refunds, VAT rates, settings, staff accounts and erasing customer data.</dd></div>
        </dl>
      </Card>
      <Card title="Accounts">
        <Table head={["Name", "Role", "Last sign-in", "Status", ""]}>
          {users.map((user) => (
            <tr key={user.id}>
              <td>
                {user.name}
                <span className="text-small block text-stone-700">{user.email}</span>
              </td>
              <td>
                <form action={setStaffRole.bind(null, user.id)} className="flex items-center gap-2">
                  <select name="role" defaultValue={user.role} aria-label={`Role for ${user.name}`} className="h-9 border border-ink/25 bg-white px-2">
                    {ROLE_ORDER.map((role) => (
                      <option key={role} value={role}>
                        {ROLES[role].label}
                      </option>
                    ))}
                  </select>
                  <Submit variant="secondary" className="!h-9 !px-3">Set</Submit>
                </form>
              </td>
              <td>{dateTime(user.lastLoginAt)}</td>
              <td>
                <Badge tone={user.isActive ? "PAID" : "CANCELLED"}>{user.isActive ? "Active" : "Deactivated"}</Badge>
              </td>
              <td className="text-right">
                <form action={setStaffActive.bind(null, user.id, !user.isActive)}>
                  <Submit variant={user.isActive ? "danger" : "secondary"} className="!h-9 !px-3">{user.isActive ? "Deactivate" : "Reactivate"}</Submit>
                </form>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="New staff account" description="Administrators only. Give the password to the person directly; it is stored only as a hash and cannot be read back.">
        <form action={createStaff} className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1.2fr_0.8fr_1.2fr_auto]">
          <Field label="Name" name="name" required />
          <Field label="Email address" name="email" type="email" required autoComplete="off" />
          <Select label="Role" name="role" defaultValue="CUSTOMER_SUPPORT">
            {ROLE_ORDER.map((role) => (
              <option key={role} value={role}>
                {ROLES[role].label}
              </option>
            ))}
          </Select>
          <Field label="Temporary password" name="password" type="password" required minLength={12} autoComplete="new-password" hint="At least 12 characters." />
          <Submit>Create</Submit>
        </form>
      </Card>
      <Card title="What each role can do" description="Each action needs a level (view, day-to-day work, manage, administer) in one area of the business. The check runs on the server for every action. Roles are fixed: they cannot be edited from this screen.">
        <Table head={["Role", "In short", "Manages", "Works in", "Can only view"]}>
          {ROLE_ORDER.map((role) => {
            const areas = AREAS.filter((area) => area !== "general" && area !== "security");
            const at = (level: number) => areas.filter((area) => levelOf(role, area) === level).join(", ") || "—";
            const top = areas.filter((area) => levelOf(role, area) >= 3);
            return (
              <tr key={role}>
                <td className="whitespace-nowrap font-medium">{ROLES[role].label}</td>
                <td className="max-w-72 text-stone-700">{ROLES[role].summary}</td>
                <td className="max-w-72">{top.length === areas.length ? "every area" : top.join(", ") || "—"}</td>
                <td className="max-w-56">{at(2)}</td>
                <td className="max-w-56">{at(1)}</td>
              </tr>
            );
          })}
        </Table>
        <p className="text-small mt-4 text-stone-700">Refunds need the administer level in payments (administrators and the accountant). VAT rates and settings need it in accounting and settings (administrators only). Everyone can manage their own two-factor sign-in.</p>
      </Card>
    </Page>
  );
}
