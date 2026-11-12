import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfirmationView } from "@/components/shop/OrderViews";
import { PageHeader } from "@/components/ui/Page";

export const metadata: Metadata = {
  title: "Order confirmation",
  robots: { index: false, follow: false },
};

export default function OrderConfirmationPage() {
  return (
    <>
      <PageHeader eyebrow="Orders" title="Your order" size="h1" />
      <section className="container-page pb-section">
        <Suspense fallback={<p className="text-lead py-20 text-stone-700">Loading your order…</p>}>
          <ConfirmationView />
        </Suspense>
      </section>
    </>
  );
}
