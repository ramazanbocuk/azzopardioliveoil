import type { Metadata } from "next";
import { LegalPage } from "@/components/ui/LegalPage";
import { cookiePolicy } from "@/content/legal";

export const metadata: Metadata = {
  title: cookiePolicy.title,
  description: cookiePolicy.intro,
  alternates: { canonical: "/cookie-policy" },
};

export default function CookiePolicyPage() {
  return <LegalPage doc={cookiePolicy} />;
}
