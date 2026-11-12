"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Lenis from "lenis";
import { MOTION_OK, ScrollTrigger, gsap } from "./gsap";

declare global {
  interface Window {
    __motionReady?: boolean;
  }
}

/**
 * Smooth scrolling driven by GSAP's ticker so ScrollTrigger and Lenis share
 * one clock. Native scrolling is left untouched under reduced motion.
 */
export function SmoothScroll() {
  const pathname = usePathname();
  const instance = useRef<Lenis | null>(null);

  // A new page starts at the top, with fresh trigger positions.
  useEffect(() => {
    instance.current?.scrollTo(0, { immediate: true, force: true });
    ScrollTrigger.refresh();
  }, [pathname]);

  useEffect(() => {
    window.__motionReady = true;
    if (!window.matchMedia(MOTION_OK).matches) return;

    const lenis = new Lenis({ autoRaf: false, lerp: 0.11, anchors: true });
    instance.current = lenis;
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
      instance.current = null;
    };
  }, []);

  return null;
}
