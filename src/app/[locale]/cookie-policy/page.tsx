import { ENGLISH_ONLY } from "@/i18n/seo";
import { localizedMetadata } from "@/i18n/server";
import { LegalPage } from "@/components/ui/LegalPage";
import { cookiePolicy } from "@/content/legal";

// The text of this page exists in English only for now, so it is not announced as translated.
export const generateMetadata = localizedMetadata("/cookie-policy", {
  title: cookiePolicy.title,
  description: cookiePolicy.intro,
}, ENGLISH_ONLY);

export default function CookiePolicyPage() {
  return <LegalPage doc={cookiePolicy} />;
}
