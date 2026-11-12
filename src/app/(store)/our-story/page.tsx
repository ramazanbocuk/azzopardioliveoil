import type { Metadata } from "next";
import { DraftBand, LeadPlate, NextPage, Points, Split, Statement } from "@/components/ui/Editorial";
import { PageHeader } from "@/components/ui/Page";

export const metadata: Metadata = {
  title: "Our story",
  description: "Why Azzopardi bottles Sicilian olive oil by the lot, and sends it from Belgium.",
  alternates: { canonical: "/our-story" },
};

export default function OurStoryPage() {
  return (
    <>
      <PageHeader eyebrow="Our story" title="A house built on one oil." lead="Azzopardi brings Sicilian extra virgin olive oil to tables across Europe, and tells you exactly which bottling is in your hands." />
      <DraftBand>Draft copy. The family history, names, places and dates belong here and will be written with the owner — nothing on this page has been invented to fill the gap.</DraftBand>
      <LeadPlate label="the family, or the land, at harvest" tone="olive" />

      <Split
        tone="#f7f3ea"
        eyebrow="Where it starts"
        title="Sicily first. Everything else follows from the island."
        paragraphs={[
          "Dry summers, stony ground and wind off the sea make an oil with character before anyone touches it.",
          "Our work is to keep that character intact between the tree and your kitchen, and to be honest about every step in between.",
        ]}
        plate={{ label: "stone terraces and old trees", tone: "stone" }}
      />

      <Statement tone="#eae3d3">We would rather tell you exactly where a bottle comes from than tell you it is the best.</Statement>

      <Split
        flip
        tone="#f4efe4"
        eyebrow="Why Belgium"
        title="Pressed in Sicily. Sent from Belgium."
        paragraphs={[
          "Orders are packed and dispatched from Belgium, close to the people who cook with the oil.",
          "The bottle you open has travelled once from the island, and once more to your door. Its lot number travels with it.",
        ]}
        plate={{ label: "bottles being packed", tone: "terracotta" }}
        cta={{ href: "/shipping-returns", label: "Shipping & returns" }}
      />

      <Points
        tone="#eae3d3"
        eyebrow="What we hold to"
        title="Three rules we wrote down."
        items={[
          { title: "Early rather than easy", body: "Fruit is picked when it tastes right, not when it is most convenient or weighs the most." },
          { title: "One day, one lot", body: "A day’s harvest is milled and kept as its own lot. Lots are not blended to hide a weak one." },
          { title: "Say only what we can show", body: "Certificates, analyses and awards appear on a bottle’s page only when the documents exist." },
        ]}
      />

      <NextPage title="Walk through the groves." href="/olive-groves" label="Our olive groves" />
    </>
  );
}
