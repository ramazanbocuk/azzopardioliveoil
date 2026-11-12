import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetPasswordView } from "@/components/account/PrivacyViews";
import { PageHeader } from "@/components/ui/Page";

export const metadata: Metadata = { title: "Reset password", robots: { index: false, follow: false } };

export default function ResetPasswordPage() {
  return (
    <>
      <PageHeader eyebrow="Account" title="Choose a new password" size="h1" />
      <section className="container-page pb-section">
        <Suspense fallback={<p className="text-stone-700">Loading…</p>}>
          <ResetPasswordView />
        </Suspense>
      </section>
    </>
  );
}
