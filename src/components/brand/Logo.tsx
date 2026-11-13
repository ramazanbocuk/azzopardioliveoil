import clsx from "clsx";

/**
 * The supplied logo artwork, cut from the owner's image with its paper
 * background made transparent (`public/brand/`). Two pieces: the round emblem
 * and the full lockup with the name. They are bitmaps, not vectors: fine on a
 * screen at these sizes, not for print.
 *
 * On a dark surface the artwork's dark green would disappear, so `tone` draws
 * the same shape in one colour instead (as the foil on the bottle label does).
 */
const ART = {
  emblem: { src: "/brand/emblem.png", width: 281, height: 278 },
  logo: { src: "/brand/logo.png", width: 828, height: 465 },
} as const;

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
    // A small static file: the image optimiser has nothing to add.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} width={width} height={height} alt={label} className={clsx("w-auto", className)} />;
  }
  const mask = `url(${src}) center / contain no-repeat`;
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={clsx("inline-block", tone === "gold" ? "bg-gold-300" : "bg-current", className)}
      style={{ aspectRatio: `${width} / ${height}`, mask, WebkitMask: mask }}
    />
  );
}

/** The round emblem: the letter A with an olive branch. */
export function Emblem(props: Props) {
  return <Art art="emblem" {...props} />;
}

/** The full logo: emblem, name and "Olive Oil". */
export function Logo(props: Props) {
  return <Art art="logo" label="Azzopardi Olive Oil" {...props} />;
}
