import Link from "next/link";

const columns = [
  {
    title: "Shop",
    links: [
      { href: "/shop", label: "Shop all" },
      { href: "/shop/extra-virgin-olive-oil", label: "Extra virgin olive oil" },
      { href: "/order-tracking", label: "Track an order" },
      { href: "/account", label: "Your account" },
    ],
  },
  {
    title: "The house",
    links: [
      { href: "/our-story", label: "Our story" },
      { href: "/olive-groves", label: "Our olive groves" },
      { href: "/harvest-production", label: "Harvest & production" },
      { href: "/quality-traceability", label: "Quality & traceability" },
      { href: "/journal", label: "Journal" },
    ],
  },
  {
    title: "Help",
    links: [
      { href: "/contact", label: "Contact" },
      { href: "/faq", label: "FAQ" },
      { href: "/shipping-returns", label: "Shipping & returns" },
    ],
  },
];

const legal = [
  { href: "/privacy-policy", label: "Privacy" },
  { href: "/cookie-policy", label: "Cookies" },
  { href: "/terms-conditions", label: "Terms" },
];

export function Footer() {
  return (
    <footer className="grain bg-olive-950 text-ivory">
      <div className="container-page relative z-10 pb-10 pt-section-sm">
        <div className="grid gap-x-8 gap-y-14 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="text-h2 max-w-[14ch]">Sicilian oil, sent from Belgium, numbered by the lot.</p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-12 sm:grid-cols-3 lg:col-span-7">
            {columns.map((column) => (
              <div key={column.title}>
                <h2 className="text-label text-gold-300">{column.title}</h2>
                <ul className="mt-5 space-y-1">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="link-underline inline-flex min-h-9 items-center text-ivory/85 hover:text-ivory">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <p aria-hidden="true" className="mt-section-sm select-none font-serif text-[clamp(3.5rem,17.5vw,19rem)] leading-[0.8] tracking-[-0.04em] text-ivory/[0.07]">
          Azzopardi
        </p>

        <div className="text-small mt-10 flex flex-col gap-4 border-t border-ivory/15 pt-6 text-ivory/70 sm:flex-row sm:items-center sm:justify-between">
          <p>© Azzopardi Olive Oil. Company details to be added before launch.</p>
          <ul className="flex gap-6">
            {legal.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="link-underline inline-flex min-h-9 items-center hover:text-ivory">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
