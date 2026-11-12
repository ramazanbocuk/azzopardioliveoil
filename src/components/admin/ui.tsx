import Link from "next/link";
import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

/** Admin design: the brand's type and olive, on a denser, neutral, tool-like surface. */

export const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : new Intl.NumberFormat("en-BE", { style: "currency", currency: "EUR" }).format(cents / 100));
export const date = (value: Date | null | undefined) => (value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(value) : "—");
export const dateTime = (value: Date | null | undefined) => (value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(value) : "—");
export const euros = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : (cents / 100).toFixed(2));
export const isoDay = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 10) : "");

export function Page({ title, eyebrow, actions, children }: { title: string; eyebrow?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[84rem] px-5 py-8 sm:px-8 lg:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow && <p className="text-label text-stone-700">{eyebrow}</p>}
          <h1 className="mt-1 font-serif text-[2rem] leading-tight tracking-[-0.02em]">{title}</h1>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
      </header>
      <div className="mt-8 space-y-8">{children}</div>
    </div>
  );
}

/** Result of the last action, carried in the URL by `run()`. */
export function Flash({ params }: { params: { ok?: string; error?: string } }) {
  if (params.error) return <p role="alert" className="border-l-2 border-terracotta-700 bg-terracotta-500/10 px-4 py-3 text-terracotta-700">{params.error}</p>;
  if (params.ok) return <p role="status" className="border-l-2 border-olive-700 bg-olive-700/10 px-4 py-3 text-olive-900">{params.ok}</p>;
  return null;
}

export function Card({ title, description, children, className }: { title?: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("border border-ink/10 bg-white", className)}>
      {title && (
        <div className="border-b border-ink/10 px-5 py-4">
          <h2 className="text-[1.0625rem] font-medium">{title}</h2>
          {description && <p className="text-small mt-1 text-stone-700">{description}</p>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border border-ink/10 bg-white p-5">
      <p className="text-label text-stone-700">{label}</p>
      <p className="mt-3 font-serif text-[1.875rem] leading-none tabular-nums">{value}</p>
      {note && <p className="text-small mt-2 text-stone-700">{note}</p>}
    </div>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-left text-[0.9375rem]">
        <thead>
          <tr className="border-b border-ink/15">
            {head.map((cell) => (
              <th key={cell} scope="col" className="text-label px-3 py-3 font-medium text-stone-700 first:pl-0 last:pr-0">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:border-ink/10 [&_td]:px-3 [&_td]:py-3 [&_td:first-child]:pl-0 [&_td:last-child]:pr-0">{children}</tbody>
      </table>
      {empty && <p className="py-8 text-center text-stone-700">{empty}</p>}
    </div>
  );
}

const TONES: Record<string, string> = {
  PENDING_PAYMENT: "bg-gold-300/40 text-gold-700",
  PAID: "bg-olive-100 text-olive-900",
  FULFILLING: "bg-olive-100 text-olive-900",
  SHIPPED: "bg-olive-700 text-ivory",
  DELIVERED: "bg-olive-900 text-ivory",
  CANCELLED: "bg-stone-300 text-ink",
  REFUNDED: "bg-terracotta-500/20 text-terracotta-700",
  UNPAID: "bg-gold-300/40 text-gold-700",
  FAILED: "bg-terracotta-500/20 text-terracotta-700",
  PARTIALLY_REFUNDED: "bg-terracotta-500/20 text-terracotta-700",
};

export function Badge({ children, tone }: { children: string; tone?: string }) {
  return <span className={clsx("inline-block whitespace-nowrap px-2 py-1 text-[0.6875rem] font-medium uppercase tracking-[0.08em]", TONES[tone ?? children] ?? "bg-stone-300 text-ink")}>{children.replaceAll("_", " ")}</span>;
}

const control = "h-10 w-full border border-ink/25 bg-white px-3 text-[0.9375rem] outline-none transition-colors hover:border-ink/50 focus:border-olive-700 focus:shadow-[0_0_0_1px_var(--color-olive-700)]";

export function Field({ label, hint, className, ...props }: { label: string; hint?: string } & ComponentProps<"input">) {
  return (
    <label className={clsx("block", className)}>
      <span className="text-small font-medium">{label}</span>
      <input className={clsx(control, "mt-1.5")} {...props} />
      {hint && <span className="text-small mt-1 block text-stone-700">{hint}</span>}
    </label>
  );
}

export function TextArea({ label, hint, className, ...props }: { label: string; hint?: string } & ComponentProps<"textarea">) {
  return (
    <label className={clsx("block", className)}>
      <span className="text-small font-medium">{label}</span>
      <textarea className={clsx(control, "mt-1.5 h-auto py-2")} rows={4} {...props} />
      {hint && <span className="text-small mt-1 block text-stone-700">{hint}</span>}
    </label>
  );
}

export function Select({ label, className, children, ...props }: { label: string } & ComponentProps<"select">) {
  return (
    <label className={clsx("block", className)}>
      <span className="text-small font-medium">{label}</span>
      <select className={clsx(control, "mt-1.5")} {...props}>
        {children}
      </select>
    </label>
  );
}

export function Check({ label, className, ...props }: { label: string } & ComponentProps<"input">) {
  return (
    <label className={clsx("flex min-h-10 items-center gap-2.5", className)}>
      <input type="checkbox" className="size-4 accent-olive-700" {...props} />
      <span className="text-[0.9375rem]">{label}</span>
    </label>
  );
}

const buttons = {
  primary: "bg-olive-700 text-ivory hover:bg-olive-950",
  secondary: "border border-ink/30 bg-white hover:border-ink",
  danger: "border border-terracotta-700 text-terracotta-700 hover:bg-terracotta-700 hover:text-ivory",
};

export function Submit({ children, variant = "primary", className, ...props }: { variant?: keyof typeof buttons } & ComponentProps<"button">) {
  return (
    <button type="submit" className={clsx("inline-flex h-10 items-center justify-center whitespace-nowrap px-4 text-[0.8125rem] font-medium uppercase tracking-[0.1em] transition-colors", buttons[variant], className)} {...props}>
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "secondary", ...props }: { variant?: keyof typeof buttons } & ComponentProps<typeof Link>) {
  return (
    <Link href={href} className={clsx("inline-flex h-10 items-center justify-center whitespace-nowrap px-4 text-[0.8125rem] font-medium uppercase tracking-[0.1em] transition-colors", buttons[variant])} {...props}>
      {children}
    </Link>
  );
}

export const cellLink = "font-medium underline decoration-ink/30 underline-offset-4 hover:decoration-ink";
