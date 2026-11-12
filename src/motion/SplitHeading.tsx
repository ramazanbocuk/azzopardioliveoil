"use client";

import { useRef, type ReactNode } from "react";
import { DUR, EASE, MOTION_OK, STAGGER, SplitText, gsap, useGSAP } from "./gsap";

type SplitHeadingProps = {
  as?: "h1" | "h2" | "h3" | "p";
  children: ReactNode;
  className?: string;
  id?: string;
  delay?: number;
  /** Play on mount instead of on scroll. */
  immediate?: boolean;
};

/**
 * Headline that rises line by line out of a mask.
 * SplitText re-splits on resize and font load, and keeps the original text
 * available to assistive technology.
 */
export function SplitHeading({ as: Tag = "h2", children, className, id, delay = 0, immediate = false }: SplitHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const el = ref.current;
        if (!el) return;
        gsap.set(el, { autoAlpha: 1 });
        const split = SplitText.create(el, {
          type: "lines",
          mask: "lines",
          linesClass: "split-line",
          autoSplit: true,
          onSplit: (self) =>
            gsap.from(self.lines, {
              yPercent: 115,
              duration: DUR.slow,
              ease: EASE.out,
              stagger: STAGGER.lines,
              delay,
              scrollTrigger: immediate ? undefined : { trigger: el, start: "top 88%", once: true },
            }),
        });
        return () => split.revert();
      });
    },
    { scope: ref },
  );

  return (
    <Tag ref={ref as never} id={id} data-reveal className={className}>
      {children}
    </Tag>
  );
}
