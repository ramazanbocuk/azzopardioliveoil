import { ENGLISH_ONLY } from "@/i18n/seo";
import { localizedMetadata } from "@/i18n/server";
import { DraftBand, LeadPlate, NextPage, Points, Split, Statement } from "@/components/ui/Editorial";
import { PageHeader } from "@/components/ui/Page";

// The text of this page exists in English only for now, so it is not announced as translated.
export const generateMetadata = localizedMetadata("/our-story", {
  title: "Our story: a family olive oil business",
  description: "Azzopardi is a family business: a husband and wife who choose high-polyphenol olive oils lot by lot from producers around the Mediterranean, and name each one.",
}, ENGLISH_ONLY);

export default function OurStoryPage() {
  return (
    <>
      <PageHeader eyebrow="Our story" title="A family business. Two people who choose every oil." lead="Azzopardi is a husband and wife. We choose high-polyphenol extra virgin olive oils from producers around the Mediterranean, and tell you exactly which lot is in your hands." />
      <DraftBand>Draft copy. Our names and how we came to this, and the names, places and stories of the producers, belong here and will be written by the owners. Nothing on this page has been invented to fill the gap.</DraftBand>
      <LeadPlate label="the two of us, with a producer at harvest" tone="olive" />

      <Split
        tone="#f7f3ea"
        eyebrow="Where it starts"
        title="Not one grove. The right oil, wherever it is made."
        paragraphs={[
          "We work with producers in Morocco, Turkey, Italy, Greece and Spain. The olive is at home in all of them, and each makes oil the others cannot.",
          "We are not tied to one grove. That leaves us free to say no to a lot, and to go on looking until we find one we would put on our own table. We also produce olive oil ourselves, and it will be offered as our house blend.",
        ]}
        plate={{ label: "olive trees, five countries", tone: "stone" }}
        cta={{ href: "/olive-groves", label: "Where the oils come from" }}
      />

      <Statement tone="#eae3d3">We would rather tell you exactly where a bottle comes from than tell you it is the best.</Statement>

      <Split
        flip
        tone="#f4efe4"
        eyebrow="What we look for"
        title="High in polyphenols. Then it has to taste right."
        paragraphs={[
          "We look for oils that are high in polyphenols, and we ask a laboratory to say so. Each lot’s report gives its polyphenol content, its acidity and its peroxide value. Then we taste it.",
          "When a report is on file and has been checked, its figures are shown on the bottle’s page, with the laboratory’s name and the date of the test. When it is not, the page says so. We do not describe an oil with numbers we do not hold.",
        ]}
        plate={{ label: "oil being tasted", tone: "gold" }}
        cta={{ href: "/quality-traceability", label: "Quality & traceability" }}
      />

      <Split
        tone="#f7f3ea"
        eyebrow="Who we are"
        title="A husband and wife. A small house on purpose."
        paragraphs={[
          "Azzopardi is a family business, run by the two of us. We choose every oil ourselves.",
          "A lot is taken on because we would put it on our own table, and for no other reason. The bottle you open carries its lot number, so you can see what we saw.",
        ]}
        plate={{ label: "the two of us at the table", tone: "terracotta" }}
        cta={{ href: "/contact", label: "Write to us" }}
      />

      <Points
        tone="#eae3d3"
        eyebrow="What we hold to"
        title="Three rules we wrote down."
        items={[
          { title: "High in polyphenols, by measurement", body: "We look for oils high in polyphenols, and we ask a laboratory rather than take anyone’s word for it. Then the oil has to taste right." },
          { title: "One lot, one number", body: "Each lot is kept apart under its own number, with its producer’s name. Lots are not blended to hide a weak one." },
          { title: "Say only what we can show", body: "Certificates, analyses and awards appear on a bottle’s page only when the documents exist." },
        ]}
      />

      <NextPage title="See where each oil comes from." href="/olive-groves" label="Where the oils come from" />
    </>
  );
}
