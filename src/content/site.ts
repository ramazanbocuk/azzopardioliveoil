/**
 * PLACEHOLDER CONTENT — front-end phases only.
 *
 * The catalogue (products, prices, stock, lots) now comes from the database:
 * see src/server/storefrontData.ts. What remains here is draft editorial
 * content (journal, FAQ, process steps) and the shared display types.
 * No certifications, awards, health claims, nutrition figures or lab values
 * are stated anywhere, by design: fields the administrator has not filled in
 * are `null` and render as "—".
 */

export type Variant = {
  sku: string;
  ml: number;
  label: string;
  /** Price in euro cents, VAT included. */
  priceCents: number;
  /** Relative bottle height used by the illustration. */
  scale: number;
  inStock: boolean;
  /** Out of stock, but the owner allows it to be ordered and sent when it arrives. */
  backorder: boolean;
};

export type Product = {
  slug: string;
  name: string;
  categorySlug: string;
  blurb: string;
  description: string[];
  /** What the owner says about the wait when the product is out of stock. Null when nothing was written. */
  backorderNote: string | null;
  /** Languages this product's own text is published in. English is always one of them. */
  languages: string[];
  /** False when the page is in another language but this text is still the English source. */
  translated: boolean;
  variants: Variant[];
  /** Most recent published lot, if any. */
  lot: string | null;
  /** Where it comes from, what it is made of and how it tastes. Every field is administrator-entered; null or empty means "not yet recorded". */
  profile: {
    /** ISO country code; the page shows the country's name in the reader's language. */
    country: string | null;
    region: string | null;
    /** Only producers the business has marked as public are named. */
    producer: { name: string; place: string | null } | null;
    varieties: { name: string; percent: number | null }[];
    composition: "SINGLE_VARIETY" | "BLEND" | null;
    harvestYear: number | null;
    harvesting: string | null;
    extraction: string | null;
    aroma: string | null;
    taste: string | null;
    bitterness: number | null;
    pungency: number | null;
    pairings: string | null;
    packaging: string | null;
  };
  /** Laboratory values of the current lot. Only verified results of a published lot are ever here. */
  lab: { measure: string; label: string; value: number; unit: string; decimals: number; method: string | null; laboratory: string | null; tested: string | null; certificateUrl: string | null }[];
  /** Administrator-entered facts. `null` means "not yet recorded". */
  facts: {
    origin: string | null;
    harvest: string | null;
    cultivar: string | null;
    mill: string | null;
    bottled: string | null;
    bestBefore: string | null;
    ingredients: string | null;
    nutrition: { label: string; value: string | null }[];
    storage: string | null;
  };
};

export type Category = { slug: string; name: string; intro: string; languages: string[] };

/** One purchasable variant with its product and category: the unit of the shop grid. */
export type CatalogItem = { product: Product; variant: Variant; category: Category };

export const SAMPLE_LOT = "AZ-0000";

/** Bottle illustration height for a volume: 500 ml → 0.8, 1000 ml → 1. */
export function bottleScale(ml: number): number {
  return Math.min(1, Math.max(0.55, 0.6 + ml / 2500));
}

/** Illustrative item for the design-system page only. The shop reads the database. */
export const sampleItem: CatalogItem = {
  category: { slug: "extra-virgin-olive-oil", name: "Extra Virgin Olive Oil", intro: "", languages: ["en"] },
  variant: { sku: "sample-750", ml: 750, label: "750 ml", priceCents: 2600, scale: bottleScale(750), inStock: true, backorder: false },
  product: {
    slug: "extra-virgin-olive-oil",
    name: "Extra Virgin Olive Oil",
    categorySlug: "extra-virgin-olive-oil",
    blurb: "",
    description: [],
    backorderNote: null,
    languages: ["en"],
    translated: true,
    variants: [],
    lot: SAMPLE_LOT,
    profile: { country: null, region: null, producer: null, varieties: [], composition: null, harvestYear: null, harvesting: null, extraction: null, aroma: null, taste: null, bitterness: null, pungency: null, pairings: null, packaging: null },
    lab: [],
    facts: { origin: null, harvest: null, cultivar: null, mill: null, bottled: null, bestBefore: null, ingredients: null, nutrition: [], storage: null },
  },
};

export function productHref(p: Pick<Product, "slug">, ml?: number): string {
  return ml ? `/products/${p.slug}?size=${ml}` : `/products/${p.slug}`;
}

export const navigation = [
  { href: "/shop", label: "Shop" },
  { href: "/our-story", label: "Our Story" },
  { href: "/olive-groves", label: "Groves" },
  { href: "/harvest-production", label: "Harvest" },
  { href: "/quality-traceability", label: "Traceability" },
  { href: "/journal", label: "Journal" },
] as const;

export const processSteps = [
  { title: "Picked", body: "Olives come off the branch into nets, never off the ground. The day’s fruit stays together from this moment on." },
  { title: "Carried", body: "Shallow crates, a short road. Fruit that waits loses what makes it worth pressing." },
  { title: "Milled", body: "Leaves out, fruit washed, then crushed whole — skin, flesh and stone — into a green paste." },
  { title: "Settled", body: "Oil is drawn from the paste and left to rest until it clears on its own." },
  { title: "Numbered", body: "Each bottling receives a lot number. That number follows the bottle to your door." },
] as const;

export type JournalEntry = {
  slug: string;
  kind: "Story" | "Recipe";
  kicker: string;
  title: string;
  tone: "olive" | "stone" | "gold" | "terracotta" | "dawn";
  label: string;
  standfirst: string;
  body: string[];
  /** Languages the article is published in. Built-in sample entries are English only. */
  languages?: string[];
  recipe?: { serves: string; time: string; ingredients: string[]; method: string[] };
};

export const journal: JournalEntry[] = [
  {
    slug: "bread-salt-and-the-first-oil",
    kind: "Story",
    kicker: "At the table",
    title: "Bread, salt, and the first oil of the year",
    tone: "terracotta",
    label: "table with bread and new oil",
    standfirst: "The simplest way to meet a new oil is also the oldest.",
    body: [
      "New oil does not need a recipe. It needs bread that can stand up to it, a pinch of salt, and a few minutes with nothing else on the table.",
      "Pour more than seems polite. Tear the bread rather than slicing it, so the oil has something to hold on to. Taste it once on its own before anything else joins in.",
      "Draft article. The published version will be written by the house and photographed at the table.",
    ],
  },
  {
    slug: "winter-oranges-with-fennel",
    kind: "Recipe",
    kicker: "Recipe",
    title: "Winter oranges with fennel and black olives",
    tone: "gold",
    label: "orange and fennel salad",
    standfirst: "A Sicilian winter salad that asks for good oil and little else.",
    body: ["Sweet, bitter, salt and oil. It takes ten minutes and is better for being made just before you eat."],
    recipe: {
      serves: "Serves 4",
      time: "10 minutes",
      ingredients: ["4 oranges", "1 fennel bulb, with its fronds", "A handful of black olives", "Extra virgin olive oil", "Sea salt and black pepper"],
      method: [
        "Cut the peel and pith from the oranges and slice them into rounds, keeping the juice.",
        "Slice the fennel as thinly as you can. Keep the fronds.",
        "Lay the orange and fennel on a plate, scatter the olives, and spoon over the juice.",
        "Season, pour over a generous amount of oil, and finish with the fronds.",
      ],
    },
  },
  {
    slug: "what-the-trees-are-doing-in-february",
    kind: "Story",
    kicker: "From the grove",
    title: "What the trees are doing in February",
    tone: "olive",
    label: "pruned olive tree",
    standfirst: "The harvest is over. The work that decides the next one has begun.",
    body: [
      "In winter the grove looks idle. It is not. Pruning opens each tree to light and air, and what is cut now shapes what the tree will carry in autumn.",
      "Draft article. The published version will follow the real calendar of the groves.",
    ],
  },
];

export function getJournalEntry(slug: string): JournalEntry | undefined {
  return journal.find((entry) => entry.slug === slug);
}

export const faq: { group: string; items: { q: string; a: string }[] }[] = [
  {
    group: "The oil",
    items: [
      { q: "What is a lot number?", a: "Each bottling is given a number. It links your bottle to what has been recorded for that bottling: harvest day, grove, mill and any analysis on file." },
      { q: "Where can I find it?", a: "On the label of every bottle, and on your order confirmation." },
      { q: "How should I store the oil?", a: "Storage guidance is printed on each bottle and shown on the product page once it has been entered for that lot." },
    ],
  },
  {
    group: "Orders",
    items: [
      { q: "Do I need an account to order?", a: "No. You can check out as a guest. An account lets you see past orders, save addresses and request a return." },
      { q: "Which payment methods do you accept?", a: "Payment methods are confirmed before launch and will be listed here and at checkout." },
      { q: "Can I change an order after placing it?", a: "Contact us as soon as possible. Once an order has been handed to the carrier it can no longer be changed." },
    ],
  },
  {
    group: "Shipping & returns",
    items: [
      { q: "Where do you ship?", a: "We send orders from Belgium. The list of destinations and their rates is shown on the shipping page and at checkout." },
      { q: "How do I track my order?", a: "You will receive a tracking link by email when your order ships. You can also use the order tracking page with your order number and email address." },
      { q: "Can I return a bottle?", a: "See the shipping and returns page for the conditions that apply. Returns are requested from your account or by contacting us." },
    ],
  },
];

/** Countries offered in the address form. Deliverability and rates are decided by the server. */
export const shippingCountries = [
  { code: "BE", name: "Belgium" },
  { code: "LU", name: "Luxembourg" },
  { code: "NL", name: "Netherlands" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "IT", name: "Italy" },
] as const;

export function formatPrice(cents: number, locale = "en-BE"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(cents / 100);
}
