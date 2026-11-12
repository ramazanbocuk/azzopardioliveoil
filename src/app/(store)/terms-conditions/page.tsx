import type { Metadata } from "next";
import { LegalPage } from "@/components/ui/LegalPage";
import { terms } from "@/content/legal";

export const metadata: Metadata = {
  title: terms.title,
  description: terms.intro,
  alternates: { canonical: "/terms-conditions" },
};

export default function TermsPage() {
  return <LegalPage doc={terms} />;
}
