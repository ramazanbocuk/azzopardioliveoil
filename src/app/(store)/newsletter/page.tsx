import type { Metadata } from "next";
import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Page";
import { getPrisma } from "@/server/db";
import { verifyLink } from "@/server/notifications/messages";

export const metadata: Metadata = { title: "Newsletter", robots: { index: false, follow: false } };

/** Applies a signed confirm or unsubscribe link from an email. */
async function Result({ searchParams }: Pick<PageProps<"/newsletter">, "searchParams">) {
  const params = await searchParams;
  const action = params.action === "confirm" || params.action === "unsubscribe" ? params.action : null;
  const id = typeof params.id === "string" ? params.id : "";
  const sig = typeof params.sig === "string" ? params.sig : "";

  let title = "This link is not valid.";
  let lead = "It may be incomplete or out of date. You can subscribe again from the foot of any page.";

  if (action && id && verifyLink(`newsletter-${action}`, id, sig)) {
    const db = getPrisma();
    if (action === "confirm") {
      const changed = await db.newsletterSubscriber.updateMany({ where: { id, status: { not: "UNSUBSCRIBED" } }, data: { status: "SUBSCRIBED", consentAt: new Date() } });
      if (changed.count === 1) {
        title = "You are subscribed.";
        lead = "Thank you. Letters from the grove will arrive a few times a year. Every one carries an unsubscribe link.";
      }
    } else {
      await db.newsletterSubscriber.updateMany({ where: { id }, data: { status: "UNSUBSCRIBED" } });
      title = "You are unsubscribed.";
      lead = "You will not receive any more letters from us.";
    }
  }

  return (
    <PageHeader eyebrow="Letters from the grove" title={title} lead={lead} size="h1">
      <ButtonLink href="/" variant="secondary" arrow className="mt-10">
        Back to the house
      </ButtonLink>
    </PageHeader>
  );
}

export default function NewsletterPage({ searchParams }: PageProps<"/newsletter">) {
  return (
    <Suspense fallback={<div className="min-h-svh" />}>
      <Result searchParams={searchParams} />
    </Suspense>
  );
}
