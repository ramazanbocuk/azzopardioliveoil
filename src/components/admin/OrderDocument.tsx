import type { Order, OrderItem } from "@/generated/prisma/client";
import { date, money } from "./ui";
import { PrintButton } from "./PrintButton";

type Store = Record<string, string | boolean | null>;

/**
 * Printable invoice or packing slip. Seller details come from Settings; a
 * missing value is printed as a visible gap rather than guessed, because an
 * invoice without the legal entity and VAT number is not a valid invoice.
 */
export function OrderDocument({ kind, order, store }: { kind: "invoice" | "packing-slip"; order: Order & { items: OrderItem[] }; store: Store }) {
  const invoice = kind === "invoice";
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
          <p className="text-stone-700">{date(order.paidAt ?? order.placedAt)}</p>
        </div>
      </header>

      <section className="mt-6">
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
          {order.items.map((item) => (
            <tr key={item.id} className="border-b border-ink/10">
              <td className="py-2.5">
                {item.productName} {item.variantLabel}
                <span className="block font-mono text-[0.75rem] text-stone-700">{item.sku}</span>
              </td>
              <td className="py-2.5 font-mono text-[0.8125rem]">{item.lotNumber ?? "—"}</td>
              <td className="py-2.5 text-right tabular-nums">{item.quantity}</td>
              {invoice && <td className="py-2.5 text-right tabular-nums">{money(item.unitPriceCents)}</td>}
              {invoice && <td className="py-2.5 text-right tabular-nums">{money(item.lineTotalCents)}</td>}
              {!invoice && <td className="py-2.5 text-right">☐</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {invoice && (
        <dl className="ml-auto mt-6 w-72 space-y-1.5">
          <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{money(order.subtotalCents)}</dd></div>
          {order.discountCents > 0 && <div className="flex justify-between"><dt>Discount</dt><dd className="tabular-nums">−{money(order.discountCents)}</dd></div>}
          <div className="flex justify-between"><dt>Shipping</dt><dd className="tabular-nums">{money(order.shippingCents)}</dd></div>
          <div className="flex justify-between border-t border-ink/30 pt-2 font-medium"><dt>Total paid</dt><dd className="tabular-nums">{money(order.totalCents)}</dd></div>
          <div className="flex justify-between text-stone-700">
            <dt>Of which VAT{order.taxRateBps !== null ? ` (${(order.taxRateBps / 100).toFixed(order.taxRateBps % 100 ? 2 : 0)}%)` : ""}</dt>
            <dd className="tabular-nums">{order.taxCents === null ? "[no VAT rate set]" : money(order.taxCents)}</dd>
          </div>
        </dl>
      )}

      {!invoice && <p className="mt-8 text-stone-700">Shipping: {order.shippingRateName} · Parcel weight about {(order.weightGrams / 1000).toFixed(1)} kg</p>}
    </div>
  );
}
