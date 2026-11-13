import type { Metadata } from "next";
import { ShopView } from "@/components/shop/ShopView";
import { Link } from "@/components/ui/Link";
import { PageHeader } from "@/components/ui/Page";
import { alternatesFor } from "@/i18n/seo";
import { getI18n } from "@/i18n/server";
import { getCatalogData } from "@/server/storefrontData";

export async function generateMetadata(): Promise<Metadata> {
  const { m, locale } = await getI18n();
  return { title: m.shop.metaTitle, description: m.shop.metaDescription, alternates: alternatesFor(locale, "/shop") };
}

export default async function ShopPage() {
  const { m, language } = await getI18n();
  const { categories, items } = await getCatalogData(language);
  return (
    <>
      <PageHeader eyebrow={m.shop.eyebrow} title={m.shop.title} lead={m.shop.lead}>
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
