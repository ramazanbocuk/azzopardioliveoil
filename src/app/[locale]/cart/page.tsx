import type { Metadata } from "next";
import { CartView } from "@/components/shop/CartView";
import { PageHeader } from "@/components/ui/Page";
import { getI18n } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.cart.metaTitle, robots: { index: false, follow: false } };
}

export default async function CartPage() {
  const { m } = await getI18n();
  return (
    <>
      <PageHeader eyebrow={m.cart.eyebrow} title={m.cart.title} size="h1" />
      <section className="container-page pb-section">
        <CartView />
      </section>
    </>
  );
}
