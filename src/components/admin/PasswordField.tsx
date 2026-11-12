"use client";

import { useState, type ComponentProps } from "react";

/** Password input with a button to reveal what was typed, so a mistyped character can be seen. */
export function PasswordField({ label, ...props }: { label: string } & Omit<ComponentProps<"input">, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <label className="block">
      <span className="text-small font-medium">{label}</span>
      <span className="relative mt-1.5 block">
        <input {...props} type={shown ? "text" : "password"} className="h-10 w-full border border-ink/25 bg-white pl-3 pr-20 text-[0.9375rem] outline-none transition-colors hover:border-ink/50 focus:border-olive-700 focus:shadow-[0_0_0_1px_var(--color-olive-700)]" />
        <button type="button" onClick={() => setShown((value) => !value)} aria-pressed={shown} className="text-small absolute inset-y-0 right-0 px-3 font-medium text-olive-900 underline underline-offset-4">
          {shown ? "Hide" : "Show"}
          <span className="sr-only"> password</span>
        </button>
      </span>
    </label>
  );
}
