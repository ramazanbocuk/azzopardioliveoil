"use client";

import { useRef, type ReactNode } from "react";
import { DUR, EASE, MOTION_OK, gsap, useGSAP } from "./gsap";

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  /** Distance travelled in px. */
  y?: number;
  /** Play on mount instead of on scroll (above-the-fold content). */
  immediate?: boolean;
};

/** Fades a block up into place the first time it enters the viewport. */
export function Reveal({ children, className, delay = 0, y = 28, immediate = false }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(
          ref.current,
          { autoAlpha: 0, y },
          {
            autoAlpha: 1,
            y: 0,
            duration: DUR.base,
            ease: EASE.soft,
            delay,
            scrollTrigger: immediate ? undefined : { trigger: ref.current, start: "top 88%", once: true },
          },
        );
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} data-reveal className={className}>
      {children}
    </div>
  );
}
