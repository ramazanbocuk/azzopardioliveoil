import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetPasswordView } from "@/components/account/PrivacyViews";
import { PageHeader } from "@/components/ui/Page";
import { getI18n } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.account.resetMetaTitle, robots: { index: false, follow: false } };
}

export default async function ResetPasswordPage() {
  const { m } = await getI18n();
  return (
    <>
      <PageHeader eyebrow={m.account.eyebrow} title={m.account.resetTitle} size="h1" />
      <section className="container-page pb-section">
        <Suspense fallback={<p className="text-stone-700">{m.common.loading}</p>}>
          <ResetPasswordView />
        </Suspense>
      </section>
    </>
  );
}
