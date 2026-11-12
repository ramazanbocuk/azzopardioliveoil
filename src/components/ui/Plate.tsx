import clsx from "clsx";
import type { ReactNode } from "react";
import { Parallax } from "@/motion/Parallax";

export type PlateTone = "olive" | "stone" | "gold" | "terracotta" | "dawn";

const tones: Record<PlateTone, { bg: string; text: string }> = {
  olive: { bg: "linear-gradient(155deg,#5a6843 0%,#2f3a22 55%,#1a2112 100%)", text: "text-ivory" },
  stone: { bg: "linear-gradient(155deg,#ddd6c8 0%,#b9b0a0 60%,#978e7d 100%)", text: "text-ink" },
  gold: { bg: "linear-gradient(155deg,#e2c98f 0%,#b08d4a 60%,#86682f 100%)", text: "text-ink" },
  terracotta: { bg: "linear-gradient(155deg,#cd8259 0%,#b5613c 50%,#84401f 100%)", text: "text-ivory" },
  dawn: { bg: "linear-gradient(155deg,#eceae3 0%,#d2cbbd 70%,#b9b0a0 100%)", text: "text-ink" },
};

type PlateProps = {
  /** What the final photograph should show. Printed on the plate. */
  label: string;
  tone?: PlateTone;
  className?: string;
  /** Drift the image slower than the page, by this percentage. */
  parallax?: number;
  /** Optional illustration rendered instead of the flat tone. */
  children?: ReactNode;
};

/**
 * Stand-in for a photograph. It fills its (positioned) parent, carries film
 * grain, and states plainly what belongs there, so no placeholder can pass
 * for the real grove. Swap the surface for `next/image` once photography is
 * supplied; the frame, parallax and caption stay.
 */
export function Plate({ label, tone = "olive", className, parallax, children }: PlateProps) {
  const t = tones[tone];
  const surface = (
    <div className={clsx("grain absolute inset-0", className)} style={{ background: t.bg }}>
      {children}
    </div>
  );
  return (
    <div role="img" aria-label={`Placeholder for photograph: ${label}`} className={clsx("absolute inset-0 overflow-hidden", t.text)}>
      {parallax ? (
        <Parallax className="!absolute inset-0" amount={parallax}>
          {surface}
        </Parallax>
      ) : (
        surface
      )}
      <span className="text-ticket absolute bottom-3 left-3 right-3 z-10 opacity-80 sm:bottom-4 sm:left-4">Photograph to come — {label}</span>
    </div>
  );
}
