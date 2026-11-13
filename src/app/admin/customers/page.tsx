import Link from "next/link";
import { Badge, Card, Field, Flash, LinkButton, Page, Select, Submit, Table, cellLink, date, money } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { SEGMENTS, customerDirectory } from "@/server/backoffice";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const params = await searchParams;
  const value = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const directory = await customerDirectory(ctx, { q: value("q"), segment: value("segment"), tag: value("tag") });

  return (
    <Page title="Customers" eyebrow={`${directory.matched} account${directory.matched === 1 ? "" : "s"}${directory.matched > directory.rows.length ? `, first ${directory.rows.length} shown` : ""}`} actions={<LinkButton href="/admin/export/customers">Export (CSV)</LinkButton>}>
      <Flash params={params} />
      <Card>
        <form className="flex flex-wrap items-end gap-4">
          <Field label="Search" name="q" defaultValue={value("q")} placeholder="Name, email or company" className="min-w-64 flex-1" />
          <Select label="Segment" name="segment" defaultValue={directory.segment} className="w-72">
            {Object.entries(SEGMENTS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
          <Select label="Tag" name="tag" defaultValue={value("tag")} className="w-48">
            <option value="">Any tag</option>
            {directory.tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </Select>
          <Submit variant="secondary">Show</Submit>
        </form>
      </Card>
      <Card description="Customer accounts. People who checked out as guests have no account and appear on their orders only.">
        <Table head={["Customer", "Tags", "Paid orders", "Spent", "Average order", "Last order", "Marketing", "Joined"]} empty={directory.rows.length === 0 ? "No customer accounts match." : undefined}>
          {directory.rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link href={`/admin/customers/${row.id}`} className={cellLink}>
                  {row.name}
                </Link>
                <span className="text-small block text-stone-700">
                  {row.email}
                  {row.companyName ? ` · ${row.companyName}` : ""}
                </span>
              </td>
              <td>
                <span className="flex flex-wrap gap-1">
                  {row.wholesale && <Badge tone="PAID">WHOLESALE</Badge>}
                  {row.paidOrders >= 2 && <Badge tone="PROCESSING">REPEAT</Badge>}
                  {row.tags.map((tag) => (
                    <Badge key={tag} tone={tag === "VIP" ? "UNPAID" : undefined}>
                      {tag}
                    </Badge>
                  ))}
                </span>
              </td>
              <td className="tabular-nums">{row.paidOrders}</td>
              <td className="tabular-nums">
                {money(row.spentCents)}
                {row.otherSpend && <span className="text-small block text-stone-700">+ {row.otherSpend}</span>}
              </td>
              <td className="tabular-nums">{row.paidOrders ? money(row.averageCents) : "—"}</td>
              <td className="whitespace-nowrap">{date(row.lastOrderAt)}</td>
              <td>{row.marketingOptIn ? "Agreed" : "No"}</td>
              <td className="whitespace-nowrap">{date(row.createdAt)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
