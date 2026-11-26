"use client";

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Which of the three signed-out forms to show. They live in the layout, which
 * cannot read the address, so the choice is made here: `?forgot=1` asks for a
 * reset link, a link from that email (`?reset=…`) chooses the new password,
 * and anything else is the sign-in form.
 */
export function SignedOut({ signIn, forgot, reset }: { signIn: ReactNode; forgot: ReactNode; reset: ReactNode }) {
  const query = useSearchParams();
  if (query.get("reset")) return reset;
  return query.get("forgot") ? forgot : signIn;
}

/** Carries the emailed link's three parts back to the server with the new password. */
export function ResetLinkFields() {
  const query = useSearchParams();
  return (
    <>
      <input type="hidden" name="id" value={query.get("reset") ?? ""} />
      <input type="hidden" name="exp" value={query.get("exp") ?? ""} />
      <input type="hidden" name="sig" value={query.get("sig") ?? ""} />
    </>
  );
}
