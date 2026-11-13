import { ENGLISH_ONLY } from "@/i18n/seo";
import { localizedMetadata } from "@/i18n/server";
import { Process } from "@/components/home/Process";
import { DraftBand, LeadPlate, NextPage, Points, Split } from "@/components/ui/Editorial";
import { PageHeader } from "@/components/ui/Page";

// The text of this page exists in English only for now, so it is not announced as translated.
export const generateMetadata = localizedMetadata("/harvest-production", {
  title: "Harvest & production",
  description: "How an olive oil is chosen, measured, numbered and sent by Azzopardi, and what is recorded about its harvest and milling.",
}, ENGLISH_ONLY);

export default function HarvestProductionPage() {
  return (
    <>
      <PageHeader eyebrow="Harvest & production" title="One lot, kept apart." tone="#ebddbc" lead="What happens between a producer’s harvest and your door, in the order it happens." />
      <DraftBand>Draft copy. It describes how the house works and how olive oil is made in general, not how any one producer works. Harvest dates, mill details, extraction temperatures and timings are stated on an oil’s page only once they have been confirmed for that lot, because several of those terms are regulated.</DraftBand>
      <LeadPlate label="nets under the trees at first light" tone="gold" />

      <Process />

      <Split
        tone="#f7f3ea"
        eyebrow="The harvest"
        title="The producer chooses the day. We ask which day it was."
        paragraphs={[
          "When the fruit is picked changes the oil: earlier fruit gives less oil with more bite, later fruit gives more oil that is milder. That choice belongs to the producer.",
          "What we ask for is the record: the harvest year, how the fruit was picked, and from which olives. Where it has been given to us, it is on the oil’s page.",
        ]}
        plate={{ label: "hands and nets", tone: "olive" }}
      />

      <Split
        flip
        tone="#f4efe4"
        eyebrow="The mill"
        title="From fruit to oil."
        paragraphs={[
          "At a mill, leaves are removed and the fruit is washed before it is crushed whole into a paste. The oil is then separated from the paste and stored away from light and air until bottling.",
          "How a given oil was extracted is stated on its page when the producer has told us and we can show it. Terms such as “cold extraction” have a legal meaning, so we use them only then.",
        ]}
        plate={{ label: "the mill at work", tone: "stone" }}
      />

      <Points
        tone="#eae3d3"
        eyebrow="What a lot records"
        title="Four things we ask to be written down for every lot."
        items={[
          { title: "The producer", body: "Who made the oil, and where." },
          { title: "The harvest", body: "The year, the olives, and how they were picked." },
          { title: "The mill", body: "Where and how the oil was extracted." },
          { title: "The bottling", body: "When the lot was bottled, and its best-before date." },
        ]}
      />

      <NextPage title="Follow a lot number." href="/quality-traceability" label="Quality & traceability" />
    </>
  );
}
