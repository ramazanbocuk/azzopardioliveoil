"use client";

import { useRef, type ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { LotTicket } from "@/components/ui/LotTicket";
import { SAMPLE_LOT } from "@/content/site";
import { Reveal } from "@/motion/Reveal";
import { SplitHeading } from "@/motion/SplitHeading";
import { DUR, EASE, MOTION_OK, gsap, useGSAP } from "@/motion/gsap";

/**
 * Opening shot. A grove settles into frame, the headline rises, and on
 * scroll the hills separate by depth while the copy lifts away.
 */
export function Hero({ scene }: { scene: ReactNode }) {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const scrub = { trigger: root.current, start: "top top", end: "bottom top", scrub: true };

        gsap.from("[data-hero-scene]", { scale: 1.14, duration: DUR.cinematic, ease: EASE.soft, transformOrigin: "50% 100%" });

        gsap.utils.toArray<SVGGElement>("[data-depth]").forEach((layer) => {
          const depth = Number(layer.dataset.depth);
          gsap.to(layer, { y: (1 - depth) * 150, ease: "none", scrollTrigger: scrub });
        });

        gsap.to("[data-hero-copy]", { yPercent: -14, autoAlpha: 0, ease: "none", scrollTrigger: { ...scrub, end: "60% top" } });
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} data-tone="#dddad1" className="relative h-svh min-h-[40rem] overflow-hidden bg-dawn">
      <div data-hero-scene className="absolute inset-0 will-change-transform">
        {scene}
      </div>

      <div className="container-page relative z-10 flex h-full flex-col pt-[calc(var(--header-h)+clamp(1.5rem,6vh,5rem))]">
        <div data-hero-copy>
          <Reveal immediate delay={0.25}>
            <p className="text-label text-olive-900">High-polyphenol extra virgin olive oil</p>
          </Reveal>
          <SplitHeading
            as="h1"
            immediate
            delay={0.4}
            className="mt-5 max-w-[15ch] font-serif text-[clamp(3rem,7.4vw,8rem)] leading-[0.96] tracking-[-0.035em] text-olive-900"
          >
            Every bottle knows where it came from.
          </SplitHeading>
          <Reveal immediate delay={1.1} className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3">
            <ButtonLink href="/shop" arrow>
              Shop the oil
            </ButtonLink>
            <ButtonLink href="/quality-traceability" variant="text" className="text-olive-900">
              Trace a bottle
            </ButtonLink>
          </Reveal>
        </div>

        <div className="mt-auto flex items-end justify-between gap-6 pb-6 sm:pb-8">
          <Reveal immediate delay={1.5}>
            <LotTicket
              tone="dark"
              className="bg-olive-950/60 backdrop-blur-sm"
              sample
              lot={SAMPLE_LOT}
              rows={[
                { label: "Harvest", value: "—" },
                { label: "Producer", value: "—" },
              ]}
            />
          </Reveal>
          <Reveal immediate delay={1.7} className="hidden sm:block">
            <a href="#house" className="text-label inline-flex min-h-11 items-center gap-3 text-ivory">
              Scroll
              <span aria-hidden="true" className="block h-10 w-px bg-ivory/70" />
            </a>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
