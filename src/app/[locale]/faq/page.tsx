import { ENGLISH_ONLY } from "@/i18n/seo";
import { localizedMetadata } from "@/i18n/server";
import { ButtonLink } from "@/components/ui/Button";
import { Accordion, PageHeader } from "@/components/ui/Page";
import { JsonLd } from "@/components/ui/JsonLd";
import { faq } from "@/content/site";

// The text of this page exists in English only for now, so it is not announced as translated.
export const generateMetadata = localizedMetadata("/faq", {
  title: "Olive oil questions, answered",
  description: "What extra virgin means, what polyphenols are, how to read a lot number, and how ordering, delivery and returns work at Azzopardi.",
}, ENGLISH_ONLY);

export default function FaqPage() {
  return (
    <>
      {/* The same questions and answers as on the page, in the form search engines read. */}
      <JsonLd data={{ "@context": "https://schema.org", "@type": "FAQPage", inLanguage: "en", mainEntity: faq.flatMap((group) => group.items).map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })) }} />
      <PageHeader eyebrow="Help" title="Questions, answered plainly." size="h1" lead="If yours is not here, write to us." />
      <section className="container-page space-y-section-sm pb-section">
        {faq.map((group) => (
          <div key={group.group} className="grid gap-x-8 gap-y-6 lg:grid-cols-12">
            <h2 className="text-h2 lg:col-span-4">{group.group}</h2>
            <div className="lg:col-span-7 lg:col-start-6">
              <Accordion name={`faq-${group.group}`} items={group.items.map((item) => ({ title: item.q, content: <p>{item.a}</p> }))} />
            </div>
          </div>
        ))}
        <div className="border-t border-ink/20 pt-10">
          <p className="text-h3">Still looking for an answer?</p>
          <ButtonLink href="/contact" variant="secondary" arrow className="mt-6">
            Contact us
          </ButtonLink>
        </div>
      </section>
    </>
  );
}
