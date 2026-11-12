import type { LegalDoc } from "@/content/legal";
import { Notice, PageHeader, Prose } from "./Page";

export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <>
      <PageHeader eyebrow="Legal" title={doc.title} lead={doc.intro} size="h1" />
      <section className="container-page grid gap-x-8 gap-y-10 pb-section lg:grid-cols-12">
        <nav aria-label="On this page" className="lg:col-span-3">
          <ol className="text-small space-y-1 lg:sticky lg:top-[calc(var(--header-h)+2rem)]">
            {doc.sections.map((section, index) => (
              <li key={section.heading}>
                <a href={`#section-${index + 1}`} className="link-underline inline-flex min-h-9 items-center text-ink/80 hover:text-ink">
                  {section.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="lg:col-span-8 lg:col-start-5">
          <Notice title="Draft — requires legal review">
            This is a structural template, not a finished legal document. Text in [square brackets] must be supplied by the business, and the whole page must be reviewed against Belgian and EU law before the shop opens.
          </Notice>
          <Prose className="mt-10">
            {doc.sections.map((section, index) => (
              <section key={section.heading} id={`section-${index + 1}`} className="scroll-mt-[calc(var(--header-h)+1.5rem)]">
                <h2>{section.heading}</h2>
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.list && (
                  <ul>
                    {section.list.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </Prose>
        </div>
      </section>
    </>
  );
}
