import { Card, Check, Field, Flash, LinkButton, Page, Select, Submit, TextArea, euros } from "@/components/admin/ui";
import { getProduct } from "@/server/admin";
import { PHOTOS_PER_PRODUCT, listProductPhotos } from "@/server/backoffice";
import { adminCtx } from "@/server/adminSession";
import { getProductProfile } from "@/server/provenance";
import { adjustStock, deletePhoto, deleteProduct, saveProduct, saveProductProfile, saveVariant, uploadPhoto } from "../../actions";

export const metadata = { title: "Product" };

export default async function ProductPage({ params, searchParams }: PageProps<"/admin/products/[id]">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [{ id }, flash, categories] = await Promise.all([params, searchParams, ctx.db.category.findMany({ orderBy: { position: "asc" } })]);
  const product = id === "new" ? null : await getProduct(ctx, id);
  const photos = product ? await listProductPhotos(ctx, product.id) : [];
  const profile = product ? await getProductProfile(ctx, product.id) : null;
  const chosen = new Map(profile?.product.varieties.map((entry) => [entry.varietyId, entry.percent]) ?? []);

  return (
    <Page title={product?.name ?? "New product"} eyebrow="Product" actions={<LinkButton href="/admin/products">All products</LinkButton>}>
      <Flash params={flash} />

      <form action={saveProduct.bind(null, product?.id ?? null)} className="space-y-8">
        <Card title="Details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" name="name" required defaultValue={product?.name} />
            <Field label="Web address" name="slug" required defaultValue={product?.slug} hint="Lowercase letters, numbers and hyphens. Appears in the page link." />
            <Select label="Category" name="categoryId" required defaultValue={product?.categoryId}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
            <div className="flex items-end gap-6">
              <Check label="Visible in the shop" name="isVisible" defaultChecked={product?.isVisible} />
              <Check label="Featured" name="isFeatured" defaultChecked={product?.isFeatured} />
            </div>
            <div className="sm:col-span-2">
              <Check label="Allow orders when out of stock (backorder)" name="allowBackorder" defaultChecked={product?.allowBackorder} />
              <p className="text-small mt-1 text-stone-700">Off by default. When on, a customer can pay for more than is in stock; the rest is sent as a separate parcel when it arrives, and they are told so in the cart and at checkout. Switch it on only if you are sure the stock is coming.</p>
            </div>
            <Field label="What to tell customers about the wait" name="backorderNote" maxLength={200} defaultValue={product?.backorderNote ?? ""} placeholder="The new harvest is expected in the first half of December." className="sm:col-span-2" hint="Shown beside the product when it is out of stock. Write only what you can keep to." />
            <Field label="Short description" name="blurb" defaultValue={product?.blurb} className="sm:col-span-2" />
            <TextArea label="Full description" name="description" rows={6} defaultValue={product?.description} className="sm:col-span-2" hint="Leave a blank line between paragraphs." />
          </div>
        </Card>

        <Card title="Label information" description="Shown on the product page exactly as entered. Leave a field empty if you do not have the confirmed information: the shop shows a dash rather than a guess. Food-labelling rules require these before the product is sold.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Origin" name="origin" defaultValue={product?.origin ?? ""} />
            <Field label="Olive variety" name="cultivar" defaultValue={product?.cultivar ?? ""} />
            <TextArea label="Ingredients" name="ingredients" rows={2} defaultValue={product?.ingredients ?? ""} />
            <TextArea label="Storage" name="storage" rows={2} defaultValue={product?.storage ?? ""} />
            <Field label="Not sent to these countries" name="excludedCountries" defaultValue={product?.excludedCountries.join(", ") ?? ""} hint="Two-letter codes, separated by commas. Empty means anywhere we deliver. Use it where a product may not be sold or imported." />
            <Field label="Customs (HS) code" name="hsCode" inputMode="numeric" defaultValue={product?.hsCode ?? ""} hint="6 to 10 digits. Needed on labels for parcels leaving the EU. Confirm the code with your customs adviser." />
            <Field label="Country of origin" name="originCountry" maxLength={2} defaultValue={product?.originCountry ?? ""} hint="Two-letter code, such as IT." />
            <Field label="Customs description" name="customsDescription" defaultValue={product?.customsDescription ?? ""} hint="Plain description of the goods for the customs declaration." />
          </div>
          <p className="text-small mt-4 text-stone-700">The nutrition table, certifications and awards are not editable here yet. Harvest, mill and bottling dates are recorded per lot.</p>
        </Card>

        <Card title="Search engines">
          <div className="grid gap-4">
            <Field label="Page title" name="seoTitle" maxLength={70} defaultValue={product?.seoTitle ?? ""} hint="Up to 70 characters. Defaults to the product name." />
            <TextArea label="Description" name="seoDescription" maxLength={170} rows={2} defaultValue={product?.seoDescription ?? ""} hint="Up to 170 characters." />
          </div>
        </Card>

        <Submit>{product ? "Save product" : "Create product"}</Submit>
      </form>

      {product && (
        <>
          <Card title="Sizes, prices and stock" description="Each size is sold separately. Prices include VAT.">
            <div className="space-y-6">
              {[...product.variants, null].map((variant) => (
                <div key={variant?.id ?? "new"} className="border-b border-ink/10 pb-6 last:border-0 last:pb-0">
                  <form action={saveVariant.bind(null, product.id, variant?.id ?? null)} className="grid items-end gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
                    <Field label={variant ? "Label" : "New size"} name="label" required defaultValue={variant?.label} placeholder="250 ml" />
                    <Field label="SKU" name="sku" required defaultValue={variant?.sku} />
                    <Field label="Volume (ml)" name="volumeMl" inputMode="numeric" required defaultValue={variant?.volumeMl} />
                    <Field label="Price (€)" name="priceCents" inputMode="decimal" required defaultValue={euros(variant?.priceCents)} />
                    <Field label="Was (€)" name="compareAtCents" inputMode="decimal" defaultValue={euros(variant?.compareAtCents)} />
                    <Field label="Price (USD)" name="priceUSD" inputMode="decimal" defaultValue={euros(variant?.prices.find((price) => price.currency === "USD")?.priceCents)} />
                    <Field label="Price (GBP)" name="priceGBP" inputMode="decimal" defaultValue={euros(variant?.prices.find((price) => price.currency === "GBP")?.priceCents)} />
                    <Field label="Weight (g)" name="weightGrams" inputMode="numeric" required defaultValue={variant?.weightGrams} />
                    <Field label="Low at" name="lowStockThreshold" inputMode="numeric" defaultValue={variant?.lowStockThreshold ?? 6} />
                    <Field label="Barcode" name="barcode" inputMode="numeric" defaultValue={variant?.barcode ?? ""} />
                    <Field label="Unit cost (€)" name="costCents" inputMode="decimal" defaultValue={euros(variant?.costCents)} />
                    <Field label="Location" name="location" defaultValue={variant?.location ?? ""} />
                    <Check label="On sale" name="isActive" defaultChecked={variant?.isActive ?? true} />
                    <Submit variant={variant ? "secondary" : "primary"}>{variant ? "Save" : "Add"}</Submit>
                  </form>
                  {variant && (
                    <form action={adjustStock.bind(null, product.id, variant.id)} className="mt-3 flex flex-wrap items-end gap-3 bg-[#f3f1ea] p-3">
                      <p className="mr-auto self-center text-[0.9375rem]">
                        <strong>{variant.stock}</strong> on hand · {variant.reserved} held by unpaid orders · <strong>{variant.stock - variant.reserved}</strong> available
                      </p>
                      <Field label="Add / remove" name="delta" inputMode="numeric" required placeholder="+24 or -2" className="w-32" />
                      <Select label="Reason" name="reason" className="w-40">
                        <option value="RECEIVED">Received</option>
                        <option value="ADJUSTMENT">Correction</option>
                        <option value="RETURN">Return</option>
                        <option value="DAMAGED">Damaged</option>
                      </Select>
                      <Field label="Note" name="note" className="w-48" />
                      <Submit variant="secondary">Update stock</Submit>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <Card title="Remove product">
            <form action={deleteProduct.bind(null, product.id)} className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-[60ch] text-stone-700">Removes the product from the shop. Past orders keep their record of it.</p>
              <Submit variant="danger">Remove from sale</Submit>
            </form>
          </Card>
        </>
      )}
      {profile && (
        <Card
          title="Origin, varieties and tasting"
          description="Shown on the product page as entered. Leave empty what you cannot document: the shop shows a dash. Choosing a variety or a region fills in nothing else. Laboratory values are not entered here: they belong to a harvest batch, under Harvest batches."
        >
          <form action={saveProductProfile.bind(null, profile.product.id)} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="Country of origin" name="originCountry" maxLength={2} defaultValue={profile.product.originCountry ?? ""} placeholder="GR" hint="Two-letter code. Also used on customs documents. Taken from the region when one is chosen." />
              <Select label="Region" name="regionId" defaultValue={profile.product.regionId ?? ""}>
                <option value="">Not recorded</option>
                {profile.regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.countryCode} · {region.name}
                  </option>
                ))}
              </Select>
              <Select label="Producer" name="producerId" defaultValue={profile.product.producerId ?? ""}>
                <option value="">Not recorded</option>
                {profile.producers.map((producer) => (
                  <option key={producer.id} value={producer.id}>
                    {producer.name}
                  </option>
                ))}
              </Select>
              <Select label="Single variety or blend" name="composition" defaultValue={profile.product.composition ?? ""}>
                <option value="">Not recorded</option>
                <option value="SINGLE_VARIETY">Single variety</option>
                <option value="BLEND">Blend</option>
              </Select>
            </div>

            <fieldset>
              <legend className="text-small font-medium">Olive varieties</legend>
              {profile.varieties.length === 0 ? (
                <p className="text-small mt-2 text-stone-700">No variety has been set up yet. Add them under Olive varieties.</p>
              ) : (
                <ul className="mt-2 grid gap-x-8 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
                  {profile.varieties.map((variety) => (
                    <li key={variety.id} className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="variety" value={variety.id} defaultChecked={chosen.has(variety.id)} className="size-4 accent-olive-700" />
                        {variety.name}
                      </label>
                      <input name={`percent:${variety.id}`} defaultValue={chosen.get(variety.id) ?? ""} inputMode="numeric" maxLength={3} aria-label={`Share of ${variety.name} in percent`} placeholder="%" className="h-9 w-16 border border-ink/25 bg-white px-2 text-right" />
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-small mt-2 text-stone-700">Shares are optional. If given, give one for every ticked variety, adding up to 100.</p>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Harvesting method" name="harvestMethod" defaultValue={profile.product.harvestMethod ?? ""} placeholder="Hand-picked into nets" />
              <Field label="Extraction method" name="extractionMethod" defaultValue={profile.product.extractionMethod ?? ""} placeholder="Cold extraction, two-phase" hint="“Cold extraction” and “first cold pressing” are regulated label terms: use them only if the producer documents them." />
              <TextArea label="Aroma" name="aroma" rows={2} defaultValue={profile.product.aroma ?? ""} />
              <TextArea label="Taste" name="taste" rows={2} defaultValue={profile.product.taste ?? ""} />
              <Select label="Bitterness" name="bitterness" defaultValue={profile.product.bitterness ?? ""}>
                <option value="">Not recorded</option>
                {[0, 1, 2, 3, 4, 5].map((level) => (
                  <option key={level} value={level}>
                    {level} of 5
                  </option>
                ))}
              </Select>
              <Select label="Pungency" name="pungency" defaultValue={profile.product.pungency ?? ""}>
                <option value="">Not recorded</option>
                {[0, 1, 2, 3, 4, 5].map((level) => (
                  <option key={level} value={level}>
                    {level} of 5
                  </option>
                ))}
              </Select>
              <TextArea label="Food pairings" name="pairings" rows={2} defaultValue={profile.product.pairings ?? ""} />
              <Field label="Packaging" name="packaging" defaultValue={profile.product.packaging ?? ""} placeholder="Dark glass bottle, screw cap" />
            </div>
            <p className="text-small text-stone-700">Bitterness and pungency are the house’s own tasting judgement on a 0 to 5 scale, and are labelled as such on the shop. They are not laboratory values.</p>
            <Submit>Save origin and tasting</Submit>
          </form>
        </Card>
      )}
      {product && (
        <Card title="Photos" description={`JPEG, PNG or WebP, up to 4 MB each, at most ${PHOTOS_PER_PRODUCT}. Photos are stored and kept ready for the shop; the product page still shows the illustrated bottle until the photo layout is designed.`}>
          {photos.length > 0 && (
            <ul className="mb-6 grid gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {photos.map((photo) => (
                <li key={photo.id} className="border border-ink/10 p-3">
                  {/* Admin preview of an uploaded file: next/image optimisation is not needed here. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/admin/products/${product.id}/photo/${photo.id}`} alt={photo.alt} className="aspect-square w-full bg-stone-300/30 object-contain" />
                  <p className="text-small mt-2">{photo.alt}</p>
                  <p className="text-small text-stone-700">{photo.bytes ? `${Math.round(photo.bytes / 1024)} KB` : ""}</p>
                  <form action={deletePhoto.bind(null, product.id, photo.id)} className="mt-2">
                    <Submit variant="danger" className="!h-9 !px-3">Delete</Submit>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={uploadPhoto.bind(null, product.id)} className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-small font-medium">Photo</span>
              <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required className="mt-1.5 block w-full border border-ink/25 bg-white p-2 text-[0.9375rem]" />
            </label>
            <Field label="Description (alt text)" name="alt" required maxLength={200} hint="What the photo shows, in a few words." />
            <div className="sm:col-span-2">
              <Submit>Upload photo</Submit>
            </div>
          </form>
        </Card>
      )}
    </Page>
  );
}
