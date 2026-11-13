import { ENGLISH_ONLY } from "@/i18n/seo";
import { localizedMetadata } from "@/i18n/server";
import { LegalPage } from "@/components/ui/LegalPage";
import { privacyPolicy } from "@/content/legal";

// The text of this page exists in English only for now, so it is not announced as translated.
export const generateMetadata = localizedMetadata("/privacy-policy", {
  title: privacyPolicy.title,
  description: privacyPolicy.intro,
}, ENGLISH_ONLY);

export default function PrivacyPolicyPage() {
  return <LegalPage doc={privacyPolicy} />;
}
