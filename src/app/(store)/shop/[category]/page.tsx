import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ShopView } from "@/components/shop/ShopView";
import { PageHeader } from "@/components/ui/Page";
import { getCatalogData } from "@/server/storefrontData";

export async function generateStaticParams() {
  const { categories } = await getCatalogData();
  return categories.map((category) => ({ category: category.slug }));
}

export async function generateMetadata({ params }: PageProps<"/shop/[category]">): Promise<Metadata> {
  const slug = (await params).category;
  const category = (await getCatalogData()).categories.find((c) => c.slug === slug);
  if (!category) return {};
  return { title: category.name, description: category.intro, alternates: { canonical: `/shop/${category.slug}` } };
}

/**
 * `params` is URL data, so it is read inside a Suspense boundary: the shell
 * can be shown instantly on navigation and the content streams into it.
 */
export default function CategoryPage({ params }: PageProps<"/shop/[category]">) {
  return (
    <Suspense fallback={<div className="min-h-svh" />}>
      <CategoryPageContent params={params} />
    </Suspense>
  );
}

async function CategoryPageContent({ params }: Pick<PageProps<"/shop/[category]">, "params">) {
  const slug = (await params).category;
  const { categories, items } = await getCatalogData();
  const category = categories.find((c) => c.slug === slug);
  if (!category) notFound();

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/shop", label: "Shop" }, { label: category.name }]}
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
