"use client";

import { Link } from "@/components/ui/Link";
import { useState } from "react";
import { Bottle } from "@/components/ui/Bottle";
import { ButtonLink } from "@/components/ui/Button";
import { QuantityStepper } from "@/components/ui/Field";
import { bottleScale, productHref } from "@/content/site";
import { useI18n } from "@/i18n/client";
import { errorMessage } from "@/lib/apollo";
import { useCart, useCartActions } from "@/lib/store";

export function CartView() {
  const { cart, ready } = useCart();
  const { m, fill, plural, money: format, server } = useI18n();
  const c = m.cart;
  const actions = useCartActions();
  const [error, setError] = useState("");

  const run = async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(server(errorMessage(cause)));
    }
  };

  if (!ready) return <p className="text-lead py-20 text-stone-700">{c.loading}</p>;

  if (cart.lines.length === 0) {
    return (
      <div className="border border-dashed border-ink/30 px-6 py-24 text-center">
        <p className="text-h2">{c.empty}</p>
        <p className="mt-4 text-ink/80">{c.emptyHint}</p>
        <ButtonLink href="/shop" arrow className="mt-8">
          {m.common.shopCta}
        </ButtonLink>
      </div>
    );
  }

  // The cart carries its own currency: that of the country it will be delivered to.
  const money = (cents: number) => format(cents, cart.currency);
  const blocked = cart.lines.some((line) => !line.enoughStock || !line.sold);

  return (
    <div className="grid gap-x-8 gap-y-12 lg:grid-cols-12">
      <div className="lg:col-span-7">
        <p role="alert" className="text-small min-h-6 text-terracotta-700">
          {error}
        </p>
        <ul className="border-t border-ink/20">
          {cart.lines.map((line) => {
            const name = `${line.product.name} ${line.variant.label}`;
            return (
              <li key={line.sku} className="flex gap-5 border-b border-ink/20 py-6 sm:gap-8">
                <div className="relative aspect-[4/5] w-24 shrink-0 bg-paper sm:w-32">
                  <div className="absolute inset-x-0 bottom-[8%] top-[8%] flex items-end justify-center">
                    <Bottle ml={line.variant.volumeMl} lot={null} className="w-auto" style={{ height: `${bottleScale(line.variant.volumeMl) * 100}%` }} />
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-h3">
                        <Link href={productHref(line.product, line.variant.volumeMl)} className="link-underline">
                          {line.product.name}
                        </Link>
                      </h2>
                      <p className="text-small mt-1 text-stone-700">
                        {line.variant.label}{line.sold ? ` · ${fill(c.each, { price: money(line.unitPriceCents) })}` : ""}
                      </p>
                      {!line.sold && <p className="text-small mt-2 text-terracotta-700">{m.shop.notSoldInCart}</p>}
                      {!line.enoughStock && <p className="text-small mt-2 text-terracotta-700">{c.notEnough}</p>}
                      {line.enoughStock && line.backorderQuantity > 0 && (
                        <p className="text-small mt-2 text-ink/80">{line.backorderQuantity >= line.quantity ? m.fulfil.cartAll : fill(m.fulfil.cartPart, { now: line.quantity - line.backorderQuantity, later: line.backorderQuantity })}</p>
                      )}
                    </div>
                    <p className="text-lead shrink-0 tabular-nums">{line.sold ? money(line.lineTotalCents) : "—"}</p>
                  </div>
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-4 pt-5">
                    <QuantityStepper label={fill(c.quantityFor, { name })} value={line.quantity} onChange={(quantity) => run(() => actions.setQuantity(line.sku, quantity))} />
                    <button type="button" onClick={() => run(() => actions.remove(line.sku))} aria-label={fill(c.removeName, { name })} className="text-label link-underline inline-flex min-h-11 items-center text-stone-700 hover:text-ink">
                      {m.common.remove}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <aside aria-labelledby="summary-title" className="lg:col-span-4 lg:col-start-9">
        <div className="bg-paper p-7 lg:sticky lg:top-[calc(var(--header-h)+2rem)]">
          <h2 id="summary-title" className="text-h3">
            {c.summary}
          </h2>
          <dl className="mt-6 space-y-3">
            <div className="flex justify-between gap-6">
              <dt>{plural(cart.itemCount, c.subtotal)}</dt>
              <dd className="tabular-nums">{money(cart.subtotalCents)}</dd>
            </div>
            {cart.discountCents > 0 && (
              <div className="flex justify-between gap-6">
                <dt>{fill(c.discount, { code: cart.discountCode ?? "" })}</dt>
                <dd className="tabular-nums">−{money(cart.discountCents)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-6 text-ink/80">
              <dt>{c.shipping}</dt>
              <dd>{c.atCheckout}</dd>
            </div>
          </dl>

          {blocked ? (
            <p className="text-small mt-8 text-terracotta-700">{c.adjust}</p>
          ) : (
            <ButtonLink href="/checkout" arrow className="mt-8 w-full">
              {c.checkout}
            </ButtonLink>
          )}
          <ButtonLink href="/shop" variant="text" className="mt-3">
            {c.continue}
          </ButtonLink>
          <p className="text-small mt-5 text-stone-700">{c.pricesVat}</p>
        </div>
      </aside>
    </div>
  );
}
