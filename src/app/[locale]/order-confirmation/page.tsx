import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfirmationView } from "@/components/shop/OrderViews";
import { PageHeader } from "@/components/ui/Page";
import { getI18n } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.order.metaTitle, robots: { index: false, follow: false } };
}

export default async function OrderConfirmationPage() {
  const { m } = await getI18n();
  return (
    <>
      <PageHeader eyebrow={m.order.eyebrow} title={m.order.title} size="h1" />
      <section className="container-page pb-section">
        <Suspense fallback={<p className="text-lead py-20 text-stone-700">{m.order.loading}</p>}>
          <ConfirmationView />
        </Suspense>
      </section>
    </>
  );
}
