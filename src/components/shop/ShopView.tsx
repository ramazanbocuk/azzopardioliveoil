"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { SelectField, TextField } from "@/components/ui/Field";
import { ProductCard } from "@/components/ui/ProductCard";
import { Button } from "@/components/ui/Button";
import type { CatalogItem } from "@/content/site";
import { useI18n } from "@/i18n/client";

type Sort = "featured" | "price-asc" | "price-desc" | "size-asc";

/** Sorting by price uses the visitor's currency; a size not sold in it goes last. */
const sorters = (price: (variant: CatalogItem["variant"]) => number | null): Record<Sort, (a: CatalogItem, b: CatalogItem) => number> => ({
  featured: () => 0,
  "price-asc": (a, b) => (price(a.variant) ?? Infinity) - (price(b.variant) ?? Infinity),
  "price-desc": (a, b) => (price(b.variant) ?? -Infinity) - (price(a.variant) ?? -Infinity),
  "size-asc": (a, b) => a.variant.ml - b.variant.ml,
});

/**
 * Search, filter and sort over the catalogue. Runs in the browser on the
 * placeholder data; from Phase 5 the same controls drive a paginated,
 * filtered GraphQL query instead.
 */
export function ShopView({ items, autoFocusSearch = false }: { items: CatalogItem[]; autoFocusSearch?: boolean }) {
  const { m, plural, price } = useI18n();
  const s = m.shop;
  const [query, setQuery] = useState("");
  const [sizes, setSizes] = useState<number[]>([]);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("featured");

  const allSizes = useMemo(() => [...new Set(items.map((item) => item.variant.ml))].sort((a, b) => a - b), [items]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items
      .filter((item) => !needle || `${item.product.name} ${item.category.name} ${item.variant.ml} ml ${item.product.lot}`.toLowerCase().includes(needle))
      .filter((item) => sizes.length === 0 || sizes.includes(item.variant.ml))
      .filter((item) => !inStockOnly || item.variant.inStock)
      .sort(sorters(price)[sort]);
  }, [items, query, sizes, inStockOnly, sort, price]);

  const toggleSize = (ml: number) => setSizes((current) => (current.includes(ml) ? current.filter((s) => s !== ml) : [...current, ml]));
  const filtered = query !== "" || sizes.length > 0 || inStockOnly;
  const reset = () => {
    setQuery("");
    setSizes([]);
    setInStockOnly(false);
  };

  const chip = (active: boolean) =>
    clsx(
      "text-label inline-flex h-11 items-center border px-4 transition-colors duration-300",
      active ? "border-olive-700 bg-olive-700 text-ivory" : "border-ink/30 hover:border-ink",
    );

  return (
    <div>
      <form role="search" onSubmit={(event) => event.preventDefault()} className="grid gap-x-8 gap-y-6 border-y border-ink/15 py-6 lg:grid-cols-12 lg:items-end">
        <TextField
          label={s.search}
          type="search"
          name="q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={s.searchPlaceholder}
          autoFocus={autoFocusSearch}
          className="lg:col-span-4"
        />
        <fieldset className="lg:col-span-5">
          <legend className="text-label mb-3 opacity-80">{s.filter}</legend>
          <div className="flex flex-wrap gap-2">
            {allSizes.map((ml) => (
              <button key={ml} type="button" aria-pressed={sizes.includes(ml)} onClick={() => toggleSize(ml)} className={chip(sizes.includes(ml))}>
                {ml} ml
              </button>
            ))}
            <button type="button" aria-pressed={inStockOnly} onClick={() => setInStockOnly((value) => !value)} className={chip(inStockOnly)}>
              {s.inStock}
            </button>
          </div>
        </fieldset>
        <SelectField label={s.sortBy} name="sort" value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="lg:col-span-3">
          <option value="featured">{s.featured}</option>
          <option value="price-asc">{s.priceAsc}</option>
          <option value="price-desc">{s.priceDesc}</option>
          <option value="size-asc">{s.sizeAsc}</option>
        </SelectField>
      </form>

      <div className="mt-5 flex min-h-11 items-center justify-between gap-6">
        <p role="status" className="text-small text-stone-700">
          {plural(results.length, s.count)}
        </p>
        {filtered && (
          <Button variant="text" onClick={reset}>
            {s.clear}
          </Button>
        )}
      </div>

      {results.length > 0 ? (
        <ul className="mt-8 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((item) => (
            <li key={item.variant.sku}>
              <ProductCard item={item} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-8 border border-dashed border-ink/30 px-6 py-20 text-center">
          <p className="text-h3">{s.none}</p>
          <Button variant="secondary" onClick={reset} className="mt-6">
            {s.showAll}
          </Button>
        </div>
      )}
    </div>
  );
}
