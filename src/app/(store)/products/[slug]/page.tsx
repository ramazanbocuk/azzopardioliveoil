import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductView } from "@/components/shop/ProductView";
import { ButtonLink } from "@/components/ui/Button";
import { JsonLd, siteUrl } from "@/components/ui/JsonLd";
import { Accordion, Breadcrumbs, FactList, Notice } from "@/components/ui/Page";
import { getCatalogData, getFreeShippingThreshold } from "@/server/storefrontData";
import { SplitHeading } from "@/motion/SplitHeading";

export async function generateStaticParams() {
  const { products } = await getCatalogData();
  return products.map((product) => ({ slug: product.slug }));
}

export async function generateMetadata({ params }: PageProps<"/products/[slug]">): Promise<Metadata> {
  const slug = (await params).slug;
  const product = (await getCatalogData()).products.find((p) => p.slug === slug);
  if (!product) return {};
  return { title: product.name, description: product.blurb, alternates: { canonical: `/products/${product.slug}` }, openGraph: { title: product.name, description: product.blurb, url: `/products/${product.slug}` } };
}

/**
 * `params` is URL data, so it is read inside a Suspense boundary: the shell
 * can be shown instantly on navigation and the content streams into it.
 */
export default function ProductPage({ params }: PageProps<"/products/[slug]">) {
  return (
    <Suspense fallback={<div className="min-h-svh" />}>
      <ProductPageContent params={params} />
    </Suspense>
  );
}

async function ProductPageContent({ params }: Pick<PageProps<"/products/[slug]">, "params">) {
  const slug = (await params).slug;
  const [{ products, categories }, freeShippingFrom] = await Promise.all([getCatalogData(), getFreeShippingThreshold()]);
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
    name: product.name,
    description: product.blurb,
    url: `${base}/products/${product.slug}`,
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
      { "@type": "ListItem", position: 1, name: "Shop", item: `${base}/shop` },
      { "@type": "ListItem", position: 2, name: category.name, item: `${base}/shop/${category.slug}` },
      { "@type": "ListItem", position: 3, name: product.name, item: `${base}/products/${product.slug}` },
    ],
  };

  return (
    <div className="pt-[calc(var(--header-h)+2rem)]">
      <JsonLd data={productData} />
      <JsonLd data={breadcrumbData} />
      <div className="container-page">
        <Breadcrumbs items={[{ href: "/shop", label: "Shop" }, { href: `/shop/${category.slug}`, label: category.name }, { label: product.name }]} />
        <div className="mt-8">
          <ProductView product={product} category={category} freeShippingFrom={freeShippingFrom} />
        </div>
      </div>

      <section aria-labelledby="details-title" className="container-page grid gap-x-8 gap-y-10 py-section lg:grid-cols-12">
        <div className="lg:col-span-4">
          <p className="text-label text-stone-700">The details</p>
          <SplitHeading id="details-title" className="text-h2 mt-4 max-w-[12ch]">
            What is in the bottle, and where it came from.
          </SplitHeading>
        </div>
        <div className="lg:col-span-7 lg:col-start-6">
          <Accordion
            name="product-details"
            defaultOpen={0}
            items={[
              {
                title: "Description",
                content: (
                  <div className="space-y-4">
                    {product.description.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                ),
              },
              {
                title: "Origin & harvest",
                content: (
                  <FactList
                    rows={[
                      { label: "Current lot", value: product.lot },
                      { label: "Origin", value: facts.origin },
                      { label: "Harvest", value: facts.harvest },
                      { label: "Olive variety", value: facts.cultivar },
                      { label: "Mill", value: facts.mill },
                      { label: "Bottled", value: facts.bottled },
                      { label: "Best before", value: facts.bestBefore },
                    ]}
                  />
                ),
              },
              {
                title: "Ingredients & nutrition",
                content: (
                  <div className="space-y-5">
                    <FactList rows={[{ label: "Ingredients", value: facts.ingredients }]} />
                    <div>
                      <p className="text-label mb-2">Nutrition declaration</p>
                      <FactList rows={facts.nutrition} />
                    </div>
                  </div>
                ),
              },
              {
                title: "Storage",
                content: <FactList rows={[{ label: "How to store", value: facts.storage }]} />,
              },
              {
                title: "Shipping & returns",
                content: (
                  <p>
                    Orders are sent from Belgium with tracking. Rates, destinations and the conditions for returns are on the{" "}
                    <Link href="/shipping-returns" className="underline underline-offset-4">
                      shipping and returns page
                    </Link>
                    .
                  </p>
                ),
              },
            ]}
          />
          <Notice title="Why some fields show a dash" className="mt-8">
            Origin, harvest, ingredients, nutrition and storage are recorded per lot by the administrator. They are never filled in automatically, so a dash means the information has not been entered yet. These fields must be complete before the product is sold.
          </Notice>
        </div>
      </section>

      <section aria-labelledby="reviews-title" className="border-t border-ink/15">
        <div className="container-page grid gap-x-8 gap-y-8 py-section-sm lg:grid-cols-12">
          <h2 id="reviews-title" className="text-h2 lg:col-span-4">
            Reviews
          </h2>
          <div className="lg:col-span-7 lg:col-start-6">
            <p className="text-lead text-ink/80">No reviews yet.</p>
            <p className="mt-3 max-w-[56ch] text-ink/80">Reviews can be left by customers once their order has been delivered. They appear here after verification.</p>
            <ButtonLink href="/quality-traceability" variant="text" arrow className="mt-6">
              How we trace each lot
            </ButtonLink>
          </div>
        </div>
      </section>
    </div>
  );
}
