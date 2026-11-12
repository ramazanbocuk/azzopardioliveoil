"use client";

import { useMutation, useQuery } from "@apollo/client/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Checkbox, SelectField, TextField } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Page";
import { formatPrice, shippingCountries } from "@/content/site";
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
export function CheckoutView() {
  const router = useRouter();
  const { cart, ready } = useCart();
  const actions = useCartActions();
  const [country, setCountry] = useState("BE");
  const [chosenRate, setChosenRate] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeMessage, setCodeMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [separateBilling, setSeparateBilling] = useState(false);

  const shipping = useQuery(ShippingOptionsQuery, { variables: { countryCode: country }, skip: !ready || cart.lines.length === 0, fetchPolicy: "network-only" });
  const [placeOrder] = useMutation(Checkout);
  const [startPayment] = useMutation(StartPayment);

  if (!ready) return <p className="text-lead py-20 text-stone-700">Loading checkout…</p>;

  if (cart.lines.length === 0 && !submitting) {
    return (
      <div className="border border-dashed border-ink/30 px-6 py-24 text-center">
        <p className="text-h2">There is nothing to check out.</p>
        <ButtonLink href="/shop" arrow className="mt-8">
          Shop the oil
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
      setCodeMessage(errorMessage(cause));
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
      if (!order?.accessToken) throw new Error("The order could not be created.");
      await actions.refresh();

      const confirmation = `/order-confirmation?order=${encodeURIComponent(order.number)}&token=${encodeURIComponent(order.accessToken)}`;
      if (!paymentAvailable) {
        router.push(confirmation);
        return;
      }
      const payment = await startPayment({ variables: { number: order.number, token: order.accessToken } });
      if (payment.data?.startPayment) window.location.assign(payment.data.startPayment);
      else router.push(confirmation);
    } catch (cause) {
      setError(errorMessage(cause));
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-x-8 gap-y-12 lg:grid-cols-12">
      <div className="space-y-12 lg:col-span-7">
        <Step number={1} title="Contact">
          <TextField label="Email address" name="email" type="email" required autoComplete="email" hint="For your order confirmation and tracking link." />
        </Step>

        <Step number={2} title="Delivery address">
          <div className="grid gap-x-6 gap-y-6 sm:grid-cols-2">
            <TextField label="First name" name="firstName" required autoComplete="given-name" />
            <TextField label="Last name" name="lastName" required autoComplete="family-name" />
            <TextField label="Street and number" name="address1" required autoComplete="address-line1" className="sm:col-span-2" />
            <TextField label="Apartment, box (optional)" name="address2" autoComplete="address-line2" className="sm:col-span-2" />
            <TextField label="Postal code" name="postalCode" required autoComplete="postal-code" />
            <TextField label="City" name="city" required autoComplete="address-level2" />
            <SelectField
              label="Country"
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
              {shippingCountries.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name}
                </option>
              ))}
            </SelectField>
            <TextField label="Phone (optional)" name="phone" type="tel" autoComplete="tel" className="sm:col-span-2" hint="Only used by the carrier for delivery." />
            <TextField label="Note for your order (optional)" name="note" maxLength={500} className="sm:col-span-2" />
          </div>
          <Checkbox label="Send the invoice to a different address or company" name="separateBilling" checked={separateBilling} onChange={(event) => setSeparateBilling(event.target.checked)} className="mt-6" />
          {separateBilling && (
            <div className="mt-6 grid gap-x-6 gap-y-6 border-t border-ink/20 pt-7 sm:grid-cols-2">
              <p className="text-label sm:col-span-2">Invoice address</p>
              <TextField label="First name" name="billFirstName" required autoComplete="billing given-name" />
              <TextField label="Last name" name="billLastName" required autoComplete="billing family-name" />
              <TextField label="Company (optional)" name="billCompany" autoComplete="billing organization" />
              <TextField label="VAT number (optional)" name="billVatNumber" />
              <TextField label="Street and number" name="billAddress1" required autoComplete="billing address-line1" className="sm:col-span-2" />
              <TextField label="Apartment, box (optional)" name="billAddress2" autoComplete="billing address-line2" className="sm:col-span-2" />
              <TextField label="Postal code" name="billPostalCode" required autoComplete="billing postal-code" />
              <TextField label="City" name="billCity" required autoComplete="billing address-level2" />
              <SelectField label="Country" name="billCountry" required autoComplete="billing country" defaultValue={country} className="sm:col-span-2">
                {shippingCountries.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name}
                  </option>
                ))}
              </SelectField>
            </div>
          )}
        </Step>

        <Step number={3} title="Shipping method">
          {shipping.loading && options.length === 0 ? (
            <p className="text-stone-700">Finding shipping options…</p>
          ) : options.length === 0 ? (
            <p role="alert" className="text-terracotta-700">
              We do not deliver to this country yet.
            </p>
          ) : (
            <div role="radiogroup" aria-label="Shipping method" className="space-y-3">
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
                  <span className="tabular-nums">{option.priceCents === 0 ? "Free" : formatPrice(option.priceCents)}</span>
                </label>
              ))}
            </div>
          )}
        </Step>

        <Step number={4} title="Payment">
          {paymentAvailable ? (
            <p className="max-w-[60ch] text-ink/80">You will be taken to our payment provider’s secure page to pay. Card details are never seen or stored by this site. Your order is confirmed once the payment has been received.</p>
          ) : (
            <Notice title="Online payment is not connected yet">
              No payment provider is configured, so this order will be saved as <strong>awaiting payment</strong> and its stock held for 40 minutes. Nothing is charged.
            </Notice>
          )}
        </Step>
      </div>

      <aside aria-labelledby="order-title" className="lg:col-span-4 lg:col-start-9">
        <div className="bg-paper p-7 lg:sticky lg:top-[calc(var(--header-h)+2rem)]">
          <h2 id="order-title" className="text-h3">
            Your order
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
                <span className="tabular-nums">{formatPrice(line.lineTotalCents)}</span>
              </li>
            ))}
          </ul>

          {cart.discountCode ? (
            <div className="mt-6 flex items-center justify-between gap-4">
              <p>
                Code <strong>{cart.discountCode}</strong> applied
              </p>
              <Button variant="text" onClick={removeCode}>
                Remove
              </Button>
            </div>
          ) : (
            <div className="mt-6 flex items-end gap-3">
              <TextField label="Discount code" name="discount" autoComplete="off" value={code} onChange={(event) => setCode(event.target.value)} className="flex-1" />
              <Button variant="secondary" size="sm" disabled={code.trim() === ""} onClick={applyCode}>
                Apply
              </Button>
            </div>
          )}
          <p role="status" className="text-small mt-2 min-h-5 text-terracotta-700">
            {codeMessage}
          </p>

          <dl className="mt-4 space-y-3 border-t border-ink/20 pt-6">
            <div className="flex justify-between gap-6">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{formatPrice(cart.subtotalCents)}</dd>
            </div>
            {cart.discountCents > 0 && (
              <div className="flex justify-between gap-6">
                <dt>Discount</dt>
                <dd className="tabular-nums">−{formatPrice(cart.discountCents)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-6">
              <dt>Shipping</dt>
              <dd className="tabular-nums">{rate ? (rate.priceCents === 0 ? "Free" : formatPrice(rate.priceCents)) : "—"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-6 border-t border-ink/20 pt-4">
              <dt className="text-h3">Total</dt>
              <dd className="font-serif text-[1.75rem] tabular-nums">{formatPrice(totalCents)}</dd>
            </div>
          </dl>
          <p className="text-small mt-2 text-stone-700">VAT included. The final amount is confirmed by the server when you place the order.</p>

          <Checkbox label="I have read the terms and conditions and the privacy policy" name="terms" required className="mt-6" />
          <Button type="submit" disabled={submitting || !rate} className="mt-5 w-full">
            {submitting ? "Placing order…" : paymentAvailable ? "Continue to payment" : "Place order (unpaid)"}
          </Button>
          <p role="alert" className="text-small mt-3 min-h-5 text-terracotta-700">
            {error}
          </p>
        </div>
      </aside>
    </form>
  );
}
