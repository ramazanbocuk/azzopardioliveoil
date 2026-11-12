import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/account/AccountViews";
import { FactList, Notice, PageHeader } from "@/components/ui/Page";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with Azzopardi Olive Oil.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <>
      <PageHeader eyebrow="Contact" title="Write to us." size="h1" lead="Questions about an order, a lot, or the oil itself. We answer in person." />
      <section className="container-page grid gap-x-8 gap-y-14 pb-section lg:grid-cols-12">
        <div className="lg:col-span-6">
          <ContactForm />
        </div>
        <div className="lg:col-span-4 lg:col-start-9">
          <h2 className="text-h3">Details</h2>
          <div className="mt-5">
            <FactList
              rows={[
                { label: "Email", value: null },
                { label: "WhatsApp", value: null },
                { label: "Company", value: null },
                { label: "Address", value: null },
                { label: "VAT number", value: null },
              ]}
            />
          </div>
          <Notice title="To be completed" className="mt-8">
            Business contact details and the legally required company information are added before launch.
          </Notice>
          <p className="text-small mt-8 text-ink/80">
            Many answers are already in the{" "}
            <Link href="/faq" className="underline underline-offset-4">
              FAQ
            </Link>
            , and you can follow a parcel on the{" "}
            <Link href="/order-tracking" className="underline underline-offset-4">
              order tracking page
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  );
}
