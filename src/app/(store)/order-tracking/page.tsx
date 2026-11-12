import type { Metadata } from "next";
import { TrackingView } from "@/components/shop/OrderViews";
import { PageHeader } from "@/components/ui/Page";

export const metadata: Metadata = {
  title: "Order tracking",
  robots: { index: false, follow: false },
};

export default function OrderTrackingPage() {
  return (
    <>
      <PageHeader eyebrow="Orders" title="Track an order" size="h1" />
      <section className="container-page pb-section">
        <TrackingView />
      </section>
    </>
  );
}
