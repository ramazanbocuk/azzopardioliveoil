import type { Metadata } from "next";
import Link from "next/link";
import { ShopView } from "@/components/shop/ShopView";
import { PageHeader } from "@/components/ui/Page";
import { getCatalogData } from "@/server/storefrontData";

export const metadata: Metadata = {
  title: "Shop all",
  description: "Every bottle from Azzopardi Olive Oil, by size and by lot.",
  alternates: { canonical: "/shop" },
};

export default async function ShopPage() {
  const { categories, items } = await getCatalogData();
  return (
    <>
      <PageHeader eyebrow="Shop" title="Every bottle" lead="One oil, three sizes, each bottled by the lot. Search by name, size or lot number.">
        <ul className="mt-8 flex flex-wrap gap-x-8 gap-y-2">
          {categories.map((category) => (
            <li key={category.slug}>
              <Link href={`/shop/${category.slug}`} className="text-label link-underline inline-flex min-h-11 items-center">
                {category.name}
              </Link>
            </li>
          ))}
        </ul>
      </PageHeader>
      <section className="container-page pb-section">
        <ShopView items={items} />
      </section>
    </>
  );
}
