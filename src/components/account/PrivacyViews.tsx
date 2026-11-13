"use client";

import { useApolloClient, useMutation } from "@apollo/client/react";
import { Link } from "@/components/ui/Link";
import { useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { errorMessage } from "@/lib/apollo";
import { useI18n } from "@/i18n/client";
import { CartQuery, DeleteMyAccount, MeQuery, MyDataQuery, RequestPasswordReset, ResetPassword } from "@/lib/operations";

/** "Forgot your password?" — asks for the address and always answers the same way. */
export function ForgotPassword() {
  const { m, server } = useI18n();
  const a = m.account;
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [request, { loading }] = useMutation(RequestPasswordReset);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await request({ variables: { email: String(new FormData(event.currentTarget).get("resetEmail") ?? "") } });
      setMessage(a.resetSent);
    } catch (cause) {
      setMessage(server(errorMessage(cause)));
    }
  };

  if (!open) {
    return (
      <Button variant="text" onClick={() => setOpen(true)}>
        {a.forgot}
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="border-t border-ink/20 pt-6">
      <div className="flex flex-wrap items-end gap-4">
        <TextField label={a.resetEmail} name="resetEmail" type="email" required autoComplete="email" className="min-w-64 flex-1" />
        <Button type="submit" variant="secondary" disabled={loading}>
          {a.sendLink}
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
  const { m, server } = useI18n();
  const a = m.account;
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [reset, { loading }] = useMutation(ResetPassword);
  const link = { id: params.get("id") ?? "", exp: params.get("exp") ?? "", sig: params.get("sig") ?? "" };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get("password") !== data.get("confirm")) {
      setError(a.mismatch);
      return;
    }
    setError("");
    try {
      await reset({ variables: { ...link, password: String(data.get("password") ?? "") } });
      setDone(true);
    } catch (cause) {
      setError(server(errorMessage(cause)));
    }
  };

  if (done) {
    return (
      <div>
        <p className="text-lead text-ink/80">{a.changed}</p>
        <ButtonLink href="/account" arrow className="mt-8">
          {a.signIn}
        </ButtonLink>
      </div>
    );
  }
  if (!link.id || !link.exp || !link.sig) {
    return (
      <p className="text-lead text-ink/80">
        {a.incompleteLink.split("{link}")[0]}
        <Link href="/account" className="underline underline-offset-4">
          {a.signInPage}
        </Link>
        {a.incompleteLink.split("{link}")[1]}
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="max-w-md space-y-6">
      <TextField label={a.newPassword} name="password" type="password" required minLength={12} autoComplete="new-password" hint={a.passwordHint} />
      <TextField label={a.repeatPassword} name="confirm" type="password" required minLength={12} autoComplete="new-password" />
      <Button type="submit" arrow disabled={loading}>
        {a.changePassword}
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
  const { m, server } = useI18n();
  const a = m.account;
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
      setMessage(server(errorMessage(cause)));
    }
  };

  const erase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await remove({ variables: { password: String(new FormData(event.currentTarget).get("currentPassword") ?? "") } });
      await client.refetchQueries({ include: [MeQuery, CartQuery] });
    } catch (cause) {
      setMessage(server(errorMessage(cause)));
    }
  };

  return (
    <section aria-labelledby="your-data-title" className="mt-16 border-t border-ink/20 pt-10">
      <h2 id="your-data-title" className="text-h3">
        {a.dataTitle}
      </h2>
      <p className="mt-3 max-w-[64ch] text-ink/80">{a.dataText}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="secondary" onClick={download}>
          {a.download}
        </Button>
        {!confirming && (
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            {a.deleteAccount}
          </Button>
        )}
      </div>
      {confirming && (
        <form onSubmit={erase} className="mt-6 flex max-w-xl flex-wrap items-end gap-4 border border-terracotta-700/50 p-5">
          <TextField label={a.confirmPassword} name="currentPassword" type="password" required autoComplete="current-password" className="min-w-56 flex-1" />
          <Button type="submit" disabled={loading}>
            {a.deletePermanently}
          </Button>
          <Button variant="text" onClick={() => setConfirming(false)}>
            {m.common.cancel}
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
  const { m } = useI18n();
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
    <aside aria-label={m.cookie.label} className="fixed inset-x-4 bottom-4 z-[55] mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-x-6 gap-y-3 border border-ink/15 bg-ivory p-5 shadow-[0_20px_50px_-25px_rgb(0_0_0/0.5)] sm:inset-x-auto sm:right-6">
      <p className="text-small max-w-[46ch]">
        {m.cookie.text}{" "}
        <Link href="/cookie-policy" className="underline underline-offset-4">
          {m.cookie.policy}
        </Link>
      </p>
      <Button size="sm" onClick={dismiss}>
        {m.cookie.ok}
      </Button>
    </aside>
  );
}
