import type { Metadata } from "next";
import { CheckoutView } from "@/components/shop/CheckoutView";
import { PageHeader } from "@/components/ui/Page";
import { shippingCountries } from "@/content/site";
import { getShippingCountries } from "@/server/storefrontData";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  // Delivery countries follow the shipping zones set in the admin panel; the built-in list is only a fallback for an empty database.
  const fromZones = await getShippingCountries();
  const countries = fromZones.length ? fromZones : [...shippingCountries];
  return (
    <>
      <PageHeader eyebrow="Checkout" title="Checkout" size="h1" />
      <section className="container-page pb-section">
        <CheckoutView countries={countries} />
      </section>
    </>
  );
}
