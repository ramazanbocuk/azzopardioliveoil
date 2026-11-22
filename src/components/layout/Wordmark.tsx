import clsx from "clsx";
import { Emblem } from "@/components/brand/Logo";

/**
 * The header's logo: the emblem beside the name. The name stays as text so it
 * is sharp at this size and follows the header's colour. `mono` draws the
 * emblem in the text colour too, for when the header sits on a dark surface.
 */
export function Wordmark({ className, mono = false }: { className?: string; mono?: boolean }) {
  return (
    <span className={clsx("inline-flex items-center gap-2.5 leading-none sm:gap-3", className)}>
      <Emblem tone={mono ? "current" : "colour"} className="h-9 sm:h-11" />
      <span className="inline-flex flex-col items-center">
        <span className="font-serif text-[1.0625rem] tracking-[0.2em] uppercase sm:text-[1.375rem]">Azzopardi</span>
        <span className="mt-1 font-sans text-[0.5rem] font-medium tracking-[0.42em] sm:mt-1.5 sm:text-[0.5625rem] uppercase opacity-75">Olive Oil</span>
      </span>
    </span>
  );
}
