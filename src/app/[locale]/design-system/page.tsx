import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Checkbox, QuantityStepper, SelectField, TextField } from "@/components/ui/Field";
import { LotTicket } from "@/components/ui/LotTicket";
import { Plate } from "@/components/ui/Plate";
import { ProductCard } from "@/components/ui/ProductCard";
import { sampleItem } from "@/content/site";
import { SizeDemo } from "./SizeDemo";

export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false, follow: false },
};

const palette: { group: string; note: string; swatches: { name: string; hex: string; dark?: boolean }[] }[] = [
  {
    group: "Olive",
    note: "Brand ground. 700 is the primary action colour; 900/950 are dark grounds.",
    swatches: [
      { name: "olive-950", hex: "#161c10", dark: true },
      { name: "olive-900", hex: "#1f2716", dark: true },
      { name: "olive-700", hex: "#2f3a22", dark: true },
      { name: "olive-500", hex: "#55633f", dark: true },
      { name: "olive-300", hex: "#9ba583" },
      { name: "olive-100", hex: "#dde0d0" },
    ],
  },
  {
    group: "Harvest-day grounds",
    note: "Page backgrounds, in scroll order: dawn, noon, ivory, paper, dusk.",
    swatches: [
      { name: "dawn", hex: "#dddad1" },
      { name: "noon", hex: "#f7f3ea" },
      { name: "ivory", hex: "#f4efe4" },
      { name: "paper", hex: "#eae3d3" },
      { name: "dusk", hex: "#ebddbc" },
    ],
  },
  {
    group: "Stone, gold, terracotta",
    note: "Stone-700, gold-700 and terracotta-700 are safe for text on light grounds; gold-300 for text on olive. The 500s are decorative.",
    swatches: [
      { name: "stone-300", hex: "#d2cbbd" },
      { name: "stone-500", hex: "#b9b0a0" },
      { name: "stone-700", hex: "#5c574b", dark: true },
      { name: "gold-300", hex: "#cdb077" },
      { name: "gold-500", hex: "#b08d4a" },
      { name: "gold-700", hex: "#6b5324", dark: true },
      { name: "terracotta-500", hex: "#b5613c", dark: true },
      { name: "terracotta-700", hex: "#974a2a", dark: true },
      { name: "ink", hex: "#1a1c16", dark: true },
    ],
  },
];

const typeScale = [
  { cls: "text-display", name: "Display", spec: "Zodiak 400 · 48–152px · 0.96", sample: "A single morning" },
  { cls: "text-h1", name: "Heading 1", spec: "Zodiak 400 · 40–92px · 1.0", sample: "In the grove" },
  { cls: "text-h2", name: "Heading 2", spec: "Zodiak 400 · 32–60px · 1.06", sample: "Every bottle answers for itself" },
  { cls: "text-h3", name: "Heading 3", spec: "Zodiak 400 · 24–34px · 1.16", sample: "One lot, one number" },
  { cls: "text-lead", name: "Lead", spec: "Switzer 400 · 18–22px · 1.5", sample: "We would rather tell you exactly where a bottle comes from." },
  { cls: "text-body", name: "Body", spec: "Switzer 400 · 16px · 1.65", sample: "The olive grows right around the Mediterranean, and no one shore has the best of it." },
  { cls: "text-small", name: "Small", spec: "Switzer 400 · 14px · 1.55", sample: "VAT shown at checkout. You can unsubscribe at any time." },
  { cls: "text-label", name: "Label", spec: "Switzer 500 · 12px · caps +0.14em", sample: "Quality & traceability" },
  { cls: "text-ticket", name: "Ticket", spec: "System mono · 11px · caps +0.08em", sample: "Lot N° AZ-0000 · 750 ml" },
];

const spacing = [
  { name: "gutter", value: "clamp(20px, 4vw, 64px)", use: "Page side padding" },
  { name: "section", value: "clamp(96px, 13vw, 208px)", use: "Vertical rhythm between sections" },
  { name: "section-sm", value: "clamp(64px, 8vw, 120px)", use: "Compact bands, footer" },
  { name: "4 / 8 / 16 / 24 / 32 / 56", value: "Tailwind 4px base", use: "Inside components" },
];

const motion = [
  { title: "Arrive, never bounce", body: "Only expo.out and power3 eases. Durations 0.45s (interface), 0.9s (blocks), 1.3s (headlines), 2.4s (opening shot)." },
  { title: "Type rises from a mask", body: "Headlines split into lines and lift into place, 85ms apart. Body copy fades up 28px, once." },
  { title: "Photography drifts", body: "Images move slower than the page (±7–10%). Nothing zooms quickly; hover scale never exceeds 4%." },
  { title: "One idea per section", body: "The hero separates hills by depth; the process pins and travels sideways; the ground colour follows the day. Nothing loops." },
  { title: "Reduced motion means none", body: "Every animation is registered behind prefers-reduced-motion. Without it, content is simply there, and scrolling is native." },
];

const responsive = [
  { bp: "< 640px", rule: "Single column. 20px gutters. Headlines cap at 15–19 characters per line. Touch targets ≥ 44px." },
  { bp: "640–1023px", rule: "Two columns for cards. Full-screen menu. Process is a vertical list." },
  { bp: "≥ 1024px", rule: "12-column grid, 32px gaps. Inline navigation. Process pins and scrolls sideways." },
  { bp: "≥ 1664px", rule: "Content stops at 104rem; grounds and photography keep bleeding to the edge." },
];

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-ink/20 py-section-sm">
      <h2 id={id} className="text-h2">
        {title}
      </h2>
      <div className="mt-12">{children}</div>
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <div className="bg-ivory">
      <div className="container-page pb-section pt-[calc(var(--header-h)+4rem)]">
        <p className="text-label text-stone-700">Azzopardi — internal reference</p>
        <h1 className="text-display mt-5">Design system</h1>
        <p className="text-lead mt-8 max-w-[52ch] text-ink/80">Tokens and components shared by the storefront, account, checkout and admin. Tokens live in <code className="font-mono text-[0.9em]">src/app/globals.css</code>.</p>

        <div className="mt-section-sm">
          <Block id="ds-colour" title="Colour">
            <div className="space-y-12">
              {palette.map((group) => (
                <div key={group.group}>
                  <h3 className="text-label">{group.group}</h3>
                  <p className="text-small mt-2 max-w-[70ch] text-stone-700">{group.note}</p>
                  <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-9">
                    {group.swatches.map((s) => (
                      <li key={s.name} className={`flex aspect-[4/3] flex-col justify-end border border-ink/10 p-3 ${s.dark ? "text-ivory" : "text-ink"}`} style={{ background: s.hex }}>
                        <span className="text-ticket">{s.name}</span>
                        <span className="text-ticket opacity-80">{s.hex}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Block>

          <Block id="ds-type" title="Typography">
            <ul className="divide-y divide-ink/15">
              {typeScale.map((t) => (
                <li key={t.cls} className="grid gap-x-8 gap-y-3 py-7 lg:grid-cols-12 lg:items-baseline">
                  <div className="lg:col-span-3">
                    <p className="text-label">{t.name}</p>
                    <p className="text-ticket mt-2 text-stone-700">{t.spec}</p>
                  </div>
                  <p className={`${t.cls} lg:col-span-9`}>{t.sample}</p>
                </li>
              ))}
            </ul>
          </Block>

          <Block id="ds-space" title="Spacing">
            <dl className="grid gap-x-8 gap-y-6 md:grid-cols-2">
              {spacing.map((s) => (
                <div key={s.name} className="border-t border-ink/20 pt-4">
                  <dt className="text-label">{s.name}</dt>
                  <dd className="text-ticket mt-2 text-stone-700">{s.value}</dd>
                  <dd className="mt-1 text-ink/80">{s.use}</dd>
                </div>
              ))}
            </dl>
          </Block>

          <Block id="ds-buttons" title="Buttons">
            <div className="grid gap-8 lg:grid-cols-2">
              <div className="flex flex-wrap items-center gap-4 bg-noon p-8">
                <Button arrow>Add to cart</Button>
                <Button variant="secondary">Secondary</Button>
                <Button size="sm">Small</Button>
                <Button disabled>Sold out</Button>
                <ButtonLink href="/design-system" variant="text" arrow>
                  Text link
                </ButtonLink>
              </div>
              <div className="flex flex-wrap items-center gap-4 bg-olive-900 p-8 text-ivory">
                <Button variant="inverse" arrow>
                  Trace
                </Button>
                <Button variant="inverse-outline">Outline</Button>
                <ButtonLink href="/design-system" variant="text" arrow>
                  Text link
                </ButtonLink>
              </div>
            </div>
          </Block>

          <Block id="ds-forms" title="Form elements">
            <div className="grid gap-x-12 gap-y-10 lg:grid-cols-2">
              <div className="space-y-7">
                <TextField label="Full name" name="ds-name" placeholder="Your name" autoComplete="name" />
                <TextField label="Email address" name="ds-email" type="email" defaultValue="not-an-email" error="Enter an email address like name@example.com." />
                <SelectField label="Country" name="ds-country" hint="We ship from Belgium." defaultValue="BE">
                  <option value="BE">Belgium</option>
                  <option value="LU">Luxembourg</option>
                  <option value="NL">Netherlands</option>
                  <option value="FR">France</option>
                  <option value="DE">Germany</option>
                  <option value="IT">Italy</option>
                </SelectField>
              </div>
              <div className="space-y-8">
                <SizeDemo />
                <QuantityStepper />
                <Checkbox label="Use this address for billing" name="ds-billing" defaultChecked />
              </div>
            </div>
          </Block>

          <Block id="ds-product" title="Product card, lot ticket, plate">
            <div className="grid gap-x-8 gap-y-12 md:grid-cols-3">
              <ProductCard item={sampleItem} />
              <div className="space-y-6">
                <LotTicket lot="AZ-0000" sample rows={[{ label: "Harvest", value: "—" }, { label: "Grove", value: "—" }]} />
                <div className="bg-olive-900 p-6">
                  <LotTicket tone="dark" lot="AZ-0000" rows={[{ label: "Size", value: "750 ml" }]} />
                </div>
                <p className="text-small text-stone-700">The lot ticket is the brand’s signature. An em dash means the administrator has not recorded that value.</p>
              </div>
              <div>
                <div className="relative aspect-[4/5]">
                  <Plate tone="terracotta" label="what the photo should show" />
                </div>
                <p className="text-small mt-4 text-stone-700">Plates stand in for photography and say so. Five tones: olive, stone, gold, terracotta, dawn.</p>
              </div>
            </div>
          </Block>

          <Block id="ds-motion" title="Animation principles">
            <ol className="grid gap-x-8 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
              {motion.map((m, index) => (
                <li key={m.title} className="border-t border-ink/20 pt-5">
                  <span className="text-ticket text-gold-700">{String(index + 1).padStart(2, "0")}</span>
                  <h3 className="text-h3 mt-3">{m.title}</h3>
                  <p className="mt-3 text-ink/80">{m.body}</p>
                </li>
              ))}
            </ol>
          </Block>

          <Block id="ds-responsive" title="Responsive rules">
            <dl className="divide-y divide-ink/15">
              {responsive.map((r) => (
                <div key={r.bp} className="grid gap-x-8 gap-y-2 py-5 md:grid-cols-12">
                  <dt className="text-ticket md:col-span-3">{r.bp}</dt>
                  <dd className="text-ink/80 md:col-span-9">{r.rule}</dd>
                </div>
              ))}
            </dl>
          </Block>
        </div>
      </div>
    </div>
  );
}
