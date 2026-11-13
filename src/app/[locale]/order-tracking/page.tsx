import type { Metadata } from "next";
import { TrackingView } from "@/components/shop/OrderViews";
import { PageHeader } from "@/components/ui/Page";
import { getI18n } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.tracking.metaTitle, robots: { index: false, follow: false } };
}

export default async function OrderTrackingPage() {
  const { m } = await getI18n();
  return (
    <>
      <PageHeader eyebrow={m.order.eyebrow} title={m.tracking.title} size="h1" />
      <section className="container-page pb-section">
        <TrackingView />
      </section>
    </>
  );
}
