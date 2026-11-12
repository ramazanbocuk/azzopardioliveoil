"use client";

import { useRef, useState } from "react";
import { Bottle } from "@/components/ui/Bottle";
import { ButtonLink } from "@/components/ui/Button";
import { SizeSelector } from "@/components/ui/Field";
import { LotTicket } from "@/components/ui/LotTicket";
import { formatPrice, productHref, type Product } from "@/content/site";
import { Reveal } from "@/motion/Reveal";
import { SplitHeading } from "@/motion/SplitHeading";
import { DUR, EASE, MOTION_OK, gsap, useGSAP } from "@/motion/gsap";

/** The one oil, with a live size switch: the bottle grows, the price rolls. */
export function Showcase({ product }: { product: Product }) {
  const [ml, setMl] = useState((product.variants[Math.floor(product.variants.length / 2)] ?? product.variants[0]).ml);
  const size = product.variants.find((s) => s.ml === ml) ?? product.variants[0];
  const price = useRef<HTMLParagraphElement>(null);
  const first = useRef(true);

  useGSAP(
    () => {
      if (first.current) {
        first.current = false;
        return;
      }
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(price.current, { yPercent: 45, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: DUR.fast * 1.4, ease: EASE.out });
      });
    },
    { dependencies: [ml] },
  );

  return (
    <section data-tone="#f4efe4" aria-labelledby="showcase-title" className="py-section">
      <div className="container-page grid items-center gap-x-8 gap-y-12 lg:grid-cols-12">
        <Reveal className="lg:col-span-6 xl:col-span-5 xl:col-start-2">
          <div className="relative aspect-[4/5] bg-paper">
            <div className="absolute inset-x-0 bottom-[8%] top-[8%] flex items-end justify-center">
              <Bottle
                ml={size.ml}
                lot={product.lot}
                title={`${product.name}, ${size.ml} ml (illustration)`}
                className="w-auto transition-[height] duration-[1100ms] ease-out-expo"
                style={{ height: `${size.scale * 100}%` }}
              />
            </div>
            <span className="text-ticket absolute left-4 top-4 text-stone-700">Illustration — photograph to come</span>
          </div>
        </Reveal>

        <div className="lg:col-span-5 lg:col-start-8">
          <Reveal>
            <p className="text-label text-stone-700">Sicilian olive oil</p>
          </Reveal>
          <SplitHeading id="showcase-title" className="text-h1 mt-4">
            {product.name}
          </SplitHeading>
          <Reveal delay={0.1}>
            <p className="text-lead mt-6 max-w-[34ch] text-ink/80">{product.blurb}</p>

            <div className="mt-10 overflow-hidden">
              <p ref={price} aria-live="polite" className="font-serif text-[clamp(2.25rem,3.4vw,3.25rem)] leading-none tabular-nums">
                {formatPrice(size.priceCents)}
              </p>
            </div>
            <p className="text-small mt-2 text-stone-700">VAT included · shipping calculated at checkout</p>

            <div className="mt-8">
              <SizeSelector
                legend="Size"
                value={String(ml)}
                onChange={(value) => setMl(Number(value))}
                options={product.variants.map((s) => ({ value: String(s.ml), label: `${s.ml} ml` }))}
              />
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
              <ButtonLink href={productHref(product, ml)} arrow>
                View this bottle
              </ButtonLink>
              {product.lot && <LotTicket lot={product.lot} />}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
