import clsx from "clsx";
import { LOCKUP, TREE } from "./art";

/**
 * The logo: an olive tree, drawn as vector paths (`./art.ts`), so it is sharp
 * at any size and on any screen. Two pieces: the tree on its own (`Emblem`)
 * and the tree above the name (`Logo`). Both are drawn in the page itself, so
 * there is no picture to wait for and nothing moves when the page loads.
 *
 * `tone` chooses the colours: the brand's olive with gold fruit on a light
 * surface, the text colour, or the foil gold used on dark surfaces.
 */
type Props = {
  /** "colour" for light surfaces; "current" takes the text colour; "gold" for dark surfaces. */
  tone?: "colour" | "current" | "gold";
  /** Sets the height (for example `h-10`); the width follows. */
  className?: string;
  /** Leave empty when the name is written next to it. */
  label?: string;
};

const INK = { colour: "var(--color-olive-900)", current: "currentColor", gold: "var(--color-gold-300)" } as const;
const ACCENT = { colour: "var(--color-gold-500)", current: "currentColor", gold: "var(--color-gold-300)" } as const;

const naming = (label: string) => (label ? ({ role: "img", "aria-label": label } as const) : ({ "aria-hidden": true } as const));

/**
 * The olive tree alone. `cut="bold"` is the same tree with fewer, larger
 * leaves: use it wherever the tree is shown small (a header, a label).
 */
export function Emblem({ tone = "colour", className, label = "", cut = "fine" }: Props & { cut?: "fine" | "bold" }) {
  const art = TREE[cut];
  const [, , width, height] = art.box;
  return (
    <svg viewBox={art.box.join(" ")} width={width} height={height} className={clsx("inline-block w-auto shrink-0", className)} {...naming(label)}>
      <path fill={INK[tone]} d={art.tree} />
      <path fill={ACCENT[tone]} d={art.olives} />
    </svg>
  );
}

/** The full logo: the tree above the name and "Olive Oil". */
export function Logo({ tone = "colour", className, label = "Azzopardi Olive Oil" }: Props) {
  return (
    <svg viewBox={`0 0 ${LOCKUP.width} ${LOCKUP.height}`} width={LOCKUP.width} height={LOCKUP.height} className={clsx("inline-block w-auto shrink-0", className)} {...naming(label)}>
      <g transform={LOCKUP.treeMove}>
        <path fill={INK[tone]} d={TREE.fine.tree} />
        <path fill={ACCENT[tone]} d={TREE.fine.olives} />
      </g>
      <path fill={INK[tone]} transform={LOCKUP.name.move} d={LOCKUP.name.d} />
      <path fill={INK[tone]} transform={LOCKUP.sub.move} d={LOCKUP.sub.d} />
      {LOCKUP.rules.map((rule) => (
        <rect key={rule.x} x={rule.x} y={LOCKUP.ruleY} width={rule.width} height="0.8" fill={ACCENT[tone]} />
      ))}
    </svg>
  );
}
