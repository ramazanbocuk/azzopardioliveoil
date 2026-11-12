"use client";

import { useRef, type ReactNode } from "react";
import { MOTION_OK, gsap, useGSAP } from "./gsap";

type ParallaxProps = {
  children: ReactNode;
  className?: string;
  /** Extra image height on each side, in percent of the frame. */
  amount?: number;
};

/** A frame whose contents drift slower than the page. */
export function Parallax({ children, className, amount = 10 }: ParallaxProps) {
  const frame = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const travel = amount * 0.75;
        gsap.fromTo(
          inner.current,
          { yPercent: -travel },
          {
            yPercent: travel,
            ease: "none",
            scrollTrigger: { trigger: frame.current, start: "top bottom", end: "bottom top", scrub: true },
          },
        );
      });
    },
    { scope: frame },
  );

  return (
    <div ref={frame} className={`relative overflow-hidden ${className ?? ""}`}>
      <div ref={inner} className="absolute inset-x-0 will-change-transform" style={{ top: `-${amount}%`, bottom: `-${amount}%` }}>
        {children}
      </div>
    </div>
  );
}
