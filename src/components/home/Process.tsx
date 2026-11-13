"use client";

import { useRef } from "react";
import { Plate, type PlateTone } from "@/components/ui/Plate";
import { processSteps } from "@/content/site";
import { DESKTOP_MOTION, gsap, useGSAP } from "@/motion/gsap";

const tones: PlateTone[] = ["olive", "stone", "gold", "dawn", "terracotta"];

/**
 * Harvest to door. On desktop the section pins and the steps travel
 * sideways with the scroll; on touch and under reduced motion it is a plain
 * vertical list.
 */
export function Process() {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLOListElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(DESKTOP_MOTION, () => {
        const distance = () => (track.current ? track.current.scrollWidth - window.innerWidth : 0);
        gsap.to(track.current, {
          x: () => -distance(),
          ease: "none",
          scrollTrigger: {
            trigger: root.current,
            pin: true,
            scrub: 0.6,
            start: "top top",
            end: () => `+=${distance()}`,
            invalidateOnRefresh: true,
          },
        });
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} data-tone="#ebddbc" aria-labelledby="process-title" className="overflow-hidden py-section lg:flex lg:h-svh lg:min-h-[44rem] lg:items-center lg:py-0">
      <ol ref={track} className="flex flex-col gap-y-16 px-gutter will-change-transform lg:w-max lg:flex-row lg:items-stretch lg:gap-x-[6vw] lg:pr-[12vw]">
        <li className="flex flex-col justify-center lg:w-[38vw] lg:max-w-[40rem] lg:shrink-0">
          <p className="text-label text-gold-700">How an oil reaches you</p>
          <h2 id="process-title" className="text-h1 mt-5 max-w-[11ch]">
            From the harvest to your door, in order.
          </h2>
          <p className="text-lead mt-6 max-w-[32ch] text-ink/80">Five steps, no shortcuts between them. What is known about each lot is published with its number.</p>
        </li>

        {processSteps.map((step, index) => (
          <li key={step.title} className="lg:w-[26vw] lg:min-w-[21rem] lg:max-w-[28rem] lg:shrink-0">
            <div className="relative aspect-[4/3] lg:aspect-[4/5]">
              <Plate tone={tones[index % tones.length]} label={step.title.toLowerCase()} />
            </div>
            <div className="mt-6 flex gap-5 border-t border-ink/25 pt-5">
              <span aria-hidden="true" className="text-ticket pt-2 text-gold-700">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="text-h3">{step.title}</h3>
                <p className="mt-3 max-w-[36ch] text-ink/80">{step.body}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
