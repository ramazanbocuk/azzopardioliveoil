import { OrderDocument } from "@/components/admin/OrderDocument";
import { documentSettings, getOrder } from "@/server/admin";
import { adminCtx } from "@/server/adminSession";

export const metadata = { title: "Packing slip" };

export default async function PackingSlipPage({ params }: PageProps<"/admin/orders/[id]/packing-slip">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [order, settings] = await Promise.all([getOrder(ctx, (await params).id), documentSettings(ctx)]);
  return <OrderDocument kind="packing-slip" order={order} store={settings.store} />;
}
