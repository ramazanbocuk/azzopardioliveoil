import type { Metadata } from "next";
import { CheckoutView } from "@/components/shop/CheckoutView";
import { PageHeader } from "@/components/ui/Page";
import { shippingCountries } from "@/content/site";
import { getI18n } from "@/i18n/server";
import { getShippingCountries } from "@/server/storefrontData";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.checkout.metaTitle, robots: { index: false, follow: false } };
}

export default async function CheckoutPage() {
  const { m } = await getI18n();
  // Delivery countries follow the shipping zones set in the admin panel; the built-in list is only a fallback for an empty database.
  const fromZones = await getShippingCountries();
  const countries = fromZones.length ? fromZones : [...shippingCountries];
  return (
    <>
      <PageHeader eyebrow={m.checkout.title} title={m.checkout.title} size="h1" />
      <section className="container-page pb-section">
        <CheckoutView countries={countries} />
      </section>
    </>
  );
}
