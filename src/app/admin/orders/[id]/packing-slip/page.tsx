import { notFound } from "next/navigation";
import { OrderDocument, type SlipShipment } from "@/components/admin/OrderDocument";
import { documentSettings, getOrder } from "@/server/admin";
import { adminCtx } from "@/server/adminSession";
import { afterShipment } from "@/server/stock";

export const metadata = { title: "Packing slip" };

/**
 * The slip for the whole order, or, with ?shipment=…, for one parcel: its own
 * lines, quantities and lots, and what is still to follow. An order sent in
 * two parcels gets two slips that between them list everything once.
 */
export default async function PackingSlipPage({ params, searchParams }: PageProps<"/admin/orders/[id]/packing-slip">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [order, settings] = await Promise.all([getOrder(ctx, id), documentSettings(ctx)]);

  const wanted = typeof query.shipment === "string" ? query.shipment : null;
  let shipment: SlipShipment | undefined;
  if (wanted) {
    const sent = order.shipments.filter((candidate) => candidate.status !== "CANCELLED");
    const found = sent.find((candidate) => candidate.id === wanted);
    if (!found) notFound();
    const after = afterShipment(order.items, sent, found.id);
    shipment = {
      index: after.index,
      of: after.total,
      carrier: found.carrier,
      trackingNumber: found.trackingNumber,
      shippedAt: found.shippedAt,
      weightGrams: found.parcels.reduce((sum, parcel) => sum + parcel.weightGrams, 0),
      lines: found.items.map((line) => ({ orderItemId: line.orderItemId, quantity: line.quantity, lotNumber: line.lotNumber })),
      stillToFollow: after.toFollow,
    };
  }
  return <OrderDocument kind="packing-slip" order={order} store={settings.store} shipment={shipment} />;
}
