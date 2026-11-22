import clsx from "clsx";
import { ART } from "./art";

/**
 * The owners' logo: an olive tree, traced from their picture into vector
 * files (`public/brand/`), so it is sharp at any size. Two pieces: the tree on
 * its own (`Emblem`) and the tree above the name (`Logo`).
 *
 * The files are drawn in the brand's olive. On a dark surface that would
 * disappear, so `tone` draws the same shape in one colour instead (as foil on
 * a label does). Width and height are always given, so nothing moves while
 * the file loads.
 */
type Props = {
  /** "colour" for light surfaces; "current" takes the text colour; "gold" for dark surfaces. */
  tone?: "colour" | "current" | "gold";
  /** Sets the height (for example `h-10`); the width follows. */
  className?: string;
  /** Leave empty when the name is written next to it. */
  label?: string;
};

function Art({ art, tone = "colour", className, label = "" }: Props & { art: keyof typeof ART }) {
  const { src, width, height } = ART[art];
  if (tone === "colour") {
    // A small vector file: the image optimiser has nothing to add.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} width={width} height={height} alt={label} className={clsx("w-auto shrink-0", className)} />;
  }
  const mask = `url(${src}) center / contain no-repeat`;
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={clsx("inline-block shrink-0", tone === "gold" ? "bg-gold-300" : "bg-current", className)}
      style={{ aspectRatio: `${width} / ${height}`, mask, WebkitMask: mask }}
    />
  );
}

/**
 * The olive tree alone. `cut="bold"` is the same tree with heavier lines:
 * use it wherever the tree is shown small (a sidebar, a label).
 */
export function Emblem({ cut = "fine", ...props }: Props & { cut?: "fine" | "bold" }) {
  return <Art art={cut === "bold" ? "emblemBold" : "emblem"} {...props} />;
}

/** The full logo: the tree above the name and "Olive Oil Company". */
export function Logo(props: Props) {
  return <Art art="logo" label="Azzopardi Olive Oil Company" {...props} />;
}
