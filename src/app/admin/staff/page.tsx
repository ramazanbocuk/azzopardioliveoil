import { Badge, Card, Field, Flash, Page, Select, Submit, Table, dateTime } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth";
import { adminCtx } from "@/server/adminSession";
import { createStaff, setStaffActive, setStaffRole } from "../actions";

export const metadata = { title: "Staff" };

const ROLES = ["ADMINISTRATOR", "MANAGER", "STAFF"] as const;

export default async function StaffPage({ searchParams }: PageProps<"/admin/staff">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  requireAdmin(ctx);
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
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role.toLowerCase()}
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
          <Select label="Role" name="role" defaultValue="STAFF">
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role.toLowerCase()}
              </option>
            ))}
          </Select>
          <Field label="Temporary password" name="password" type="password" required minLength={12} autoComplete="new-password" hint="At least 12 characters." />
          <Submit>Create</Submit>
        </form>
      </Card>
      <Card title="What each role can do" description="Checked on the server for every action, whichever screen it comes from.">
        <Table head={["Area", "Staff", "Manager", "Administrator"]}>
          {[
            ["See orders, customers, stock, shipments, reports screens", "Yes", "Yes", "Yes"],
            ["Process, pack and ship orders; book and print labels; add notes; record lots", "Yes", "Yes", "Yes"],
            ["Own two-factor sign-in and own sessions", "Yes", "Yes", "Yes"],
            ["Products, prices, stock changes, lots, suppliers, discounts, shipping rates", "No", "Yes", "Yes"],
            ["Cancel unpaid orders and carrier bookings; handle returns; moderate reviews", "No", "Yes", "Yes"],
            ["Sales and VAT reports, CSV exports, lot recall list", "No", "Yes", "Yes"],
            ["Wholesale terms, journal articles", "No", "Yes", "Yes"],
            ["Refunds", "No", "No", "Yes"],
            ["VAT rates, store and shipping settings, announcement, notifications", "No", "No", "Yes"],
            ["Staff accounts and roles; reset another person’s two-factor; end anyone’s session", "No", "No", "Yes"],
            ["Erase a customer’s personal data", "No", "No", "Yes"],
          ].map(([area, staff, manager, administrator]) => (
            <tr key={area}>
              <td>{area}</td>
              {[staff, manager, administrator].map((allowed, index) => (
                <td key={index} className={allowed === "Yes" ? "text-olive-700" : "text-stone-700"}>
                  {allowed}
                </td>
              ))}
            </tr>
          ))}
        </Table>
        <p className="text-small mt-4 text-stone-700">Roles are fixed: permissions cannot be customised per person.</p>
      </Card>
    </Page>
  );
}
