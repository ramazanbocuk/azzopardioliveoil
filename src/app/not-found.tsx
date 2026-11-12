import { StoreChrome } from "@/components/layout/StoreChrome";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/Page";

export default function NotFound() {
  return (
    <StoreChrome>
    <PageHeader eyebrow="404" title="This page has gone astray." lead="The address may have changed, or the page may not exist yet.">
      <div className="mt-10 flex flex-wrap gap-x-8 gap-y-3">
        <ButtonLink href="/" arrow>
          Back to the house
        </ButtonLink>
        <ButtonLink href="/shop" variant="text" arrow>
          Shop the oil
        </ButtonLink>
      </div>
    </PageHeader>
    </StoreChrome>
  );
}
