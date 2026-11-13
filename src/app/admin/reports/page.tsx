import { Card, Field, Flash, LinkButton, Page, Select, Stat, Submit, Table, money as format } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { salesReport } from "@/server/backoffice";

export const metadata = { title: "Analytics & reports" };

export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const params = await searchParams;
  const value = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const report = await salesReport(ctx, { from: value("from"), to: value("to"), currency: value("currency") });
  const money = (cents: number | null | undefined) => format(cents, report.currency);
  const peak = Math.max(1, ...report.daily.map((day) => day.grossCents));
  const range = `from=${report.range.fromText}&to=${report.range.toText}`;

  return (
    <Page title="Analytics & reports" eyebrow={`${report.range.fromText} to ${report.range.toText}`} actions={<LinkButton href={`/admin/export/sales?${range}`}>Export (CSV)</LinkButton>}>
      <Flash params={params} />
      <Card>
        <form className="flex flex-wrap items-end gap-4">
          <Field label="From" name="from" type="date" defaultValue={report.range.fromText} />
          {report.currencies.length > 1 && (
            <Select label="Currency" name="currency" defaultValue={report.currency}>
              {report.currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          )}
          <Field label="To" name="to" type="date" defaultValue={report.range.toText} />
          <Submit variant="secondary">Show</Submit>
          <p className="text-small text-stone-700">Orders are counted on the day they were paid. Amounts include VAT unless stated.</p>
        </form>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Paid orders" value={String(report.orders)} note={`${report.firstTimeOrders} first-time, ${report.returningOrders} returning`} />
        <Stat label="Sales" value={money(report.grossCents)} note={`${money(report.netCents)} excluding VAT`} />
        <Stat label="Average order" value={money(report.averageOrderCents)} note={`${report.units} units sold`} />
        <Stat label="Refunds issued" value={money(report.refundedCents)} note={`${report.refundCount} in this period, by refund date`} />
        <Stat label="Shipping charged" value={money(report.shippingCents)} />
        <Stat label="Discounts given" value={money(report.discountCents)} />
        <Stat label="VAT collected" value={money(report.taxCents)} note={report.ordersWithoutVat ? `${report.ordersWithoutVat} order(s) had no VAT rate set` : undefined} />
        <Stat label="Sales less refunds" value={money(report.grossCents - report.refundedCents)} />
      </div>

      <Card title="Sales by day">
        {report.daily.length === 0 ? (
          <p className="py-6 text-center text-stone-700">No paid orders in this period.</p>
        ) : (
          <Table head={["Day", "Orders", "Sales", ""]}>
            {report.daily.map((day) => (
              <tr key={day.day}>
                <td className="whitespace-nowrap">{day.day}</td>
                <td className="tabular-nums">{day.orders}</td>
                <td className="tabular-nums">{money(day.grossCents)}</td>
                <td className="w-1/2">
                  <span className="block h-2 bg-olive-700" style={{ width: `${Math.max(1, Math.round((day.grossCents / peak) * 100))}%` }} aria-hidden="true" />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <div className="grid gap-8 xl:grid-cols-2">
        <Card title="Best sellers">
          <Table head={["Product", "SKU", "Units", "Sales"]} empty={report.products.length === 0 ? "Nothing sold in this period." : undefined}>
            {report.products.map((row) => (
              <tr key={row.sku}>
                <td>{row.name}</td>
                <td className="font-mono text-[0.8125rem]">{row.sku}</td>
                <td className="tabular-nums">{row.units}</td>
                <td className="tabular-nums">{money(row.grossCents)}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <div className="space-y-8">
          <Card title="By destination">
            <Table head={["Country", "Orders", "Sales", "Share"]} empty={report.countries.length === 0 ? "No orders in this period." : undefined}>
              {report.countries.map((row) => (
                <tr key={row.country}>
                  <td>{row.country}</td>
                  <td className="tabular-nums">{row.orders}</td>
                  <td className="tabular-nums">{money(row.grossCents)}</td>
                  <td className="tabular-nums">{report.grossCents ? `${Math.round((row.grossCents / report.grossCents) * 100)}%` : "—"}</td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="By payment method">
            <Table head={["Method", "Payments", "Amount"]} empty={report.methods.length === 0 ? "No payments in this period." : undefined}>
              {report.methods.map((row) => (
                <tr key={row.method}>
                  <td>{row.method}</td>
                  <td className="tabular-nums">{row.payments}</td>
                  <td className="tabular-nums">{money(row.amountCents)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      </div>
    </Page>
  );
}
