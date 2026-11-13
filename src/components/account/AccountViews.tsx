"use client";

import { useApolloClient, useMutation, useQuery } from "@apollo/client/react";
import clsx from "clsx";
import { useState, type FormEvent } from "react";
import { OrderSummary, OrderTimeline } from "@/components/shop/OrderViews";
import { ForgotPassword, YourData } from "./PrivacyViews";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Checkbox, TextField } from "@/components/ui/Field";
import { ProductCard } from "@/components/ui/ProductCard";
import type { CatalogItem } from "@/content/site";
import type { OrderFieldsFragment } from "@/gql/graphql";
import { errorMessage } from "@/lib/apollo";
import { useI18n } from "@/i18n/client";
import { CartQuery, Login, Logout, MeQuery, Register, RequestReturn, SendContactMessage } from "@/lib/operations";
import { useFavourites, useHydrated } from "@/lib/store";

/** Sign in or create an account. Passwords go only to the API over the same origin, and are stored as Argon2id hashes. */
function AuthPanel() {
  const client = useApolloClient();
  const { m, server } = useI18n();
  const a = m.account;
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [login] = useMutation(Login);
  const [register] = useMutation(Register);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const field = (name: string) => String(data.get(name) ?? "");
    setBusy(true);
    setError("");
    try {
      if (mode === "signin") await login({ variables: { email: field("email"), password: field("password") } });
      else await register({ variables: { input: { email: field("email"), password: field("password"), firstName: field("firstName"), lastName: field("lastName") } } });
      // The session cookie is set; the signed-in view and the cart now belong to the account.
      await client.refetchQueries({ include: [MeQuery, CartQuery] });
    } catch (cause) {
      setError(server(errorMessage(cause)));
    } finally {
      setBusy(false);
    }
  };

  const tab = (value: typeof mode, label: string) => (
    <button
      type="button"
      role="tab"
      id={`tab-${value}`}
      aria-selected={mode === value}
      aria-controls="auth-panel"
      onClick={() => {
        setMode(value);
        setError("");
      }}
      className={clsx("text-label -mb-px h-12 border-b-2 px-1 transition-colors duration-300", mode === value ? "border-olive-700 text-ink" : "border-transparent text-stone-700 hover:text-ink")}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div role="tablist" aria-label={a.eyebrow} className="flex gap-8 border-b border-ink/20">
        {tab("signin", a.signIn)}
        {tab("register", a.create)}
      </div>

      <form id="auth-panel" role="tabpanel" aria-labelledby={`tab-${mode}`} onSubmit={submit} className="mt-8 space-y-6">
        {mode === "register" && (
          <div className="grid gap-6 sm:grid-cols-2">
            <TextField label={m.checkout.firstName} name="firstName" required autoComplete="given-name" />
            <TextField label={m.checkout.lastName} name="lastName" required autoComplete="family-name" />
          </div>
        )}
        <TextField label={m.checkout.email} name="email" type="email" required autoComplete="email" />
        <TextField
          label={a.password}
          name="password"
          type="password"
          required
          minLength={mode === "register" ? 12 : undefined}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          hint={mode === "register" ? a.passwordHint : undefined}
        />
        {mode === "register" && <Checkbox label={a.privacyRead} name="privacy" required />}
        <Button type="submit" arrow disabled={busy}>
          {mode === "register" ? a.create : a.signIn}
        </Button>
        <p role="alert" className="text-small min-h-6 text-terracotta-700">
          {error}
        </p>
      </form>
      {mode === "signin" && <ForgotPassword />}
    </div>
  );
}

function ReturnForm({ number }: { number: string }) {
  const { m, server } = useI18n();
  const a = m.account;
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [requestReturn, { loading }] = useMutation(RequestReturn, { refetchQueries: [MeQuery] });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await requestReturn({ variables: { number, reason: String(new FormData(event.currentTarget).get("reason") ?? "") } });
      setMessage(a.returnRequested);
      setOpen(false);
    } catch (cause) {
      setMessage(server(errorMessage(cause)));
    }
  };

  return (
    <div className="mt-6">
      {!open && (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          {a.requestReturn}
        </Button>
      )}
      {open && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-4">
          <TextField label={a.returnReason} name="reason" required minLength={10} maxLength={1000} className="min-w-64 flex-1" />
          <Button type="submit" size="sm" disabled={loading}>
            {a.sendRequest}
          </Button>
        </form>
      )}
      <p role="status" className="text-small mt-2 min-h-5 text-terracotta-700">
        {message}
      </p>
    </div>
  );
}

function Orders({ orders }: { orders: OrderFieldsFragment[] }) {
  const { m, date, money } = useI18n();
  if (orders.length === 0) {
    return (
      <div className="border border-dashed border-ink/30 px-6 py-16 text-center">
        <p className="text-h3">{m.account.noOrders}</p>
        <ButtonLink href="/shop" variant="secondary" arrow className="mt-6">
          {m.common.shopCta}
        </ButtonLink>
      </div>
    );
  }
  return (
    <ul className="border-t border-ink/20">
      {orders.map((order) => (
        <li key={order.number} className="border-b border-ink/20">
          <details className="group/order">
            <summary className="flex min-h-16 cursor-pointer list-none flex-wrap items-center justify-between gap-x-8 gap-y-1 py-4 [&::-webkit-details-marker]:hidden">
              <span className="text-h3 !text-[1.25rem]">{order.number}</span>
              <span className="text-small text-stone-700">{date(order.placedAt)}</span>
              <span className="text-label">{(m.order.status as Record<string, string>)[order.status] ?? order.status}</span>
              <span className="tabular-nums">{money(order.totalCents)}</span>
            </summary>
            <div className="grid gap-x-12 gap-y-8 pb-8 md:grid-cols-2">
              <OrderSummary order={order} />
              <div>
                <OrderTimeline order={order} />
                {order.canRequestReturn && <ReturnForm number={order.number} />}
              </div>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}


/** The account page: sign-in forms for visitors, orders and sign-out for customers. */
export function AccountView() {
  const hydrated = useHydrated();
  const client = useApolloClient();
  const { m } = useI18n();
  const a = m.account;
  const features = [a.feature1, a.feature2, a.feature3];
  const { data, loading } = useQuery(MeQuery, { skip: !hydrated, fetchPolicy: "cache-and-network" });
  const [logout] = useMutation(Logout);

  if (!hydrated || (loading && !data)) return <p className="text-lead py-20 text-stone-700">{a.loading}</p>;

  const me = data?.me;
  if (!me) {
    return (
      <div className="grid gap-x-8 gap-y-14 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <AuthPanel />
        </div>
        <div className="lg:col-span-5 lg:col-start-8">
          <h2 className="text-h3">{a.withAccount}</h2>
          <ul className="mt-5 border-t border-ink/20">
            {features.map((feature) => (
              <li key={feature} className="border-b border-ink/20 py-4">
                {feature}
              </li>
            ))}
          </ul>
          <p className="text-small mt-5 text-stone-700">{a.guest}</p>
        </div>
      </div>
    );
  }

  const signOut = async () => {
    await logout();
    await client.refetchQueries({ include: [MeQuery, CartQuery] });
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-ink/20 pb-8">
        <div>
          <p className="text-h2">
            {me.firstName} {me.lastName}
          </p>
          <p className="mt-2 text-stone-700">{me.email}</p>
        </div>
        <Button variant="secondary" onClick={signOut}>
          {a.signOut}
        </Button>
      </div>
      <h2 className="text-h2 mt-12">{a.yourOrders}</h2>
      <div className="mt-8">
        <Orders orders={me.orders} />
      </div>
      <YourData />
    </div>
  );
}

export function FavouritesList({ items }: { items: CatalogItem[] }) {
  const hydrated = useHydrated();
  const saved = useFavourites();
  const { m } = useI18n();
  const matches = items.filter((item) => saved.includes(item.variant.sku));

  if (!hydrated) return <p className="text-stone-700">{m.account.loadingFavourites}</p>;

  if (matches.length === 0) {
    return (
      <div className="border border-dashed border-ink/30 px-6 py-16 text-center">
        <p className="text-h3">{m.account.noFavourites}</p>
        <p className="mt-3 text-ink/80">{m.account.favouritesHint}</p>
        <ButtonLink href="/shop" variant="secondary" arrow className="mt-6">
          {m.common.shopCta}
        </ButtonLink>
      </div>
    );
  }

  return (
    <ul className="grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
      {matches.map((item) => (
        <li key={item.variant.sku}>
          <ProductCard item={item} />
        </li>
      ))}
    </ul>
  );
}

export function ContactForm() {
  const { m, server } = useI18n();
  const c = m.contact;
  const [message, setMessage] = useState("");
  const [send, { loading }] = useMutation(SendContactMessage);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const field = (name: string) => String(data.get(name) ?? "");
    try {
      await send({ variables: { name: field("name"), email: field("email"), reference: field("reference") || null, message: field("message") } });
      form.reset();
      setMessage(c.sent);
    } catch (cause) {
      setMessage(server(errorMessage(cause)));
    }
  };
  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField label={c.name} name="name" required autoComplete="name" />
        <TextField label={m.checkout.email} name="email" type="email" required autoComplete="email" />
      </div>
      <TextField label={c.reference} name="reference" autoComplete="off" />
      <div>
        <label htmlFor="contact-message" className="text-label block opacity-80">
          {c.message}
        </label>
        <textarea
          id="contact-message"
          name="message"
          required
          rows={6}
          className="mt-3 w-full border border-ink/35 bg-transparent p-4 outline-none transition-colors duration-300 hover:border-ink focus:border-ink focus:shadow-[0_0_0_1px_var(--color-ink)]"
        />
      </div>
      <Button type="submit" arrow disabled={loading}>
        {c.send}
      </Button>
      <p role="status" className="text-small min-h-6 text-terracotta-700">
        {message}
      </p>
    </form>
  );
}
