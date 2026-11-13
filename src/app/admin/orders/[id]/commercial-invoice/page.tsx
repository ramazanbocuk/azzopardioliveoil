import { PrintButton } from "@/components/admin/PrintButton";
import { date } from "@/components/admin/ui";
import { documentSettings, getOrder } from "@/server/admin";
import { adminCtx } from "@/server/adminSession";

export const metadata = { title: "Commercial invoice" };

const amount = (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`;
const kilos = (grams: number) => `${(grams / 1000).toFixed(3)} kg`;

/**
 * Commercial invoice for customs, for parcels leaving the EU. It states what
 * the goods are, where they were made and what the buyer paid for them.
 * Values are the goods only, after discount: shipping is shown separately.
 * A missing fact is printed as a visible gap, never guessed.
 */
export default async function CommercialInvoicePage({ params }: PageProps<"/admin/orders/[id]/commercial-invoice">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [order, { store, shipping }] = await Promise.all([getOrder(ctx, (await params).id), documentSettings(ctx)]);
  const text = (source: Record<string, string | boolean | null>, key: string, label: string) => (typeof source[key] === "string" && source[key] ? String(source[key]) : `[${label} — set in Settings]`);
  const goods = order.subtotalCents || 1;
  const lines = order.items.map((item) => {
    const unit = Math.round((item.unitPriceCents * (goods - order.discountCents)) / goods);
    return { item, unit, total: unit * item.quantity, weight: item.weightGrams * item.quantity };
  });
  const value = lines.reduce((sum, line) => sum + line.total, 0);
  const weight = lines.reduce((sum, line) => sum + line.weight, 0);
  const missing = order.items.filter((item) => !item.hsCode || !item.originCountry).length;

  return (
    <div className="mx-auto max-w-[52rem] bg-white p-10 font-sans text-[0.875rem] text-ink print:p-0">
      <div className="mb-8 flex items-center justify-between print:hidden">
        <p className="text-small text-stone-700">Commercial invoice preview. Print three copies: one inside the parcel, two in the pouch on the outside.</p>
        <PrintButton />
      </div>
      {missing > 0 && (
        <p className="mb-6 border-l-2 border-terracotta-700 bg-terracotta-500/10 px-4 py-3 text-terracotta-700 print:hidden">
          {missing} line(s) have no customs (HS) code or country of origin. Customs will not accept this document until every line has both. Add them under Products; they are copied onto new orders.
        </p>
      )}

      <header className="flex justify-between gap-8 border-b border-ink/30 pb-5">
        <h1 className="font-serif text-[1.75rem]">Commercial invoice</h1>
        <dl className="text-right">
          <div>
            <dt className="inline text-stone-700">Invoice number </dt>
            <dd className="inline font-mono">{order.number}</dd>
          </div>
          <div>
            <dt className="inline text-stone-700">Date </dt>
            <dd className="inline">{date(order.paidAt ?? order.placedAt)}</dd>
          </div>
        </dl>
      </header>

      <section className="mt-5 grid grid-cols-2 gap-8">
        <div>
          <h2 className="text-label text-stone-700">Seller / exporter</h2>
          <p className="mt-2">{text(store, "legalName", "legal name")}</p>
          <p>{text(shipping, "senderLine1", "street")}</p>
          <p>
            {text(shipping, "senderPostalCode", "postal code")} {text(shipping, "senderCity", "city")}
          </p>
          <p>{text(shipping, "senderCountryCode", "country")}</p>
          <p>VAT {text(store, "vatNumber", "VAT number")}</p>
          <p>EORI [EORI number — required to export from the EU]</p>
          <p>{text(shipping, "senderPhone", "phone")}</p>
        </div>
        <div>
          <h2 className="text-label text-stone-700">Buyer / consignee</h2>
          <p className="mt-2">
            {order.shipFirstName} {order.shipLastName}
          </p>
          <p>{order.shipLine1}</p>
          {order.shipLine2 && <p>{order.shipLine2}</p>}
          <p>
            {order.shipPostalCode} {order.shipCity}
          </p>
          {order.shipRegion && <p>{order.shipRegion}</p>}
          <p>{order.shipCountryCode}</p>
          {order.shipPhone && <p>{order.shipPhone}</p>}
          <p>{order.email}</p>
          {order.billCompany && (
            <p className="mt-2">
              Invoiced to: {order.billCompany}
              {order.billVatNumber ? `, VAT ${order.billVatNumber}` : ""}
            </p>
          )}
        </div>
      </section>

      <table className="mt-7 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-ink/40">
            {["Description of goods", "HS code", "Origin", "Qty", "Unit value", "Total value", "Net weight"].map((head, index) => (
              <th key={head} scope="col" className={`py-2 font-medium ${index > 2 ? "text-right" : ""}`}>
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map(({ item, unit, total, weight: lineWeight }) => (
            <tr key={item.id} className="border-b border-ink/10">
              <td className="py-2">
                {item.productName} {item.variantLabel}
                <span className="block font-mono text-[0.6875rem] text-stone-700">{item.sku}</span>
              </td>
              <td className="py-2 font-mono">{item.hsCode ?? "[missing]"}</td>
              <td className="py-2">{item.originCountry ?? "[missing]"}</td>
              <td className="py-2 text-right tabular-nums">{item.quantity}</td>
              <td className="py-2 text-right tabular-nums">{amount(unit, order.currency)}</td>
              <td className="py-2 text-right tabular-nums">{amount(total, order.currency)}</td>
              <td className="py-2 text-right tabular-nums">{lineWeight ? kilos(lineWeight) : "[missing]"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto mt-5 w-80 space-y-1">
        <div className="flex justify-between"><dt>Total value of goods</dt><dd className="tabular-nums">{amount(value, order.currency)}</dd></div>
        <div className="flex justify-between"><dt>Shipping charged</dt><dd className="tabular-nums">{amount(order.shippingCents, order.currency)}</dd></div>
        <div className="flex justify-between border-t border-ink/30 pt-1 font-medium"><dt>Invoice total</dt><dd className="tabular-nums">{amount(value + order.shippingCents, order.currency)}</dd></div>
        <div className="flex justify-between text-stone-700"><dt>Total net weight</dt><dd className="tabular-nums">{weight ? kilos(weight) : "[missing]"}</dd></div>
      </dl>

      <section className="mt-7 grid grid-cols-2 gap-8">
        <dl className="space-y-1">
          <div><dt className="inline text-stone-700">Reason for export: </dt><dd className="inline">Sale of goods</dd></div>
          <div><dt className="inline text-stone-700">Terms of delivery (Incoterm): </dt><dd className="inline">DAP — duties and taxes payable by the recipient</dd></div>
          <div><dt className="inline text-stone-700">Currency: </dt><dd className="inline">{order.currency}</dd></div>
          <div><dt className="inline text-stone-700">Carrier and tracking: </dt><dd className="inline">{order.shipments.filter((shipment) => !shipment.cancelledAt).map((shipment) => `${shipment.carrier} ${shipment.trackingNumber ?? ""}`).join("; ") || "to be assigned"}</dd></div>
        </dl>
        <div>
          <p>I declare that the information on this invoice is true and correct and that the contents of this shipment are as stated above.</p>
          <p className="mt-10 border-t border-ink/40 pt-1 text-stone-700">Name, signature and date</p>
        </div>
      </section>
      <p className="mt-6 text-[0.75rem] text-stone-700 print:hidden">Values exclude EU VAT only if your accountant has confirmed the sale is zero-rated for export; this document prints what the customer paid. Food products may need additional import documents in the destination country.</p>
    </div>
  );
}
