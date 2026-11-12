"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

/**
 * Animation language
 * - Things arrive, they do not bounce: expo/power eases only.
 * - Type rises out of a mask line by line; images drift, they never zoom in fast.
 * - One idea per section. Nothing loops. Nothing moves under reduced motion.
 */
export const EASE = { out: "expo.out", soft: "power3.out", inOut: "power3.inOut" } as const;
export const DUR = { fast: 0.45, base: 0.9, slow: 1.3, cinematic: 2.4 } as const;
export const STAGGER = { lines: 0.085, items: 0.12 } as const;

/** Every animation is registered under this query so reduced motion gets none. */
export const MOTION_OK = "(prefers-reduced-motion: no-preference)";
export const DESKTOP_MOTION = "(min-width: 1024px) and (prefers-reduced-motion: no-preference)";

export { gsap, ScrollTrigger, SplitText, useGSAP };
