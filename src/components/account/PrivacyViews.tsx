"use client";

import { useApolloClient, useMutation } from "@apollo/client/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { errorMessage } from "@/lib/apollo";
import { CartQuery, DeleteMyAccount, MeQuery, MyDataQuery, RequestPasswordReset, ResetPassword } from "@/lib/operations";

/** "Forgot your password?" — asks for the address and always answers the same way. */
export function ForgotPassword() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [request, { loading }] = useMutation(RequestPasswordReset);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await request({ variables: { email: String(new FormData(event.currentTarget).get("resetEmail") ?? "") } });
      setMessage("If that address has an account, a reset link is on its way. It works for one hour.");
    } catch (cause) {
      setMessage(errorMessage(cause));
    }
  };

  if (!open) {
    return (
      <Button variant="text" onClick={() => setOpen(true)}>
        Forgot your password?
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="border-t border-ink/20 pt-6">
      <div className="flex flex-wrap items-end gap-4">
        <TextField label="Email address for the reset link" name="resetEmail" type="email" required autoComplete="email" className="min-w-64 flex-1" />
        <Button type="submit" variant="secondary" disabled={loading}>
          Send link
        </Button>
      </div>
      <p role="status" className="text-small mt-3 min-h-6 text-ink/80">
        {message}
      </p>
    </form>
  );
}

/** Reached from the emailed link. The link itself proves the request; the page only collects the new password. */
export function ResetPasswordView() {
  const params = useSearchParams();
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [reset, { loading }] = useMutation(ResetPassword);
  const link = { id: params.get("id") ?? "", exp: params.get("exp") ?? "", sig: params.get("sig") ?? "" };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get("password") !== data.get("confirm")) {
      setError("The two passwords do not match.");
      return;
    }
    setError("");
    try {
      await reset({ variables: { ...link, password: String(data.get("password") ?? "") } });
      setDone(true);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  if (done) {
    return (
      <div>
        <p className="text-lead text-ink/80">Your password has been changed and every device has been signed out.</p>
        <ButtonLink href="/account" arrow className="mt-8">
          Sign in
        </ButtonLink>
      </div>
    );
  }
  if (!link.id || !link.exp || !link.sig) {
    return (
      <p className="text-lead text-ink/80">
        This link is incomplete. Request a new one from the{" "}
        <Link href="/account" className="underline underline-offset-4">
          sign-in page
        </Link>
        .
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="max-w-md space-y-6">
      <TextField label="New password" name="password" type="password" required minLength={12} autoComplete="new-password" hint="At least 12 characters." />
      <TextField label="Repeat new password" name="confirm" type="password" required minLength={12} autoComplete="new-password" />
      <Button type="submit" arrow disabled={loading}>
        Change password
      </Button>
      <p role="alert" className="text-small min-h-6 text-terracotta-700">
        {error}
      </p>
    </form>
  );
}

/** GDPR self-service: download everything held about you, or erase your account. */
export function YourData() {
  const client = useApolloClient();
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [remove, { loading }] = useMutation(DeleteMyAccount);

  const download = async () => {
    setMessage("");
    try {
      const { data } = await client.query({ query: MyDataQuery, fetchPolicy: "network-only" });
      const url = URL.createObjectURL(new Blob([data?.myData ?? ""], { type: "application/json" }));
      const anchor = Object.assign(document.createElement("a"), { href: url, download: "azzopardi-my-data.json" });
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setMessage(errorMessage(cause));
    }
  };

  const erase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await remove({ variables: { password: String(new FormData(event.currentTarget).get("currentPassword") ?? "") } });
      await client.refetchQueries({ include: [MeQuery, CartQuery] });
    } catch (cause) {
      setMessage(errorMessage(cause));
    }
  };

  return (
    <section aria-labelledby="your-data-title" className="mt-16 border-t border-ink/20 pt-10">
      <h2 id="your-data-title" className="text-h3">
        Your data
      </h2>
      <p className="mt-3 max-w-[64ch] text-ink/80">You can download everything we hold about you, or delete your account. Deleting removes your name, email, addresses, favourites and reviews. Past orders are kept without your account, because invoices must be retained by law.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="secondary" onClick={download}>
          Download my data
        </Button>
        {!confirming && (
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            Delete my account
          </Button>
        )}
      </div>
      {confirming && (
        <form onSubmit={erase} className="mt-6 flex max-w-xl flex-wrap items-end gap-4 border border-terracotta-700/50 p-5">
          <TextField label="Enter your password to confirm" name="currentPassword" type="password" required autoComplete="current-password" className="min-w-56 flex-1" />
          <Button type="submit" disabled={loading}>
            Delete permanently
          </Button>
          <Button variant="text" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </form>
      )}
      <p role="alert" className="text-small mt-3 min-h-6 text-terracotta-700">
        {message}
      </p>
    </section>
  );
}

// ── Cookie notice ──

const CONSENT_KEY = "azz.cookie-notice.v1";
const listeners = new Set<() => void>();

function readNotice(): string | null {
  try {
    return window.localStorage.getItem(CONSENT_KEY);
  } catch {
    return "unavailable";
  }
}

/**
 * Whether the visitor has agreed to optional (analytics or marketing) storage.
 * Always false today: the site sets none. Any future optional script must
 * check this before loading, and the notice below must then offer the choice.
 */
export function hasOptionalConsent(): boolean {
  return false;
}

/**
 * The site uses only strictly necessary storage (cart, sign-in), which needs
 * no consent, so this is an information notice rather than a consent wall.
 */
export function CookieNotice() {
  const seen = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readNotice,
    () => "server",
  );
  if (seen) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(CONSENT_KEY, new Date().toISOString());
    } catch {
      // Storage unavailable: the notice simply shows again next visit.
    }
    listeners.forEach((listener) => listener());
  };

  return (
    <aside aria-label="Cookie notice" className="fixed inset-x-4 bottom-4 z-[55] mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-x-6 gap-y-3 border border-ink/15 bg-ivory p-5 shadow-[0_20px_50px_-25px_rgb(0_0_0/0.5)] sm:inset-x-auto sm:right-6">
      <p className="text-small max-w-[46ch]">
        This site uses only the cookies needed for your cart and sign-in. No tracking, no advertising.{" "}
        <Link href="/cookie-policy" className="underline underline-offset-4">
          Cookie policy
        </Link>
      </p>
      <Button size="sm" onClick={dismiss}>
        Understood
      </Button>
    </aside>
  );
}
