import type { Metadata } from "next";
import { Link } from "@/components/ui/Link";
import { ContactForm } from "@/components/account/AccountViews";
import { FactList, Notice, PageHeader } from "@/components/ui/Page";
import { alternatesFor } from "@/i18n/seo";
import { getI18n } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { m, locale } = await getI18n();
  return { title: m.contact.metaTitle, description: m.contact.metaDescription, alternates: alternatesFor(locale, "/contact") };
}

export default async function ContactPage() {
  const { m } = await getI18n();
  const c = m.contact;
  const [before, between, after] = c.faqText.split(/\{faq\}|\{tracking\}/);
  return (
    <>
      <PageHeader eyebrow={c.eyebrow} title={c.title} size="h1" lead={c.lead} />
      <section className="container-page grid gap-x-8 gap-y-14 pb-section lg:grid-cols-12">
        <div className="lg:col-span-6">
          <ContactForm />
        </div>
        <div className="lg:col-span-4 lg:col-start-9">
          <h2 className="text-h3">{c.details}</h2>
          <div className="mt-5">
            <FactList
              rows={[
                { label: c.emailLabel, value: null },
                { label: "WhatsApp", value: null },
                { label: c.company, value: null },
                { label: c.address, value: null },
                { label: c.vat, value: null },
              ]}
            />
          </div>
          <Notice title={c.todoTitle} className="mt-8">
            {c.todoText}
          </Notice>
          <p className="text-small mt-8 text-ink/80">
            {before}
            <Link href="/faq" className="underline underline-offset-4">
              {c.faq}
            </Link>
            {between}
            <Link href="/order-tracking" className="underline underline-offset-4">
              {c.trackingPage}
            </Link>
            {after}
          </p>
        </div>
      </section>
    </>
  );
}
