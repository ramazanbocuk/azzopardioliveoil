import type { Metadata } from "next";
import { AccountView, FavouritesList } from "@/components/account/AccountViews";
import { PageHeader } from "@/components/ui/Page";
import { getI18n } from "@/i18n/server";
import { getCatalogData } from "@/server/storefrontData";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getI18n()).m.account.metaTitle, robots: { index: false, follow: false } };
}

export default async function AccountPage() {
  const { m, language } = await getI18n();
  const { items } = await getCatalogData(language);
  return (
    <>
      <PageHeader eyebrow={m.account.eyebrow} title={m.account.title} size="h1" />
      <section className="container-page pb-section-sm">
        <AccountView />
      </section>

      <section id="favourites" aria-labelledby="favourites-title" className="container-page scroll-mt-(--header-h) border-t border-ink/15 py-section-sm">
        <h2 id="favourites-title" className="text-h2">
          {m.account.favourites}
        </h2>
        <p className="text-small mt-3 text-stone-700">{m.account.savedHere}</p>
        <div className="mt-10">
          <FavouritesList items={items} />
        </div>
      </section>
    </>
  );
}
