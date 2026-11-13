import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { PasswordField } from "@/components/admin/PasswordField";
import { SignInError } from "@/components/admin/SignInError";
import { Field, Submit } from "@/components/admin/ui";
import { switzer, zodiak } from "@/lib/fonts";
import { adminCtx } from "@/server/adminSession";
import "../globals.css";
import { signIn, signOut } from "./actions";

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
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/discounts", label: "Discounts & coupons" },
  { href: "/admin/marketing", label: "Marketing" },
  { href: "/admin/wholesale", label: "Wholesale / B2B" },
  { href: "/admin/returns", label: "Returns & refunds" },
  { href: "/admin/reviews", label: "Reviews" },
  { href: "/admin/reports", label: "Analytics & reports" },
  { href: "/admin/accounting", label: "Accounting & VAT" },
  { href: "/admin/suppliers", label: "Suppliers" },
  { href: "/admin/traceability", label: "Food traceability" },
  { href: "/admin/content", label: "Website content" },
  { href: "/admin/translations", label: "Translations" },
  { href: "/admin/notifications", label: "Notifications" },
  { href: "/admin/staff", label: "Staff & permissions" },
  { href: "/admin/security", label: "Security" },
  { href: "/admin/integrations", label: "Integrations" },
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
          <Field label="Authenticator code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} hint="Only if you have turned on two-factor sign-in." />
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

/** Nothing below this renders without a valid admin session; services re-check on every call. */
async function Gate({ children }: { children: ReactNode }) {
  const ctx = await adminCtx();
  if (!ctx.admin) return <SignIn />;

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
