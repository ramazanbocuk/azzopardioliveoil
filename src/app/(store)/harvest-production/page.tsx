import type { Metadata } from "next";
import { Process } from "@/components/home/Process";
import { DraftBand, LeadPlate, NextPage, Points, Split } from "@/components/ui/Editorial";
import { PageHeader } from "@/components/ui/Page";

export const metadata: Metadata = {
  title: "Harvest & production",
  description: "How Azzopardi olive oil is picked, milled, settled and numbered.",
  alternates: { canonical: "/harvest-production" },
};

export default function HarvestProductionPage() {
  return (
    <>
      <PageHeader eyebrow="Harvest & production" title="One day, kept apart." tone="#ebddbc" lead="What happens between the branch and the bottle, in the order it happens." />
      <DraftBand>Draft copy describing the general method. Mill details, extraction temperatures and timings are stated only once they have been confirmed for a lot, because several of those terms are regulated.</DraftBand>
      <LeadPlate label="nets under the trees at first light" tone="gold" />

      <Process />

      <Split
        tone="#f7f3ea"
        eyebrow="The harvest"
        title="The day is chosen by tasting, not by the calendar."
        paragraphs={[
          "Fruit picked too late gives more oil and less character. We would rather have less.",
          "Olives are taken from the branch into nets and moved in shallow crates, so nothing is crushed before the mill.",
        ]}
        plate={{ label: "hands and nets", tone: "olive" }}
      />

      <Split
        flip
        tone="#f4efe4"
        eyebrow="The mill"
        title="Short road, clean fruit, no waiting."
        paragraphs={[
          "At the mill, leaves are removed and the fruit is washed before it is crushed whole into a paste.",
          "The oil is separated from the paste and left to settle. Then it is stored away from light and air until bottling.",
        ]}
        plate={{ label: "the mill at work", tone: "stone" }}
      />

      <Points
        tone="#eae3d3"
        eyebrow="What a lot records"
        title="Four things written down for every bottling."
        items={[
          { title: "The day", body: "When the fruit was picked and when it reached the mill." },
          { title: "The grove", body: "Which trees the fruit came from." },
          { title: "The mill", body: "Where and how the oil was extracted." },
          { title: "The bottling", body: "When the lot was bottled, and its best-before date." },
        ]}
      />

      <NextPage title="Follow a lot number." href="/quality-traceability" label="Quality & traceability" />
    </>
  );
}
