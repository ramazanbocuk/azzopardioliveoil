import type { Metadata } from "next";
import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Page";
import { getI18n } from "@/i18n/server";
import { getPrisma } from "@/server/db";
import { verifyLink } from "@/server/notifications/messages";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.newsletter.metaTitle, robots: { index: false, follow: false } };
}

/** Applies a signed confirm or unsubscribe link from an email. */
async function Result({ searchParams }: Pick<PageProps<"/[locale]/newsletter">, "searchParams">) {
  const params = await searchParams;
  const { m } = await getI18n();
  const n = m.newsletter;
  const action = params.action === "confirm" || params.action === "unsubscribe" ? params.action : null;
  const id = typeof params.id === "string" ? params.id : "";
  const sig = typeof params.sig === "string" ? params.sig : "";

  let title = n.invalidTitle;
  let lead = n.invalidLead;

  if (action && id && verifyLink(`newsletter-${action}`, id, sig)) {
    const db = getPrisma();
    if (action === "confirm") {
      const changed = await db.newsletterSubscriber.updateMany({ where: { id, status: { not: "UNSUBSCRIBED" } }, data: { status: "SUBSCRIBED", consentAt: new Date() } });
      if (changed.count === 1) {
        title = n.subscribedTitle;
        lead = n.subscribedLead;
      }
    } else {
      await db.newsletterSubscriber.updateMany({ where: { id }, data: { status: "UNSUBSCRIBED" } });
      title = n.unsubscribedTitle;
      lead = n.unsubscribedLead;
    }
  }

  return (
    <PageHeader eyebrow={n.eyebrow} title={title} lead={lead} size="h1">
      <ButtonLink href="/" variant="secondary" arrow className="mt-10">
        {m.common.backHome}
      </ButtonLink>
    </PageHeader>
  );
}

export default function NewsletterPage({ searchParams }: PageProps<"/[locale]/newsletter">) {
  return (
    <Suspense fallback={<div className="min-h-svh" />}>
      <Result searchParams={searchParams} />
    </Suspense>
  );
}
