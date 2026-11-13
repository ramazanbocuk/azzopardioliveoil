import { Logo } from "@/components/brand/Logo";
import { Link } from "@/components/ui/Link";
import { getI18n } from "@/i18n/server";
import { getShippingCountries } from "@/server/storefrontData";
import { LocaleSelector } from "./LocaleSelector";

export async function Footer() {
  const [{ m }, countries] = await Promise.all([getI18n(), getShippingCountries()]);
  const f = m.footer;
  const columns = [
    {
      title: f.shopTitle,
      links: [
        { href: "/shop", label: f.shopAll },
        { href: "/shop/extra-virgin-olive-oil", label: f.evoo },
        { href: "/order-tracking", label: f.track },
        { href: "/account", label: f.account },
      ],
    },
    {
      title: f.houseTitle,
      links: [
        { href: "/our-story", label: f.story },
        { href: "/olive-groves", label: f.groves },
        { href: "/harvest-production", label: f.harvest },
        { href: "/quality-traceability", label: f.quality },
        { href: "/journal", label: f.journal },
      ],
    },
    {
      title: f.helpTitle,
      links: [
        { href: "/contact", label: f.contact },
        { href: "/faq", label: f.faq },
        { href: "/shipping-returns", label: f.shipping },
      ],
    },
  ];
  const legal = [
    { href: "/privacy-policy", label: f.privacy },
    { href: "/cookie-policy", label: f.cookies },
    { href: "/terms-conditions", label: f.terms },
  ];

  return (
    <footer className="grain bg-olive-950 text-ivory">
      <div className="container-page relative z-10 pb-10 pt-section-sm">
        <div className="grid gap-x-8 gap-y-14 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Logo tone="gold" className="h-28 sm:h-32" />
            <p className="text-h2 mt-10 max-w-[14ch]">{f.tagline}</p>
            <LocaleSelector placement="footer" countries={countries.map((country) => country.code)} />
          </div>
          <nav aria-label={f.label} className="grid grid-cols-2 gap-x-8 gap-y-12 sm:grid-cols-3 lg:col-span-7">
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
          <p>{f.company}</p>
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
