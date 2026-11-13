import type { Metadata } from "next";
import { ShopView } from "@/components/shop/ShopView";
import { PageHeader } from "@/components/ui/Page";
import { getI18n } from "@/i18n/server";
import { getCatalogData } from "@/server/storefrontData";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.shop.searchMetaTitle, robots: { index: false, follow: true } };
}

export default async function SearchPage() {
  const { m, language } = await getI18n();
  const { items } = await getCatalogData(language);
  return (
    <>
      <PageHeader eyebrow={m.shop.searchEyebrow} title={m.shop.searchTitle} size="h1" lead={m.shop.searchLead} />
      <section className="container-page pb-section">
        <ShopView items={items} autoFocusSearch />
      </section>
    </>
  );
}
