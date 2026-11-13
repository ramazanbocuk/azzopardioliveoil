import { ENGLISH_ONLY } from "@/i18n/seo";
import { localizedMetadata } from "@/i18n/server";
import { LegalPage } from "@/components/ui/LegalPage";
import { shippingReturns } from "@/content/legal";

// The text of this page exists in English only for now, so it is not announced as translated.
export const generateMetadata = localizedMetadata("/shipping-returns", {
  title: shippingReturns.title,
  description: shippingReturns.intro,
}, ENGLISH_ONLY);

export default function ShippingReturnsPage() {
  return <LegalPage doc={shippingReturns} />;
}
