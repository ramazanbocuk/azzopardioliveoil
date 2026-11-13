"use client";

import { Link } from "@/components/ui/Link";
import { FavouriteButton } from "@/components/shop/Actions";
import { productHref, type CatalogItem } from "@/content/site";
import { useI18n } from "@/i18n/client";
import { Bottle } from "./Bottle";

/** One purchasable variant. The whole card is the link; the heart sits above it. */
export function ProductCard({ item }: { item: CatalogItem }) {
  const { product, variant, category } = item;
  const { m, fill, money } = useI18n();
  const label = `${product.name} ${variant.ml} ml`;
  return (
    <article className="group/card relative">
      <div className="relative aspect-[4/5] overflow-hidden bg-paper transition-colors duration-700 ease-out-expo group-hover/card:bg-stone-300">
        <div className="absolute inset-x-0 bottom-[9%] top-[9%] flex items-end justify-center">
          <Bottle
            ml={variant.ml}
            lot={product.lot}
            className="w-auto transition-transform duration-[900ms] ease-out-expo group-hover/card:-translate-y-2"
            // Height carries the size difference between variants.
            style={{ height: `${Math.round(variant.scale * 100)}%` }}
            title={fill(m.shop.illustration, { name: label })}
          />
        </div>
        {product.lot && <span className="text-ticket absolute left-4 top-4 text-stone-700">{fill(m.shop.lot, { lot: product.lot })}</span>}
        {!variant.inStock && <span className="text-label absolute bottom-4 left-4 bg-ink px-3 py-2 text-ivory">{variant.backorder ? m.fulfil.orderAhead : m.shop.soldOut}</span>}
      </div>

      <div className="mt-5 flex items-start justify-between gap-6">
        <div>
          <p className="text-label text-stone-700">{category.name}</p>
          <h3 className="text-h3 mt-2">
            <Link href={productHref(product, variant.ml)} className="after:absolute after:inset-0 after:content-['']">
              {product.name}
            </Link>
          </h3>
          <p className="text-small mt-1 text-stone-700">{variant.ml} ml</p>
        </div>
        <p className="text-lead shrink-0 pt-6 tabular-nums">{money(variant.priceCents)}</p>
      </div>

      <FavouriteButton sku={variant.sku} label={label} className="absolute right-2 top-2 z-10" />
    </article>
  );
}
