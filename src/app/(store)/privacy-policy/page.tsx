import type { Metadata } from "next";
import { LegalPage } from "@/components/ui/LegalPage";
import { privacyPolicy } from "@/content/legal";

export const metadata: Metadata = {
  title: privacyPolicy.title,
  description: privacyPolicy.intro,
  alternates: { canonical: "/privacy-policy" },
};

export default function PrivacyPolicyPage() {
  return <LegalPage doc={privacyPolicy} />;
}
