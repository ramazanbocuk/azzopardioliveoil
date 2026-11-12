"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AddToCart, FavouriteButton } from "@/components/shop/Actions";
import { Bottle } from "@/components/ui/Bottle";
import { QuantityStepper, SizeSelector } from "@/components/ui/Field";
import { LotTicket } from "@/components/ui/LotTicket";
import { Plate } from "@/components/ui/Plate";
import { formatPrice, type Category, type Product } from "@/content/site";

/** Applies `?size=750` from the URL once the page is interactive. */
function SizeFromUrl({ onSize }: { onSize: (ml: number) => void }) {
  const size = useSearchParams().get("size");
  useEffect(() => {
    if (size) onSize(Number(size));
  }, [size, onSize]);
  return null;
}

export function ProductView({ product, category, freeShippingFrom }: { product: Product; category: Category; freeShippingFrom: number | null }) {
  const firstAvailable = product.variants.find((v) => v.inStock) ?? product.variants[0];
  const [ml, setMl] = useState(firstAvailable.ml);
  const [qty, setQty] = useState(1);
  const variant = product.variants.find((v) => v.ml === ml) ?? firstAvailable;
  const label = `${product.name} ${variant.ml} ml`;

  const applySize = useCallback(
    (next: number) => {
      if (product.variants.some((v) => v.ml === next)) setMl(next);
    },
    [product.variants],
  );

  return (
    <div className="grid gap-x-8 gap-y-12 lg:grid-cols-12">
      <Suspense fallback={null}>
        <SizeFromUrl onSize={applySize} />
      </Suspense>

      {/* Gallery */}
      <div className="lg:col-span-7">
        <div className="relative aspect-[4/5] bg-paper sm:aspect-[5/5]">
          <div className="absolute inset-x-0 bottom-[7%] top-[7%] flex items-end justify-center">
            <Bottle
              ml={variant.ml}
              lot={product.lot}
              title={`${label} (illustration)`}
              className="w-auto transition-[height] duration-[1100ms] ease-out-expo"
              style={{ height: `${variant.scale * 100}%` }}
            />
          </div>
          <span className="text-ticket absolute left-4 top-4 text-stone-700">Illustration — photograph to come</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:mt-8 sm:gap-8">
          <div className="relative aspect-[4/5]">
            <Plate tone="stone" label="label detail" />
          </div>
          <div className="relative aspect-[4/5]">
            <Plate tone="terracotta" label="bottle on the table" />
          </div>
        </div>
      </div>

      {/* Purchase panel */}
      <div className="lg:col-span-5 xl:col-span-4 xl:col-start-9">
        <div className="lg:sticky lg:top-[calc(var(--header-h)+2rem)]">
          <p className="text-label text-stone-700">{category.name}</p>
          <h1 className="text-h1 mt-4">{product.name}</h1>
          <p className="text-lead mt-5 text-ink/80">{product.blurb}</p>

          <p aria-live="polite" className="mt-8 font-serif text-[clamp(2.25rem,3.4vw,3rem)] leading-none tabular-nums">
            {formatPrice(variant.priceCents)}
          </p>
          <p className="text-small mt-2 text-stone-700">{variant.label} · VAT included</p>

          <div className="mt-8">
            <SizeSelector
              legend="Size"
              value={String(ml)}
              onChange={(value) => setMl(Number(value))}
              options={product.variants.map((v) => ({ value: String(v.ml), label: `${v.ml} ml`, disabled: !v.inStock }))}
            />
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <QuantityStepper value={qty} onChange={setQty} />
            <AddToCart sku={variant.sku} qty={qty} disabled={!variant.inStock} className="flex-1" />
            <FavouriteButton sku={variant.sku} label={label} className="size-13 border border-ink/30" />
          </div>

          <ul className="text-small mt-6 space-y-1.5 text-ink/80">
            <li>Sent from Belgium, tracked.</li>
            {freeShippingFrom !== null && <li>Free standard shipping from {formatPrice(freeShippingFrom)}.</li>}
          </ul>

          <LotTicket
            className="mt-8 w-full"
            lot={product.lot ?? "—"}
            rows={[
              { label: "Harvest", value: product.facts.harvest ?? "—" },
              { label: "Origin", value: product.facts.origin ?? "—" },
              { label: "Size", value: `${variant.ml} ml` },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
