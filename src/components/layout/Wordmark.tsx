import clsx from "clsx";
import { NAME } from "@/components/brand/art";

/**
 * The header's logo: the name above "Olive Oil Company", in the logo's own
 * lettering and without the tree (its fine lines do not hold at this size).
 * Drawn in the page as outlines, in the header's text colour, so it is there
 * with the first paint and follows the header onto a dark surface.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${NAME.width} ${NAME.height}`} width={NAME.width} height={NAME.height} role="img" aria-label="Azzopardi Olive Oil Company" fill="currentColor" className={clsx("block h-8 w-auto sm:h-10", className)}>
      <path transform={NAME.name.move} d={NAME.name.d} />
      <path transform={NAME.sub.move} d={NAME.sub.d} opacity="0.8" />
    </svg>
  );
}
