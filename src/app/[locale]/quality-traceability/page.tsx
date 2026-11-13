import { ENGLISH_ONLY } from "@/i18n/seo";
import { localizedMetadata } from "@/i18n/server";
import { Traceability } from "@/components/home/Sections";
import { DraftBand, NextPage, Points } from "@/components/ui/Editorial";
import { Accordion, FactList, Notice, PageHeader } from "@/components/ui/Page";
import { Reveal } from "@/motion/Reveal";
import { SplitHeading } from "@/motion/SplitHeading";

// The text of this page exists in English only for now, so it is not announced as translated.
export const generateMetadata = localizedMetadata("/quality-traceability", {
  title: "Quality & traceability",
  description: "How every bottle of Azzopardi olive oil is traced by its lot number.",
}, ENGLISH_ONLY);

export default function QualityTraceabilityPage() {
  return (
    <>
      <PageHeader eyebrow="Quality & traceability" title="Every bottle answers for itself." lead="A lot number is printed on each label. It leads to what was recorded for that lot, and to nothing we cannot back up." />
      <DraftBand>Lot lookup is live. No lots have been published yet, so every number currently returns “no published record”.</DraftBand>

      <Traceability />

      <Points
        tone="#f4efe4"
        eyebrow="How it works"
        title="From label to record in three steps."
        items={[
          { title: "Find the number", body: "It is on the label of your bottle and on your order confirmation." },
          { title: "Enter it", body: "Use the lot lookup on this page or scan the code on the bottle, once codes are printed." },
          { title: "Read the record", body: "Producer, harvest, mill, bottling date and any documents on file for that lot." },
        ]}
      />

      <section data-tone="#eae3d3" className="py-section">
        <div className="container-page grid gap-x-8 gap-y-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Reveal>
              <p className="text-label text-stone-700">Documents</p>
            </Reveal>
            <SplitHeading className="text-h2 mt-5 max-w-[14ch]">Proof is published, not promised.</SplitHeading>
            <Reveal delay={0.1} className="mt-6 max-w-[44ch] space-y-4 text-ink/80">
              <p>Laboratory analyses, certifications and awards are shown for a lot only when the document has been uploaded and checked by the administrator.</p>
              <p>Until then the record shows a dash. We do not describe an oil with numbers we do not hold.</p>
            </Reveal>
          </div>
          <Reveal className="lg:col-span-6 lg:col-start-7">
            <p className="text-label mb-3">Sample lot record</p>
            <FactList
              rows={[
                { label: "Chemical analysis", value: null },
                { label: "Sensory assessment", value: null },
                { label: "Certifications", value: null },
                { label: "Awards", value: null },
              ]}
            />
            <Notice title="Regulated claims" className="mt-8">
              Health and nutrition claims about olive oil are regulated in the EU and may only be made when a lot meets the stated conditions. None are made on this site until the supporting analysis is on file and the wording has been reviewed.
            </Notice>
          </Reveal>
        </div>
      </section>

      <section data-tone="#f4efe4" className="py-section-sm">
        <div className="container-page grid gap-x-8 gap-y-8 lg:grid-cols-12">
          <h2 className="text-h2 lg:col-span-4">Questions</h2>
          <div className="lg:col-span-7 lg:col-start-6">
            <Accordion
              name="trace-faq"
              items={[
                { title: "What exactly is a lot?", content: <p>One bottling of oil, kept apart from the others and given its own number.</p> },
                { title: "Why does a record show dashes?", content: <p>The information has not been entered or verified yet. We leave the field empty rather than estimate.</p> },
                { title: "Can I ask for a lot’s documents?", content: <p>Yes. Contact us with the lot number and we will send what is on file.</p> },
              ]}
            />
          </div>
        </div>
      </section>

      <NextPage eyebrow="The oil" title="Choose a bottle." href="/shop" label="Shop all" />
    </>
  );
}
