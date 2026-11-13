import type { Order, OrderItem } from "@/generated/prisma/client";
import { date, money } from "./ui";
import { PrintButton } from "./PrintButton";

type Store = Record<string, string | boolean | null>;
const rate = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

/**
 * Printable invoice or packing slip. Seller details come from Settings; a
 * missing value is printed as a visible gap rather than guessed, because an
 * invoice without the legal entity and VAT number is not a valid invoice.
 */
/** One parcel's contents, when the slip is for a single shipment rather than the whole order. */
export type SlipShipment = { index: number; of: number; carrier: string; trackingNumber: string | null; shippedAt: Date | null; weightGrams: number; lines: { orderItemId: string; quantity: number; lotNumber: string | null }[]; stillToFollow: { name: string; quantity: number }[] };

export function OrderDocument({ kind, order, store, shipment }: { kind: "invoice" | "packing-slip"; order: Order & { items: OrderItem[] }; store: Store; shipment?: SlipShipment }) {
  const invoice = kind === "invoice";
  // A slip for one shipment lists only what is in that parcel, with the lot each line was packed from.
  const rows = shipment
    ? shipment.lines.flatMap((line) => {
        const item = order.items.find((candidate) => candidate.id === line.orderItemId);
        return item ? [{ item, quantity: line.quantity, lot: line.lotNumber }] : [];
      })
    : order.items.map((item) => ({ item, quantity: item.quantity, lot: item.lotNumber }));
  const seller = (key: string, label: string) => (typeof store[key] === "string" && store[key] ? String(store[key]) : `[${label} — set in Settings]`);
  const incomplete = invoice && ["legalName", "address", "vatNumber"].some((key) => !store[key]);

  return (
    <div className="mx-auto max-w-[50rem] bg-white p-10 font-sans text-[0.9375rem] text-ink print:p-0">
      <div className="mb-8 flex items-center justify-between print:hidden">
        <p className="text-small text-stone-700">{invoice ? "Invoice" : "Packing slip"} preview</p>
        <PrintButton />
      </div>
      {incomplete && <p className="mb-6 border-l-2 border-terracotta-700 bg-terracotta-500/10 px-4 py-3 text-terracotta-700 print:hidden">Seller details are incomplete. Fill in the legal name, address and VAT number under Settings before sending this invoice to anyone.</p>}

      <header className="flex justify-between gap-8 border-b border-ink/20 pb-6">
        <div>
          <p className="font-serif text-[1.5rem] uppercase tracking-[0.2em]">Azzopardi</p>
          <p className="mt-3">{seller("legalName", "legal name")}</p>
          <p className="whitespace-pre-line text-stone-700">{seller("address", "registered address")}</p>
          {invoice && <p className="text-stone-700">VAT {seller("vatNumber", "VAT number")}</p>}
        </div>
        <div className="text-right">
          <h1 className="font-serif text-[1.75rem]">{invoice ? "Invoice" : "Packing slip"}</h1>
          <p className="mt-2 font-mono">{order.number}</p>
          {shipment && (
            <p className="font-medium">
              Shipment {shipment.index} of {shipment.of}
            </p>
          )}
          <p className="text-stone-700">{date(shipment?.shippedAt ?? order.paidAt ?? order.placedAt)}</p>
        </div>
      </header>

      <section className="mt-6 grid gap-8 sm:grid-cols-2">
        {invoice && (
          <div>
            <h2 className="text-label text-stone-700">Bill to</h2>
            <address className="mt-2 not-italic">
              {order.billCompany && <span className="block">{order.billCompany}</span>}
              {order.billFirstName} {order.billLastName}
              <span className="block">{order.billLine1}</span>
              {order.billLine2 && <span className="block">{order.billLine2}</span>}
              <span className="block">
                {order.billPostalCode} {order.billCity}
              </span>
              <span className="block">{order.billCountryCode}</span>
              {order.billVatNumber && <span className="block">VAT {order.billVatNumber}</span>}
            </address>
          </div>
        )}
        <div>
          <h2 className="text-label text-stone-700">Deliver to</h2>
          <address className="mt-2 not-italic">
            {order.shipFirstName} {order.shipLastName}
            <span className="block">{order.shipLine1}</span>
            {order.shipLine2 && <span className="block">{order.shipLine2}</span>}
            <span className="block">
              {order.shipPostalCode} {order.shipCity}
            </span>
            <span className="block">{order.shipCountryCode}</span>
          </address>
          {!invoice && order.customerNote && <p className="mt-3">Note: {order.customerNote}</p>}
        </div>
      </section>

      <table className="mt-8 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-ink/30">
            <th scope="col" className="py-2 font-medium">Item</th>
            <th scope="col" className="py-2 font-medium">Lot</th>
            <th scope="col" className="py-2 text-right font-medium">Qty</th>
            {invoice && <th scope="col" className="py-2 text-right font-medium">Unit</th>}
            {invoice && <th scope="col" className="py-2 text-right font-medium">Amount</th>}
            {!invoice && <th scope="col" className="py-2 text-right font-medium">Packed</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ item, quantity, lot }) => (
            <tr key={item.id} className="border-b border-ink/10">
              <td className="py-2.5">
                {item.productName} {item.variantLabel}
                <span className="block font-mono text-[0.75rem] text-stone-700">{item.sku}</span>
              </td>
              <td className="py-2.5 font-mono text-[0.8125rem]">{lot ?? "—"}</td>
              <td className="py-2.5 text-right tabular-nums">{quantity}</td>
              {invoice && <td className="py-2.5 text-right tabular-nums">{money(item.unitPriceCents)}</td>}
              {invoice && <td className="py-2.5 text-right tabular-nums">{money(item.lineTotalCents)}</td>}
              {!invoice && <td className="py-2.5 text-right">☐</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {invoice && (
        <dl className="ml-auto mt-6 w-80 space-y-1.5">
          <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{money(order.subtotalCents)}</dd></div>
          {order.discountCents > 0 && <div className="flex justify-between"><dt>Discount</dt><dd className="tabular-nums">−{money(order.discountCents)}</dd></div>}
          <div className="flex justify-between"><dt>Shipping</dt><dd className="tabular-nums">{money(order.shippingCents)}</dd></div>
          <div className="flex justify-between border-t border-ink/30 pt-2 font-medium"><dt>Total paid</dt><dd className="tabular-nums">{money(order.totalCents)}</dd></div>
          {order.taxCents === null || order.taxRateBps === null ? (
            <div className="flex justify-between text-stone-700"><dt>VAT</dt><dd>[no VAT rate set]</dd></div>
          ) : (
            <div className="space-y-1 pt-1 text-stone-700">
              <div className="flex justify-between"><dt>Total excluding VAT</dt><dd className="tabular-nums">{money(order.totalCents - order.taxCents)}</dd></div>
              <div className="flex justify-between"><dt>VAT {rate(order.taxRateBps)} on goods</dt><dd className="tabular-nums">{money(order.taxCents - (order.shippingTaxCents ?? 0))}</dd></div>
              <div className="flex justify-between"><dt>VAT {rate(order.taxRateBps)} on shipping</dt><dd className="tabular-nums">{order.shippingTaxCents === null ? "—" : money(order.shippingTaxCents)}</dd></div>
              <div className="flex justify-between"><dt>VAT total</dt><dd className="tabular-nums">{money(order.taxCents)}</dd></div>
            </div>
          )}
        </dl>
      )}

      {!invoice && shipment && shipment.stillToFollow.length > 0 && (
        <div className="mt-8 border border-ink/20 p-4">
          <p className="font-medium">Not in this parcel — to follow separately</p>
          <ul className="mt-2">
            {shipment.stillToFollow.map((line) => (
              <li key={line.name}>
                {line.quantity} × {line.name}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!invoice && shipment && shipment.stillToFollow.length === 0 && shipment.of > 1 && <p className="mt-8">This parcel completes the order.</p>}
      {!invoice && (
        <p className="mt-8 text-stone-700">
          Shipping: {shipment ? `${shipment.carrier}${shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ""}` : order.shippingRateName} · Parcel weight about {((shipment?.weightGrams ?? order.weightGrams) / 1000).toFixed(1)} kg
        </p>
      )}
    </div>
  );
}
