import type { Metadata } from "next";
import { CartView } from "@/components/shop/CartView";
import { PageHeader } from "@/components/ui/Page";

export const metadata: Metadata = {
  title: "Cart",
  robots: { index: false, follow: false },
};

export default function CartPage() {
  return (
    <>
      <PageHeader eyebrow="Cart" title="Your cart" size="h1" />
      <section className="container-page pb-section">
        <CartView />
      </section>
    </>
  );
}
