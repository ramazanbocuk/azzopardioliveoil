import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ShopView } from "@/components/shop/ShopView";
import { PageHeader } from "@/components/ui/Page";
import type { Language } from "@/i18n/config";
import { alternatesFor } from "@/i18n/seo";
import { getI18n } from "@/i18n/server";
import { getCatalogData } from "@/server/storefrontData";

export async function generateStaticParams() {
  const { categories } = await getCatalogData();
  return categories.map((category) => ({ category: category.slug }));
}

export async function generateMetadata({ params }: PageProps<"/[locale]/shop/[category]">): Promise<Metadata> {
  const slug = (await params).category;
  const { locale, language } = await getI18n();
  const category = (await getCatalogData(language)).categories.find((c) => c.slug === slug);
  if (!category) return {};
  return { title: category.name, description: category.intro, alternates: alternatesFor(locale, `/shop/${category.slug}`, category.languages as Language[]) };
}

/**
 * `params` is URL data, so it is read inside a Suspense boundary: the shell
 * can be shown instantly on navigation and the content streams into it.
 */
export default function CategoryPage({ params }: PageProps<"/[locale]/shop/[category]">) {
  return (
    <Suspense fallback={<div className="min-h-svh" />}>
      <CategoryPageContent params={params} />
    </Suspense>
  );
}

async function CategoryPageContent({ params }: Pick<PageProps<"/[locale]/shop/[category]">, "params">) {
  const slug = (await params).category;
  const { m, language } = await getI18n();
  const { categories, items } = await getCatalogData(language);
  const category = categories.find((c) => c.slug === slug);
  if (!category) notFound();

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/shop", label: m.shop.eyebrow }, { label: category.name }]}
        title={category.name}
        lead={category.intro}
        size="h1"
      />
      <section className="container-page pb-section">
        <ShopView items={items.filter((item) => item.category.slug === category.slug)} />
      </section>
    </>
  );
}
