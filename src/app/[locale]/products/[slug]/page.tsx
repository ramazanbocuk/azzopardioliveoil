import type { Metadata } from "next";
import { Suspense } from "react";
import { Link } from "@/components/ui/Link";
import { notFound } from "next/navigation";
import { ProductView } from "@/components/shop/ProductView";
import { ButtonLink } from "@/components/ui/Button";
import { JsonLd, siteUrl } from "@/components/ui/JsonLd";
import { Accordion, Breadcrumbs, FactList, Notice } from "@/components/ui/Page";
import { tagOf, type Language } from "@/i18n/config";
import { alternatesFor } from "@/i18n/seo";
import { getI18n } from "@/i18n/server";
import { getCatalogData, getFreeShippingThreshold } from "@/server/storefrontData";
import { SplitHeading } from "@/motion/SplitHeading";

export async function generateStaticParams() {
  const { products } = await getCatalogData();
  return products.map((product) => ({ slug: product.slug }));
}

export async function generateMetadata({ params }: PageProps<"/[locale]/products/[slug]">): Promise<Metadata> {
  const slug = (await params).slug;
  const { locale, language, href } = await getI18n();
  const product = (await getCatalogData(language)).products.find((p) => p.slug === slug);
  if (!product) return {};
  const path = `/products/${product.slug}`;
  return { title: product.name, description: product.blurb, alternates: alternatesFor(locale, path, product.languages as Language[]), openGraph: { title: product.name, description: product.blurb, url: href(path) } };
}

/**
 * `params` is URL data, so it is read inside a Suspense boundary: the shell
 * can be shown instantly on navigation and the content streams into it.
 */
export default function ProductPage({ params }: PageProps<"/[locale]/products/[slug]">) {
  return (
    <Suspense fallback={<div className="min-h-svh" />}>
      <ProductPageContent params={params} />
    </Suspense>
  );
}

async function ProductPageContent({ params }: Pick<PageProps<"/[locale]/products/[slug]">, "params">) {
  const slug = (await params).slug;
  const { m, locale, language, href } = await getI18n();
  const t = m.product;
  const [{ products, categories }, freeShippingFrom] = await Promise.all([getCatalogData(language), getFreeShippingThreshold()]);
  const product = products.find((p) => p.slug === slug);
  const category = product && categories.find((c) => c.slug === product.categorySlug);
  if (!product || !category) notFound();

  const { facts } = product;
  const base = siteUrl();
  const prices = product.variants.map((v) => v.priceCents);
  // Only facts that exist are published: no ratings, awards or claims are invented for search engines either.
  const productData = {
    "@context": "https://schema.org",
    "@type": "Product",
    // The language the name and description are actually written in.
    inLanguage: product.translated ? tagOf(locale) : "en",
    name: product.name,
    description: product.blurb,
    url: `${base}${href(`/products/${product.slug}`)}`,
    category: category.name,
    brand: { "@type": "Brand", name: "Azzopardi" },
    ...(prices.length
      ? {
          offers: {
            "@type": "AggregateOffer",
            priceCurrency: "EUR",
            lowPrice: (Math.min(...prices) / 100).toFixed(2),
            highPrice: (Math.max(...prices) / 100).toFixed(2),
            offerCount: prices.length,
            availability: product.variants.some((v) => v.inStock) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          },
        }
      : {}),
  };
  const breadcrumbData = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: m.shop.eyebrow, item: `${base}${href("/shop")}` },
      { "@type": "ListItem", position: 2, name: category.name, item: `${base}${href(`/shop/${category.slug}`)}` },
      { "@type": "ListItem", position: 3, name: product.name, item: `${base}${href(`/products/${product.slug}`)}` },
    ],
  };

  return (
    <div className="pt-[calc(var(--header-h)+2rem)]">
      <JsonLd data={productData} />
      <JsonLd data={breadcrumbData} />
      <div className="container-page">
        <Breadcrumbs items={[{ href: "/shop", label: m.shop.eyebrow }, { href: `/shop/${category.slug}`, label: category.name }, { label: product.name }]} />
        <div className="mt-8">
          <ProductView product={product} category={category} freeShippingFrom={freeShippingFrom} />
        </div>
      </div>

      <section aria-labelledby="details-title" className="container-page grid gap-x-8 gap-y-10 py-section lg:grid-cols-12">
        <div className="lg:col-span-4">
          <p className="text-label text-stone-700">{t.detailsEyebrow}</p>
          <SplitHeading id="details-title" className="text-h2 mt-4 max-w-[12ch]">
            {t.detailsTitle}
          </SplitHeading>
        </div>
        <div className="lg:col-span-7 lg:col-start-6">
          <Accordion
            name="product-details"
            defaultOpen={0}
            items={[
              {
                title: t.description,
                content: (
                  <div className="space-y-4" lang={product.translated ? undefined : "en"}>
                    {!product.translated && <p className="text-small text-stone-700" lang={tagOf(locale)}>{t.notTranslated}</p>}
                    {product.description.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                ),
              },
              {
                title: t.originHarvest,
                content: (
                  <FactList
                    rows={[
                      { label: t.currentLot, value: product.lot },
                      { label: t.origin, value: facts.origin },
                      { label: t.harvest, value: facts.harvest },
                      { label: t.variety, value: facts.cultivar },
                      { label: t.mill, value: facts.mill },
                      { label: t.bottled, value: facts.bottled },
                      { label: t.bestBefore, value: facts.bestBefore },
                    ]}
                  />
                ),
              },
              {
                title: t.ingredientsNutrition,
                content: (
                  <div className="space-y-5">
                    <FactList rows={[{ label: t.ingredients, value: facts.ingredients }]} />
                    <div>
                      <p className="text-label mb-2">{t.nutrition}</p>
                      <FactList rows={facts.nutrition} />
                    </div>
                  </div>
                ),
              },
              {
                title: t.storage,
                content: <FactList rows={[{ label: t.howToStore, value: facts.storage }]} />,
              },
              {
                title: t.shippingReturns,
                content: (
                  <p>
                    {t.shippingText.split("{link}")[0]}
                    <Link href="/shipping-returns" className="underline underline-offset-4">
                      {t.shippingLink}
                    </Link>
                    {t.shippingText.split("{link}")[1]}
                  </p>
                ),
              },
            ]}
          />
          <Notice title={t.dashTitle} className="mt-8">
            {t.dashText}
          </Notice>
        </div>
      </section>

      <section aria-labelledby="reviews-title" className="border-t border-ink/15">
        <div className="container-page grid gap-x-8 gap-y-8 py-section-sm lg:grid-cols-12">
          <h2 id="reviews-title" className="text-h2 lg:col-span-4">
            {t.reviews}
          </h2>
          <div className="lg:col-span-7 lg:col-start-6">
            <p className="text-lead text-ink/80">{t.noReviews}</p>
            <p className="mt-3 max-w-[56ch] text-ink/80">{t.reviewsText}</p>
            <ButtonLink href="/quality-traceability" variant="text" arrow className="mt-6">
              {t.traceCta}
            </ButtonLink>
          </div>
        </div>
      </section>
    </div>
  );
}
