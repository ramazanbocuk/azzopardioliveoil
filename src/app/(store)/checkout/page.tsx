import type { Metadata } from "next";
import { CheckoutView } from "@/components/shop/CheckoutView";
import { PageHeader } from "@/components/ui/Page";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return (
    <>
      <PageHeader eyebrow="Checkout" title="Checkout" size="h1" />
      <section className="container-page pb-section">
        <CheckoutView />
      </section>
    </>
  );
}
