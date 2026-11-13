import { ENGLISH_ONLY } from "@/i18n/seo";
import { localizedMetadata } from "@/i18n/server";
import { LegalPage } from "@/components/ui/LegalPage";
import { terms } from "@/content/legal";

// The text of this page exists in English only for now, so it is not announced as translated.
export const generateMetadata = localizedMetadata("/terms-conditions", {
  title: terms.title,
  description: terms.intro,
}, ENGLISH_ONLY);

export default function TermsPage() {
  return <LegalPage doc={terms} />;
}
