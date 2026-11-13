"use client";

import { useMutation, useQuery } from "@apollo/client/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Checkbox, SelectField, TextField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Page";
import { useI18n } from "@/i18n/client";
import { SHIP_COOKIE } from "@/i18n/config";
import { countryName } from "@/i18n/format";
import { errorMessage } from "@/lib/apollo";
import { Checkout, ShippingOptionsQuery, StartPayment } from "@/lib/operations";
import { useCart, useCartActions } from "@/lib/store";

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-ink/20 pt-7">
      <legend className="float-left mb-7 flex w-full items-baseline gap-4">
        <span aria-hidden="true" className="text-ticket text-gold-700">
          {String(number).padStart(2, "0")}
        </span>
        <span className="text-h3">{title}</span>
      </legend>
      <div className="clear-both">{children}</div>
    </fieldset>
  );
}

/**
 * Checkout. The browser collects the address and choices; the server decides
 * prices, shipping, discount and stock, creates the order unpaid, and hands
 * back a link to the payment provider's own page. Nothing here can mark an
 * order paid.
 */
export function CheckoutView({ countries }: { countries: { code: string; name: string }[] }) {
  const router = useRouter();
  const { m, tag, href, fill, money, server } = useI18n();
  const c = m.checkout;
  const { cart, ready } = useCart();
  const actions = useCartActions();
  const [country, setCountry] = useState(() => {
    // The delivery country chosen in the selector, if we deliver there; it has nothing to do with the language.
    const chosen = typeof document === "undefined" ? null : (document.cookie.match(new RegExp(`(?:^|; )${SHIP_COOKIE}=([A-Z]{2})`))?.[1] ?? null);
    if (chosen && countries.some((option) => option.code === chosen)) return chosen;
    return countries.some((option) => option.code === "BE") ? "BE" : (countries[0]?.code ?? "BE");
  });
  const [chosenRate, setChosenRate] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeMessage, setCodeMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [separateBilling, setSeparateBilling] = useState(false);

  const shipping = useQuery(ShippingOptionsQuery, { variables: { countryCode: country }, skip: !ready || cart.lines.length === 0, fetchPolicy: "network-only" });
  const [placeOrder] = useMutation(Checkout);
  const [startPayment] = useMutation(StartPayment);

  if (!ready) return <p className="text-lead py-20 text-stone-700">{c.loading}</p>;

  if (cart.lines.length === 0 && !submitting) {
    return (
      <div className="border border-dashed border-ink/30 px-6 py-24 text-center">
        <p className="text-h2">{c.empty}</p>
        <ButtonLink href="/shop" arrow className="mt-8">
          {m.common.shopCta}
        </ButtonLink>
      </div>
    );
  }

  const options = shipping.data?.shippingOptions ?? [];
  const paymentAvailable = shipping.data?.paymentAvailable ?? false;
  const rate = options.find((option) => option.id === chosenRate) ?? options[0] ?? null;
  const totalCents = cart.subtotalCents - cart.discountCents + (rate?.priceCents ?? 0);

  const applyCode = async () => {
    setCodeMessage("");
    try {
      await actions.applyDiscount(code);
      setCode("");
      await shipping.refetch();
    } catch (cause) {
      setCodeMessage(server(errorMessage(cause)));
    }
  };

  const removeCode = async () => {
    await actions.removeDiscount();
    await shipping.refetch();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rate) return;
    const data = new FormData(event.currentTarget);
    const field = (name: string) => String(data.get(name) ?? "").trim();

    setSubmitting(true);
    setError("");
    try {
      const placed = await placeOrder({
        variables: {
          input: {
            email: field("email"),
            shippingRateId: rate.id,
            address: {
              firstName: field("firstName"),
              lastName: field("lastName"),
              line1: field("address1"),
              line2: field("address2") || null,
              postalCode: field("postalCode"),
              city: field("city"),
              countryCode: country,
              phone: field("phone") || null,
            },
            billing: separateBilling
              ? {
                  firstName: field("billFirstName"),
                  lastName: field("billLastName"),
                  company: field("billCompany") || null,
                  vatNumber: field("billVatNumber") || null,
                  line1: field("billAddress1"),
                  line2: field("billAddress2") || null,
                  postalCode: field("billPostalCode"),
                  city: field("billCity"),
                  countryCode: field("billCountry"),
                }
              : null,
            customerNote: field("note") || null,
          },
        },
      });
      const order = placed.data?.checkout;
      if (!order?.accessToken) throw new Error(c.failed);
      await actions.refresh();

      const confirmation = href("/order-confirmation") + `?order=${encodeURIComponent(order.number)}&token=${encodeURIComponent(order.accessToken)}`;
      if (!paymentAvailable) {
        router.push(confirmation);
        return;
      }
      const payment = await startPayment({ variables: { number: order.number, token: order.accessToken } });
      if (payment.data?.startPayment) window.location.assign(payment.data.startPayment);
      else router.push(confirmation);
    } catch (cause) {
      setError(server(errorMessage(cause)));
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-x-8 gap-y-12 lg:grid-cols-12">
      <div className="space-y-12 lg:col-span-7">
        <Step number={1} title={c.contact}>
          <TextField label={c.email} name="email" type="email" required autoComplete="email" hint={c.emailHint} />
        </Step>

        <Step number={2} title={c.delivery}>
          <div className="grid gap-x-6 gap-y-6 sm:grid-cols-2">
            <TextField label={c.firstName} name="firstName" required autoComplete="given-name" />
            <TextField label={c.lastName} name="lastName" required autoComplete="family-name" />
            <TextField label={c.street} name="address1" required autoComplete="address-line1" className="sm:col-span-2" />
            <TextField label={c.apartment} name="address2" autoComplete="address-line2" className="sm:col-span-2" />
            <TextField label={c.postalCode} name="postalCode" required autoComplete="postal-code" />
            <TextField label={c.city} name="city" required autoComplete="address-level2" />
            <SelectField
              label={c.country}
              name="country"
              required
              autoComplete="country"
              value={country}
              onChange={(event) => {
                setCountry(event.target.value);
                setChosenRate(null);
              }}
              className="sm:col-span-2"
            >
              {countries.map((option) => (
                <option key={option.code} value={option.code}>
                  {countryName(tag, option.code)}
                </option>
              ))}
            </SelectField>
            <TextField label={c.phone} name="phone" type="tel" autoComplete="tel" className="sm:col-span-2" hint={c.phoneHint} />
            <TextField label={c.note} name="note" maxLength={500} className="sm:col-span-2" />
          </div>
          <Checkbox label={c.separateBilling} name="separateBilling" checked={separateBilling} onChange={(event) => setSeparateBilling(event.target.checked)} className="mt-6" />
          {separateBilling && (
            <div className="mt-6 grid gap-x-6 gap-y-6 border-t border-ink/20 pt-7 sm:grid-cols-2">
              <p className="text-label sm:col-span-2">{c.invoiceAddress}</p>
              <TextField label={c.firstName} name="billFirstName" required autoComplete="billing given-name" />
              <TextField label={c.lastName} name="billLastName" required autoComplete="billing family-name" />
              <TextField label={c.company} name="billCompany" autoComplete="billing organization" />
              <TextField label={c.vatNumber} name="billVatNumber" />
              <TextField label={c.street} name="billAddress1" required autoComplete="billing address-line1" className="sm:col-span-2" />
              <TextField label={c.apartment} name="billAddress2" autoComplete="billing address-line2" className="sm:col-span-2" />
              <TextField label={c.postalCode} name="billPostalCode" required autoComplete="billing postal-code" />
              <TextField label={c.city} name="billCity" required autoComplete="billing address-level2" />
              <SelectField label={c.country} name="billCountry" required autoComplete="billing country" defaultValue={country} className="sm:col-span-2">
                {countries.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name}
                  </option>
                ))}
              </SelectField>
            </div>
          )}
        </Step>

        <Step number={3} title={c.shippingMethod}>
          {shipping.loading && options.length === 0 ? (
            <p className="text-stone-700">{c.finding}</p>
          ) : options.length === 0 ? (
            <p role="alert" className="text-terracotta-700">
              {c.noDelivery}
            </p>
          ) : (
            <div role="radiogroup" aria-label={c.shippingMethod} className="space-y-3">
              {options.map((option) => (
                <label
                  key={option.id}
                  className="flex min-h-16 cursor-pointer items-center justify-between gap-6 border border-ink/30 px-5 py-3 transition-colors duration-300 hover:border-ink has-[:checked]:border-olive-700 has-[:checked]:bg-olive-700/[0.06] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-gold-700"
                >
                  <span className="flex items-center gap-4">
                    <input type="radio" name="shipping" value={option.id} checked={rate?.id === option.id} onChange={() => setChosenRate(option.id)} className="size-4 accent-olive-700" />
                    <span>
                      <span className="block">{option.name}</span>
                      {option.estimate && <span className="text-small block text-stone-700">{option.estimate}</span>}
                    </span>
                  </span>
                  <span className="tabular-nums">{option.priceCents === 0 ? m.common.free : money(option.priceCents)}</span>
                </label>
              ))}
            </div>
          )}
        </Step>

        <Step number={4} title={c.payment}>
          {paymentAvailable ? (
            <p className="max-w-[60ch] text-ink/80">{c.paymentText}</p>
          ) : (
            <Notice title={c.noProviderTitle}>{c.noProviderText}</Notice>
          )}
        </Step>
      </div>

      <aside aria-labelledby="order-title" className="lg:col-span-4 lg:col-start-9">
        <div className="bg-paper p-7 lg:sticky lg:top-[calc(var(--header-h)+2rem)]">
          <h2 id="order-title" className="text-h3">
            {c.yourOrder}
          </h2>
          <ul className="mt-6 space-y-4 border-b border-ink/20 pb-6">
            {cart.lines.map((line) => (
              <li key={line.sku} className="flex justify-between gap-6">
                <span>
                  {line.product.name}
                  <span className="text-small block text-stone-700">
                    {line.variant.label} × {line.quantity}
                  </span>
                </span>
                <span className="tabular-nums">{money(line.lineTotalCents)}</span>
              </li>
            ))}
          </ul>

          {cart.discountCode ? (
            <div className="mt-6 flex items-center justify-between gap-4">
              <p>{fill(c.codeApplied, { code: cart.discountCode })}</p>
              <Button variant="text" onClick={removeCode}>
                {m.common.remove}
              </Button>
            </div>
          ) : (
            <div className="mt-6 flex items-end gap-3">
              <TextField label={c.discountCode} name="discount" autoComplete="off" value={code} onChange={(event) => setCode(event.target.value)} className="flex-1" />
              <Button variant="secondary" size="sm" disabled={code.trim() === ""} onClick={applyCode}>
                {c.apply}
              </Button>
            </div>
          )}
          <p role="status" className="text-small mt-2 min-h-5 text-terracotta-700">
            {codeMessage}
          </p>

          <dl className="mt-4 space-y-3 border-t border-ink/20 pt-6">
            <div className="flex justify-between gap-6">
              <dt>{c.subtotal}</dt>
              <dd className="tabular-nums">{money(cart.subtotalCents)}</dd>
            </div>
            {cart.discountCents > 0 && (
              <div className="flex justify-between gap-6">
                <dt>{c.discount}</dt>
                <dd className="tabular-nums">−{money(cart.discountCents)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-6">
              <dt>{c.shipping}</dt>
              <dd className="tabular-nums">{rate ? (rate.priceCents === 0 ? m.common.free : money(rate.priceCents)) : "—"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-6 border-t border-ink/20 pt-4">
              <dt className="text-h3">{c.total}</dt>
              <dd className="font-serif text-[1.75rem] tabular-nums">{money(totalCents)}</dd>
            </div>
          </dl>
          <p className="text-small mt-2 text-stone-700">{c.vatNote}</p>

          <Checkbox label={c.terms} name="terms" required className="mt-6" />
          <Button type="submit" disabled={submitting || !rate} className="mt-5 w-full">
            {submitting ? c.placing : paymentAvailable ? c.continueToPayment : c.placeUnpaid}
          </Button>
          <p role="alert" className="text-small mt-3 min-h-5 text-terracotta-700">
            {error}
          </p>
        </div>
      </aside>
    </form>
  );
}
