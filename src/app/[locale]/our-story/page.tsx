import { ENGLISH_ONLY } from "@/i18n/seo";
import { localizedMetadata } from "@/i18n/server";
import { DraftBand, LeadPlate, NextPage, Points, Split, Statement } from "@/components/ui/Editorial";
import { PageHeader } from "@/components/ui/Page";

// The text of this page exists in English only for now, so it is not announced as translated.
export const generateMetadata = localizedMetadata("/our-story", {
  title: "Our story",
  description: "Why Azzopardi chooses olive oils lot by lot from producers around the Mediterranean, names each one, and sends them from Belgium.",
}, ENGLISH_ONLY);

export default function OurStoryPage() {
  return (
    <>
      <PageHeader eyebrow="Our story" title="A house that chooses, and says what it chose." lead="Azzopardi brings extra virgin olive oils from producers around the Mediterranean to your table, and tells you exactly which lot is in your hands." />
      <DraftBand>Draft copy. The history of the house, and the names, places and stories of the producers, belong here and will be written with the owner. Nothing on this page has been invented to fill the gap.</DraftBand>
      <LeadPlate label="a producer and the house, at harvest" tone="olive" />

      <Split
        tone="#f7f3ea"
        eyebrow="Where it starts"
        title="Not one grove. The right oil, wherever it is made."
        paragraphs={[
          "We work with producers in Morocco, Turkey, Italy, Greece and Spain. The olive is at home in all of them, and each makes oil the others cannot.",
          "We do not own groves or a mill. That leaves us free to say no to a lot, and to go on looking until we find one we would put on our own table.",
        ]}
        plate={{ label: "olive trees, five countries", tone: "stone" }}
        cta={{ href: "/olive-groves", label: "Where the oils come from" }}
      />

      <Statement tone="#eae3d3">We would rather tell you exactly where a bottle comes from than tell you it is the best.</Statement>

      <Split
        flip
        tone="#f4efe4"
        eyebrow="What we look at"
        title="How it tastes. Then what the laboratory found."
        paragraphs={[
          "An oil is tasted first. Then we ask for the laboratory report on that lot: its polyphenol content, its acidity, its peroxide value.",
          "When a report is on file and has been checked, its figures are shown on the bottle’s page, with the laboratory’s name and the date of the test. When it is not, the page says so. We do not describe an oil with numbers we do not hold.",
        ]}
        plate={{ label: "oil being tasted", tone: "gold" }}
        cta={{ href: "/quality-traceability", label: "Quality & traceability" }}
      />

      <Split
        tone="#f7f3ea"
        eyebrow="Why Belgium"
        title="Made around the Mediterranean. Sent from Belgium."
        paragraphs={[
          "Orders are packed and dispatched from Belgium, close to the people who cook with the oil.",
          "The bottle you open has travelled once from its producer, and once more to your door. Its lot number travels with it.",
        ]}
        plate={{ label: "bottles being packed", tone: "terracotta" }}
        cta={{ href: "/shipping-returns", label: "Shipping & returns" }}
      />

      <Points
        tone="#eae3d3"
        eyebrow="What we hold to"
        title="Three rules we wrote down."
        items={[
          { title: "Chosen by tasting and by measurement", body: "An oil is taken on for how it tastes and for what its laboratory report says. Not for where it is from, and not for what it costs." },
          { title: "One lot, one number", body: "Each lot is kept apart under its own number, with its producer’s name. Lots are not blended to hide a weak one." },
          { title: "Say only what we can show", body: "Certificates, analyses and awards appear on a bottle’s page only when the documents exist." },
        ]}
      />

      <NextPage title="See where each oil comes from." href="/olive-groves" label="Where the oils come from" />
    </>
  );
}
