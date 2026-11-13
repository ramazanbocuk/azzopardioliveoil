import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { PasswordField } from "@/components/admin/PasswordField";
import { SignInError } from "@/components/admin/SignInError";
import { Field, Submit } from "@/components/admin/ui";
import { switzer, zodiak } from "@/lib/fonts";
import { adminCtx } from "@/server/adminSession";
import { mustEnrol } from "@/server/auth";
import { pendingTotp } from "@/server/twoFactor";
import "../globals.css";
import { beginTwoFactor, confirmTwoFactor, signIn, signOut } from "./actions";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s — Azzopardi Admin" },
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/inventory", label: "Inventory" },
  { href: "/admin/customers", label: "Customers" },
  { href: "/admin/fulfilment", label: "Shipping & fulfilment" },
  { href: "/admin/backorders", label: "Backorders" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/discounts", label: "Discounts & coupons" },
  { href: "/admin/marketing", label: "Marketing" },
  { href: "/admin/wholesale", label: "Wholesale / B2B" },
  { href: "/admin/returns", label: "Returns & refunds" },
  { href: "/admin/reviews", label: "Reviews" },
  { href: "/admin/reports", label: "Analytics & reports" },
  { href: "/admin/accounting", label: "Accounting & VAT" },
  { href: "/admin/suppliers", label: "Suppliers" },
  { href: "/admin/producers", label: "Producers" },
  { href: "/admin/regions", label: "Countries & regions" },
  { href: "/admin/varieties", label: "Olive varieties" },
  { href: "/admin/lots", label: "Harvest batches" },
  { href: "/admin/lab", label: "Laboratory results" },
  { href: "/admin/traceability", label: "Food traceability" },
  { href: "/admin/content", label: "Website content" },
  { href: "/admin/translations", label: "Translations" },
  { href: "/admin/staff-assistant", label: "Staff assistant" },
  { href: "/admin/assistant", label: "Customer assistant" },
  { href: "/admin/knowledge", label: "Knowledge base" },
  { href: "/admin/support", label: "Support requests" },
  { href: "/admin/notifications", label: "Notifications" },
  { href: "/admin/staff", label: "Staff & permissions" },
  { href: "/admin/security", label: "Security" },
  { href: "/admin/integrations", label: "Integrations" },
  { href: "/admin/markets", label: "Markets & currencies" },
  { href: "/admin/settings", label: "System settings" },
];

function SignIn() {
  return (
    <div className="grid min-h-svh place-items-center bg-[#f3f1ea] px-5 font-sans text-ink">
      <form action={signIn} className="w-full max-w-sm border border-ink/10 bg-white p-8">
        <p className="font-serif text-[1.25rem] uppercase tracking-[0.2em]">Azzopardi</p>
        <h1 className="mt-6 font-serif text-[1.75rem]">Staff sign-in</h1>
        <Suspense>
          <SignInError />
        </Suspense>
        <div className="mt-6 space-y-4">
          <Field label="Email address" name="email" type="email" required autoComplete="username" />
          <PasswordField label="Password" name="password" required autoComplete="current-password" />
          <Field label="Authenticator code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} hint="Needed once you have set up two-factor sign-in. On your first sign-in, leave it empty: you will set it up next." />
        </div>
        <Submit className="mt-6 w-full">Sign in</Submit>
        <p className="text-small mt-4 text-stone-700">Sign-in attempts are limited and recorded.</p>
        <p className="text-small mt-6 text-stone-700">
          <Link href="/" className="underline underline-offset-4">
            Back to the shop
          </Link>
        </p>
      </form>
    </div>
  );
}

/** The only screen a signed-in member of staff sees until their second factor is confirmed. */
function SetUpTwoFactor({ name, pending }: { name: string; pending: { secret: string } | null }) {
  return (
    <div className="grid min-h-svh place-items-center bg-[#f3f1ea] px-5 py-10 font-sans text-ink">
      <div className="w-full max-w-lg border border-ink/10 bg-white p-8">
        <p className="font-serif text-[1.25rem] uppercase tracking-[0.2em]">Azzopardi</p>
        <h1 className="mt-6 font-serif text-[1.75rem]">Set up two-factor sign-in</h1>
        <p className="mt-4">
          {name}, every staff account needs a second step at sign-in: a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password, Authy). The admin panel opens once it is set up.
        </p>
        <Suspense>
          <SignInError />
        </Suspense>
        {pending ? (
          <div className="mt-6 space-y-5">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Open your authenticator app and choose to add an account by entering a setup key.</li>
              <li>
                Enter this key (type: time-based):
                <code className="mt-2 block w-fit select-all break-all border border-ink/20 bg-stone-300/30 px-3 py-2 font-mono text-[0.9375rem] tracking-wider">{pending.secret.match(/.{1,4}/g)?.join(" ")}</code>
              </li>
              <li>Enter the 6-digit code the app now shows.</li>
            </ol>
            <form action={confirmTwoFactor} className="flex flex-wrap items-end gap-4">
              <Field label="Code from the app" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required className="w-48" />
              <Submit>Finish</Submit>
            </form>
          </div>
        ) : (
          <form action={beginTwoFactor} className="mt-6">
            <Submit>Start</Submit>
          </form>
        )}
        <p className="text-small mt-6 text-stone-700">If you lose your phone, an administrator can reset this for you under Security.</p>
        <form action={signOut} className="mt-4">
          <button type="submit" className="text-small underline underline-offset-4">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

/** Nothing below this renders without a valid admin session; services re-check on every call. */
async function Gate({ children }: { children: ReactNode }) {
  const ctx = await adminCtx();
  if (!ctx.admin) return <SignIn />;
  // No part of the panel is shown to a member of staff who has no second factor yet. The services refuse them too.
  if (mustEnrol(ctx.admin)) return <SetUpTwoFactor name={ctx.admin.name} pending={await pendingTotp(ctx)} />;

  return (
    <div className="min-h-svh bg-[#f3f1ea] font-sans text-ink lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="bg-olive-950 text-ivory print:hidden lg:sticky lg:top-0 lg:h-svh lg:overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-5">
          <Link href="/admin" className="font-serif text-[1.125rem] uppercase tracking-[0.2em]">
            Azzopardi
          </Link>
          <span className="text-[0.625rem] uppercase tracking-[0.2em] text-gold-300">Admin</span>
        </div>
        <nav aria-label="Admin" className="px-2 pb-4">
          <ul className="flex gap-1 overflow-x-auto lg:block lg:space-y-0.5">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="block whitespace-nowrap px-3 py-2.5 text-[0.9375rem] text-ivory/85 transition-colors hover:bg-ivory/10 hover:text-ivory">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-ivory/15 px-5 py-4 text-[0.8125rem]">
          <p>{ctx.admin.name}</p>
          <p className="text-ivory/60">{ctx.admin.role.toLowerCase()}</p>
          <form action={signOut} className="mt-3">
            <button type="submit" className="underline underline-offset-4 hover:text-gold-300">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Root layout of the admin panel. The storefront has its own, under a locale; the two share nothing but the stylesheet. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${zodiak.variable} ${switzer.variable} antialiased`}>
      <body className="flex min-h-svh flex-col">
        <Suspense fallback={<div className="min-h-svh bg-[#f3f1ea]" />}>
          <Gate>{children}</Gate>
        </Suspense>
      </body>
    </html>
  );
}
