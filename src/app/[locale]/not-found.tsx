import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Page";
import { getI18n } from "@/i18n/server";

export default async function NotFound() {
  const { m } = await getI18n();
  return (
    <PageHeader eyebrow="404" title={m.notFound.title} lead={m.notFound.lead}>
      <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3">
        <ButtonLink href="/" arrow>
          {m.common.backHome}
        </ButtonLink>
        <ButtonLink href="/shop" variant="text" arrow>
          {m.common.shopCta}
        </ButtonLink>
      </div>
    </PageHeader>
  );
}
