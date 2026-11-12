import type { Metadata } from "next";
import { ShopView } from "@/components/shop/ShopView";
import { PageHeader } from "@/components/ui/Page";
import { getCatalogData } from "@/server/storefrontData";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: true },
};

export default async function SearchPage() {
  const { items } = await getCatalogData();
  return (
    <>
      <PageHeader eyebrow="Search" title="Find a bottle" size="h1" lead="Type a name, a size, or the lot number printed on a label." />
      <section className="container-page pb-section">
        <ShopView items={items} autoFocusSearch />
      </section>
    </>
  );
}
