"use client";

import { usePathname } from "next/navigation";
import { ScrollTrigger, useGSAP } from "./gsap";

/**
 * The page ground follows the harvest day. Any element with `data-tone`
 * (a CSS colour) sets the body background while it crosses mid-viewport;
 * the colour change itself is a CSS transition on <body>.
 */
export function ToneShift() {
  const pathname = usePathname();
  useGSAP(
    () => {
    const body = document.body;
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-tone]"));
    const triggers = sections.map((section) => {
      const apply = () => body.style.setProperty("--page-bg", section.dataset.tone ?? "");
      return ScrollTrigger.create({
        trigger: section,
        start: "top 55%",
        end: "bottom 55%",
        onEnter: apply,
        onEnterBack: apply,
      });
    });
    return () => {
      triggers.forEach((trigger) => trigger.kill());
      body.style.removeProperty("--page-bg");
    };
    },
    { dependencies: [pathname], revertOnUpdate: true },
  );

  return null;
}
