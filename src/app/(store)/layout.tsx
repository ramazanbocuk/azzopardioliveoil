import { StoreChrome } from "@/components/layout/StoreChrome";

export default function StoreLayout({ children }: LayoutProps<"/">) {
  return <StoreChrome>{children}</StoreChrome>;
}
