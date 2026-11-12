import Link from "next/link";
import { Badge, Card, Field, Flash, LinkButton, Page, Stat, Submit, Table, cellLink, date } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { traceLot } from "@/server/backoffice";

export const metadata = { title: "Food traceability" };

export default async function TraceabilityPage({ searchParams }: PageProps<"/admin/traceability">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const params = await searchParams;
  const lot = typeof params.lot === "string" ? params.lot : "";
  const [trace, lots] = await Promise.all([traceLot(ctx, lot), ctx.db.batch.findMany({ orderBy: { createdAt: "desc" }, take: 40, include: { product: { select: { name: true } }, supplier: { select: { name: true } } } })]);

  return (
    <Page title="Food traceability" eyebrow="One step back, one step forward" actions={<LinkButton href="/admin/lots">Manage lots</LinkButton>}>
      <Flash params={params} />
      <Card title="Trace a lot" description="Find every order that received bottles from a lot: the list needed to withdraw or recall it. It relies on staff recording the lot on each order line when packing.">
        <form className="flex flex-wrap items-end gap-4">
          <Field label="Lot number" name="lot" defaultValue={lot} placeholder="AZ-0001" required className="w-64" />
          <Submit>Trace</Submit>
        </form>
      </Card>

      {trace && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Orders that received this lot" value={String(trace.orders)} />
            <Stat label="Units sold from it" value={String(trace.units)} />
            <Stat label="Shipped lines with no lot recorded" value={String(trace.shippedLinesWithoutLot)} note={trace.shippedLinesWithoutLot ? "Across all orders. Any of these could also be from this lot." : "Every shipped line has a lot."} />
          </div>
          <Card title={`Lot ${trace.lotNumber}`} description="One step back: where it came from.">
            {trace.batch ? (
              <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ["Product", trace.batch.product.name],
                  ["Supplier", trace.batch.supplier ? `${trace.batch.supplier.name} (${trace.batch.supplier.kind})` : "Not recorded"],
                  ["Supplier contact", trace.batch.supplier ? [trace.batch.supplier.contactName, trace.batch.supplier.phone, trace.batch.supplier.email].filter(Boolean).join(" · ") || "Not recorded" : "—"],
                  ["Grove", trace.batch.grove ?? "Not recorded"],
                  ["Mill", trace.batch.mill ?? "Not recorded"],
                  ["Harvest", date(trace.batch.harvestDate)],
                  ["Milled", date(trace.batch.milledAt)],
                  ["Bottled", date(trace.batch.bottledAt)],
                  ["Best before", date(trace.batch.bestBefore)],
                  ["Documents on file", String(trace.batch.documents.length)],
                  ["Shown to customers", trace.batch.isPublished ? "Yes" : "No"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-small text-stone-700">{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p role="alert" className="text-terracotta-700">
                No lot with this number is on record. Orders below, if any, carry the number but its origin was never entered.
              </p>
            )}
          </Card>
          <Card title="Who received it" description="One step forward." >
            <div className="mb-4">
              <LinkButton href={`/admin/export/lot?lot=${encodeURIComponent(trace.lotNumber)}`}>Export contact list (CSV)</LinkButton>
            </div>
            <Table head={["Order", "Paid", "Customer", "Destination", "Product", "Units", "Status", "Shipment"]} empty={trace.lines.length === 0 ? "No order line carries this lot number." : undefined}>
              {trace.lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <Link href={`/admin/orders/${line.order.id}`} className={cellLink}>
                      {line.order.number}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap">{date(line.order.paidAt)}</td>
                  <td>
                    {line.order.shipFirstName} {line.order.shipLastName}
                    <span className="text-small block text-stone-700">
                      {line.order.email}
                      {line.order.shipPhone ? ` · ${line.order.shipPhone}` : ""}
                    </span>
                  </td>
                  <td>
                    {line.order.shipCity}, {line.order.shipCountryCode}
                  </td>
                  <td>
                    {line.productName} {line.variantLabel}
                  </td>
                  <td className="tabular-nums">{line.quantity}</td>
                  <td>
                    <Badge>{line.order.status}</Badge>
                  </td>
                  <td className="text-small">{line.order.shipments.map((shipment) => `${shipment.carrier} ${shipment.trackingNumber ?? ""}`).join("; ") || "—"}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}

      <Card title="Lots on record">
        <Table head={["Lot", "Product", "Supplier", "Harvest", "Best before", "Public"]} empty={lots.length === 0 ? "No lots yet. Create one under Manage lots." : undefined}>
          {lots.map((batch) => (
            <tr key={batch.id}>
              <td>
                <Link href={`/admin/traceability?lot=${batch.lotNumber}`} className={`${cellLink} font-mono`}>
                  {batch.lotNumber}
                </Link>
              </td>
              <td>{batch.product.name}</td>
              <td>{batch.supplier?.name ?? "—"}</td>
              <td>{date(batch.harvestDate)}</td>
              <td>{date(batch.bestBefore)}</td>
              <td>{batch.isPublished ? "Yes" : "No"}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
