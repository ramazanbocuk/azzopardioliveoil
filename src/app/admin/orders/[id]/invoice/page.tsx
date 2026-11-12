import { OrderDocument } from "@/components/admin/OrderDocument";
import { getOrder, getSettings } from "@/server/admin";
import { adminCtx } from "@/server/adminSession";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: PageProps<"/admin/orders/[id]/invoice">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [order, settings] = await Promise.all([getOrder(ctx, (await params).id), getSettings(ctx)]);
  return <OrderDocument kind="invoice" order={order} store={settings.store} />;
}
