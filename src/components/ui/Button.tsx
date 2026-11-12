import Link from "next/link";
import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";
import { ArrowIcon } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "inverse" | "inverse-outline" | "text";
export type ButtonSize = "md" | "sm";

const base =
  "group/btn inline-flex items-center justify-center gap-3 text-label whitespace-nowrap select-none " +
  "transition-[background-color,color,border-color] duration-500 ease-out-expo " +
  "disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-olive-700 text-ivory border border-olive-700 hover:bg-olive-950 hover:border-olive-950",
  secondary: "bg-transparent text-ink border border-ink/35 hover:bg-ink hover:text-ivory hover:border-ink",
  inverse: "bg-ivory text-olive-900 border border-ivory hover:bg-gold-300 hover:border-gold-300",
  "inverse-outline": "bg-transparent text-ivory border border-ivory/45 hover:bg-ivory hover:text-olive-900 hover:border-ivory",
  text: "text-current link-underline !justify-start",
};

const sizes: Record<ButtonSize, string> = {
  md: "h-13 px-8",
  sm: "h-11 px-5",
};

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  arrow?: boolean;
  children: ReactNode;
  className?: string;
};

function classes({ variant = "primary", size = "md", className }: Pick<CommonProps, "variant" | "size" | "className">) {
  return clsx(base, variants[variant], variant === "text" ? "min-h-11" : sizes[size], className);
}

function Content({ arrow, children }: Pick<CommonProps, "arrow" | "children">) {
  return (
    <>
      <span>{children}</span>
      {arrow && (
        <ArrowIcon className="size-4 shrink-0 transition-transform duration-500 ease-out-expo group-hover/btn:translate-x-1" />
      )}
    </>
  );
}

export function Button({ variant, size, arrow, children, className, ...props }: CommonProps & Omit<ComponentProps<"button">, "className" | "children">) {
  return (
    <button type="button" className={classes({ variant, size, className })} {...props}>
      <Content arrow={arrow}>{children}</Content>
    </button>
  );
}

export function ButtonLink({ variant, size, arrow, children, className, ...props }: CommonProps & Omit<ComponentProps<typeof Link>, "className" | "children">) {
  return (
    <Link className={classes({ variant, size, className })} {...props}>
      <Content arrow={arrow}>{children}</Content>
    </Link>
  );
}
