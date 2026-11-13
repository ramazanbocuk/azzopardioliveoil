import { ENGLISH_ONLY } from "@/i18n/seo";
import { localizedMetadata } from "@/i18n/server";
import { ButtonLink } from "@/components/ui/Button";
import { Accordion, PageHeader } from "@/components/ui/Page";
import { faq } from "@/content/site";

// The text of this page exists in English only for now, so it is not announced as translated.
export const generateMetadata = localizedMetadata("/faq", {
  title: "FAQ",
  description: "Answers about the oil, ordering, shipping and returns.",
}, ENGLISH_ONLY);

export default function FaqPage() {
  return (
    <>
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
