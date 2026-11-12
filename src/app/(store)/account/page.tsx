import type { Metadata } from "next";
import { AccountView, FavouritesList } from "@/components/account/AccountViews";
import { PageHeader } from "@/components/ui/Page";
import { getCatalogData } from "@/server/storefrontData";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const { items } = await getCatalogData();
  return (
    <>
      <PageHeader eyebrow="Account" title="Your account" size="h1" />
      <section className="container-page pb-section-sm">
        <AccountView />
      </section>

      <section id="favourites" aria-labelledby="favourites-title" className="container-page scroll-mt-(--header-h) border-t border-ink/15 py-section-sm">
        <h2 id="favourites-title" className="text-h2">
          Favourites
        </h2>
        <p className="text-small mt-3 text-stone-700">Saved in this browser.</p>
        <div className="mt-10">
          <FavouritesList items={items} />
        </div>
      </section>
    </>
  );
}
