"use client";

import clsx from "clsx";
import { useId, useState, type ComponentProps } from "react";
import { useI18n } from "@/i18n/client";
import { MinusIcon, PlusIcon } from "./icons";

const control =
  "h-13 w-full border-b bg-transparent text-body outline-none transition-[border-color,box-shadow] duration-300 " +
  "placeholder:text-current placeholder:opacity-45 focus-visible:outline-none";

const controlTone = {
  light: "border-ink/35 hover:border-ink focus:border-ink focus:shadow-[0_1px_0_0_var(--color-ink)]",
  dark: "border-ivory/45 hover:border-ivory focus:border-ivory focus:shadow-[0_1px_0_0_var(--color-ivory)]",
};

type FieldBase = { label: string; hint?: string; error?: string; tone?: "light" | "dark" };

function Messages({ id, hint, error }: { id: string; hint?: string; error?: string }) {
  if (error) {
    return (
      <p id={`${id}-msg`} role="alert" className="text-small mt-2 text-terracotta-700">
        {error}
      </p>
    );
  }
  return hint ? (
    <p id={`${id}-msg`} className="text-small mt-2 opacity-70">
      {hint}
    </p>
  ) : null;
}

export function TextField({ label, hint, error, tone = "light", className, ...props }: FieldBase & ComponentProps<"input">) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="text-label block opacity-80">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint || error ? `${id}-msg` : undefined}
        className={clsx(control, controlTone[tone], error && "!border-terracotta-700")}
        {...props}
      />
      <Messages id={id} hint={hint} error={error} />
    </div>
  );
}

export function SelectField({ label, hint, error, tone = "light", className, children, ...props }: FieldBase & ComponentProps<"select">) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="text-label block opacity-80">
        {label}
      </label>
      <div className="relative">
        <select id={id} aria-describedby={hint || error ? `${id}-msg` : undefined} className={clsx(control, controlTone[tone], "appearance-none pr-8")} {...props}>
          {children}
        </select>
        <svg aria-hidden="true" viewBox="0 0 12 8" className="pointer-events-none absolute right-1 top-1/2 h-2 w-3 -translate-y-1/2" fill="none" stroke="currentColor" strokeWidth="1.25">
          <path d="m1 1.500 5 5 5-5" />
        </svg>
      </div>
      <Messages id={id} hint={hint} error={error} />
    </div>
  );
}

export function Checkbox({ label, className, ...props }: { label: string } & ComponentProps<"input">) {
  const id = useId();
  return (
    <div className={clsx("relative flex min-h-11 items-center gap-3", className)}>
      <input
        id={id}
        type="checkbox"
        className="peer size-5 shrink-0 appearance-none border border-current/50 transition-colors duration-200 checked:border-olive-700 checked:bg-olive-700"
        {...props}
      />
      <svg aria-hidden="true" viewBox="0 0 20 20" className="pointer-events-none absolute left-0 top-1/2 size-5 -translate-y-1/2 scale-0 text-ivory transition-transform duration-200 peer-checked:scale-100" fill="none" stroke="currentColor" strokeWidth="1.750">
        <path d="m5 10.500 3.200 3L15 6.500" />
      </svg>
      <label htmlFor={id} className="text-small">
        {label}
      </label>
    </div>
  );
}

type SizeOption = { value: string; label: string; disabled?: boolean };

/** Variant picker. A radio group, so arrow keys move between sizes. */
export function SizeSelector({ legend, options, value, onChange, tone = "light" }: { legend: string; options: SizeOption[]; value: string; onChange: (value: string) => void; tone?: "light" | "dark" }) {
  const name = useId();
  const dark = tone === "dark";
  return (
    <fieldset>
      <legend className="text-label mb-3 opacity-80">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={clsx(
              "text-label relative grid h-12 min-w-[5.5rem] cursor-pointer place-items-center border px-4 transition-colors duration-300",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-gold-500",
              "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-40 has-[:disabled]:line-through",
              dark
                ? "border-ivory/40 hover:border-ivory has-[:checked]:border-ivory has-[:checked]:bg-ivory has-[:checked]:text-olive-900"
                : "border-ink/30 hover:border-ink has-[:checked]:border-olive-700 has-[:checked]:bg-olive-700 has-[:checked]:text-ivory",
            )}
          >
            <input type="radio" name={name} value={option.value} checked={value === option.value} disabled={option.disabled} onChange={() => onChange(option.value)} className="sr-only" />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Uncontrolled by default; pass `value` to drive it from outside (the cart does). */
export function QuantityStepper({ label, min = 1, max = 24, defaultValue = 1, value: controlled, onChange }: { label?: string; min?: number; max?: number; defaultValue?: number; value?: number; onChange?: (value: number) => void }) {
  const { m } = useI18n();
  const [internal, setValue] = useState(defaultValue);
  const value = controlled ?? internal;
  const set = (next: number) => {
    const clamped = Math.min(max, Math.max(min, next));
    setValue(clamped);
    onChange?.(clamped);
  };
  return (
    <div role="group" aria-label={label ?? m.product.quantity} className="inline-flex h-13 items-center border border-ink/30">
      <button type="button" aria-label={m.product.decrease} disabled={value <= min} onClick={() => set(value - 1)} className="grid h-full w-12 place-items-center transition-colors hover:bg-ink/5 disabled:opacity-30">
        <MinusIcon className="size-4" />
      </button>
      <output aria-live="polite" className="w-10 text-center tabular-nums">
        {value}
      </output>
      <button type="button" aria-label={m.product.increase} disabled={value >= max} onClick={() => set(value + 1)} className="grid h-full w-12 place-items-center transition-colors hover:bg-ink/5 disabled:opacity-30">
        <PlusIcon className="size-4" />
      </button>
    </div>
  );
}
