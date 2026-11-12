"use client";

import { useSearchParams } from "next/navigation";

/** The sign-in form lives in the layout, which cannot read the address; this shows why the last attempt failed. */
export function SignInError() {
  const error = useSearchParams().get("error");
  if (!error) return null;
  return (
    <p role="alert" className="mt-6 border-l-2 border-terracotta-700 bg-terracotta-500/10 px-4 py-3 text-terracotta-700">
      {error}
    </p>
  );
}
