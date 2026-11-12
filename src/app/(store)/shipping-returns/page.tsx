import type { Metadata } from "next";
import { LegalPage } from "@/components/ui/LegalPage";
import { shippingReturns } from "@/content/legal";

export const metadata: Metadata = {
  title: shippingReturns.title,
  description: shippingReturns.intro,
  alternates: { canonical: "/shipping-returns" },
};

export default function ShippingReturnsPage() {
  return <LegalPage doc={shippingReturns} />;
}
