import Link from "next/link";
import { Card, Field, Flash, LinkButton, Page, Stat, Submit, Table, cellLink, date, money } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { vatReport } from "@/server/backoffice";

export const metadata = { title: "Accounting & VAT" };

const rate = (bps: number | null) => (bps === null ? "no rate set" : `${(bps / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`);

export default async function AccountingPage({ searchParams }: PageProps<"/admin/accounting">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const params = await searchParams;
  const value = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const report = await vatReport(ctx, { from: value("from"), to: value("to") });
  const range = `from=${report.range.fromText}&to=${report.range.toText}`;

  return (
    <Page
      title="Accounting & VAT"
      eyebrow={`${report.range.fromText} to ${report.range.toText}`}
      actions={
        <>
          <LinkButton href={`/admin/export/vat?${range}`}>VAT report (CSV)</LinkButton>
          <LinkButton href={`/admin/export/orders?${range}`}>Orders (CSV)</LinkButton>
          <LinkButton href="/admin/shipping">VAT rates</LinkButton>
        </>
      }
    >
      <Flash params={params} />
      <p className="border-l-2 border-gold-700 bg-gold-300/20 px-4 py-3">
        These are working figures from the shop’s own records, for your accountant. They are not a VAT return: which country’s VAT applies to each sale, and how refunds adjust it, must be confirmed by a professional.
      </p>
      <Card>
        <form className="flex flex-wrap items-end gap-4">
          <Field label="From" name="from" type="date" defaultValue={report.range.fromText} />
          <Field label="To" name="to" type="date" defaultValue={report.range.toText} />
          <Submit variant="secondary">Show</Submit>
          <p className="text-small text-stone-700">Orders are counted on the day they were paid.</p>
        </form>
      </Card>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Sales excluding VAT" value={money(report.netCents)} />
        <Stat label="VAT collected" value={money(report.taxCents)} />
        <Stat label="Sales including VAT" value={money(report.grossCents)} />
        <Stat label="Refunds in period" value={money(report.refundedCents)} note="Not deducted from the figures above." />
      </div>

      {report.ordersWithoutRate > 0 && (
        <p role="alert" className="border-l-2 border-terracotta-700 bg-terracotta-500/10 px-4 py-3 text-terracotta-700">
          {report.ordersWithoutRate} paid order(s) in this period had no VAT rate for their destination, so no VAT was recorded on them. Set the rate under VAT rates; it applies to new orders only.
        </p>
      )}

      <Card title="VAT by destination and rate" description="Shipping is included in each row at the same rate as the goods.">
        <Table head={["Country", "VAT rate", "Orders", "Excluding VAT", "VAT", "Including VAT", "Of which VAT on shipping"]} empty={report.lines.length === 0 ? "No paid orders in this period." : undefined}>
          {report.lines.map((line) => (
            <tr key={`${line.country}-${line.rateBps}`}>
              <td>{line.country}</td>
              <td>{rate(line.rateBps)}</td>
              <td className="tabular-nums">{line.orders}</td>
              <td className="tabular-nums">{money(line.netCents)}</td>
              <td className="tabular-nums">{money(line.taxCents)}</td>
              <td className="tabular-nums">{money(line.grossCents)}</td>
              <td className="tabular-nums">{money(line.shippingTaxCents)}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Refunds in this period" description="Listed by the date the refund was issued. No credit note is generated yet.">
        <Table head={["Date", "Order", "Country", "VAT rate", "Amount"]} empty={report.refunds.length === 0 ? "No refunds in this period." : undefined}>
          {report.refunds.map((refund) => (
            <tr key={refund.id}>
              <td className="whitespace-nowrap">{date(refund.at)}</td>
              <td>
                <Link href={`/admin/orders/${refund.orderId}`} className={cellLink}>
                  {refund.number}
                </Link>
              </td>
              <td>{refund.country}</td>
              <td>{rate(refund.rateBps)}</td>
              <td className="tabular-nums">{money(refund.amountCents)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
