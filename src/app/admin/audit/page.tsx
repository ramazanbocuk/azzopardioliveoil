import { Card, Page, Table, dateTime } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth";
import { adminCtx } from "@/server/adminSession";

export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  requireAdmin(ctx, "MANAGER");
  const [rows, staff] = await Promise.all([ctx.db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 }), ctx.db.adminUser.findMany({ select: { id: true, name: true } })]);
  const who = (row: (typeof rows)[number]) => (row.actorType === "admin" ? (staff.find((s) => s.id === row.actorId)?.name ?? "Former staff") : row.actorType);

  return (
    <Page title="Audit log" eyebrow="Last 200 actions">
      <Card>
        <Table head={["When", "Who", "Action", "Record", "Details"]} empty={rows.length === 0 ? "Nothing recorded yet." : undefined}>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="whitespace-nowrap">{dateTime(row.createdAt)}</td>
              <td>{who(row)}</td>
              <td className="font-mono text-[0.8125rem]">{row.action}</td>
              <td>{row.entity}</td>
              <td className="max-w-md truncate font-mono text-[0.75rem] text-stone-700">{row.data ? JSON.stringify(row.data) : ""}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
