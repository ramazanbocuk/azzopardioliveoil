"use client";

import { useSearchParams } from "next/navigation";

/** The sign-in form lives in the layout, which cannot read the address; this shows why the last attempt failed, or what the last step did. */
export function SignInError() {
  const query = useSearchParams();
  const error = query.get("error");
  const ok = query.get("ok");
  if (!error && ok)
    return (
      <p role="status" className="mt-6 border-l-2 border-olive-700 bg-olive-100/60 px-4 py-3 text-olive-900">
        {ok}
      </p>
    );
  if (!error) return null;
  return (
    <p role="alert" className="mt-6 border-l-2 border-terracotta-700 bg-terracotta-500/10 px-4 py-3 text-terracotta-700">
      {error}
    </p>
  );
}
