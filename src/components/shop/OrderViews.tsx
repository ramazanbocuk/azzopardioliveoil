"use client";

import { useLazyQuery, useMutation, useQuery } from "@apollo/client/react";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { LotTicket } from "@/components/ui/LotTicket";
import { Notice } from "@/components/ui/Page";
import { formatPrice } from "@/content/site";
import type { OrderFieldsFragment } from "@/gql/graphql";
import { errorMessage } from "@/lib/apollo";
import { OrderByTokenQuery, StartPayment, TrackOrderQuery } from "@/lib/operations";
import { useHydrated } from "@/lib/store";

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  PAID: "Paid — being prepared",
  FULFILLING: "Being packed",
  SHIPPED: "On its way",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export function OrderSummary({ order }: { order: OrderFieldsFragment }) {
  return (
    <div>
      <ul className="border-t border-ink/20">
        {order.items.map((item) => (
          <li key={item.sku} className="flex justify-between gap-6 border-b border-ink/20 py-4">
            <span>
              {item.productName}
              <span className="text-small block text-stone-700">
                {item.variantLabel} × {item.quantity}
                {item.lotNumber ? ` · Lot ${item.lotNumber}` : ""}
              </span>
            </span>
            <span className="tabular-nums">{formatPrice(item.lineTotalCents)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-5 space-y-2">
        <div className="flex justify-between gap-6">
          <dt>Subtotal</dt>
          <dd className="tabular-nums">{formatPrice(order.subtotalCents)}</dd>
        </div>
        {order.discountCents > 0 && (
          <div className="flex justify-between gap-6">
            <dt>Discount</dt>
            <dd className="tabular-nums">−{formatPrice(order.discountCents)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-6">
          <dt>Shipping ({order.shippingRateName})</dt>
          <dd className="tabular-nums">{order.shippingCents === 0 ? "Free" : formatPrice(order.shippingCents)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-6 border-t border-ink/20 pt-3">
          <dt className="text-h3">Total</dt>
          <dd className="font-serif text-[1.75rem] tabular-nums">{formatPrice(order.totalCents)}</dd>
        </div>
        {order.taxCents !== null && order.taxCents !== undefined && (
          <div className="text-small flex justify-between gap-6 text-stone-700">
            <dt>Includes VAT</dt>
            <dd className="tabular-nums">{formatPrice(order.taxCents)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function OrderTimeline({ order }: { order: OrderFieldsFragment }) {
  return (
    <div>
      <ol>
        {order.events.map((event, index) => (
          <li key={`${event.kind}-${event.at}`} className="relative flex gap-5 pb-7 last:pb-0">
            {index < order.events.length - 1 && <span aria-hidden="true" className="absolute left-[7px] top-4 h-full w-px bg-ink/20" />}
            <span aria-hidden="true" className="relative mt-1 block size-[15px] shrink-0 rounded-full border border-olive-700 bg-olive-700" />
            <span>
              {event.message}
              <span className="text-small block text-stone-700">{when(event.at)}</span>
            </span>
          </li>
        ))}
      </ol>
      {order.shipments.map((shipment) => (
        <p key={shipment.trackingNumber ?? shipment.carrier} className="mt-6 border-t border-ink/20 pt-5">
          {shipment.carrier}
          {shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ""}
          {shipment.trackingUrl && (
            <a href={shipment.trackingUrl} rel="noreferrer" className="ml-3 underline underline-offset-4">
              Track with carrier
            </a>
          )}
        </p>
      ))}
    </div>
  );
}

/** Order page reached from the private link issued at checkout. Shows the truth as the server knows it. */
export function ConfirmationView() {
  const hydrated = useHydrated();
  const params = useSearchParams();
  const number = params.get("order") ?? "";
  const token = params.get("token") ?? "";
  const cancelled = params.get("cancelled") === "1";
  const [payError, setPayError] = useState("");
  const [startPayment, payment] = useMutation(StartPayment);

  const { data, loading } = useQuery(OrderByTokenQuery, { variables: { number, token }, skip: !hydrated || !number || !token, fetchPolicy: "network-only", pollInterval: 4000, skipPollAttempt: () => document.hidden });
  const order = data?.orderByToken ?? null;

  if (!hydrated || loading) return <p className="text-lead py-20 text-stone-700">Loading your order…</p>;

  if (!order) {
    return (
      <div className="border border-dashed border-ink/30 px-6 py-24 text-center">
        <p className="text-h2">We could not find that order.</p>
        <p className="mx-auto mt-4 max-w-[48ch] text-ink/80">The link may be incomplete. You can look up an order with its number and your email address.</p>
        <ButtonLink href="/order-tracking" variant="secondary" arrow className="mt-8">
          Track an order
        </ButtonLink>
      </div>
    );
  }

  const paid = order.paymentStatus === "PAID";
  const awaiting = order.status === "PENDING_PAYMENT";

  const pay = async () => {
    setPayError("");
    try {
      const result = await startPayment({ variables: { number, token } });
      if (result.data?.startPayment) window.location.assign(result.data.startPayment);
    } catch (cause) {
      setPayError(errorMessage(cause));
    }
  };

  return (
    <div className="grid gap-x-8 gap-y-12 lg:grid-cols-12">
      <div className="lg:col-span-7">
        <p className="text-label text-stone-700">Order {order.number}</p>
        <h2 className="text-h1 mt-3">{paid ? "Thank you. Your order is confirmed." : awaiting ? "Your order is waiting for payment." : STATUS_LABEL[order.status]}</h2>

        {awaiting && (
          <div className="mt-8">
            {cancelled && <p className="mb-4 text-terracotta-700">The payment was not completed. Your order is still held for you.</p>}
            {data?.paymentAvailable ? (
              <>
                <p className="max-w-[56ch] text-ink/80">If you have just paid, this page updates by itself once the payment is confirmed. Otherwise you can pay now; the bottles are held for a short while.</p>
                <Button onClick={pay} disabled={payment.loading} arrow className="mt-6">
                  Pay {formatPrice(order.totalCents)}
                </Button>
                <p role="alert" className="text-small mt-3 min-h-5 text-terracotta-700">
                  {payError}
                </p>
              </>
            ) : (
              <Notice title="Online payment is not connected yet">This order is saved and its stock is held for 40 minutes, after which it is cancelled automatically. Nothing has been charged.</Notice>
            )}
          </div>
        )}

        {paid && <p className="text-lead mt-6 max-w-[52ch] text-ink/80">We have received your payment and will send a tracking link to {order.email} when your parcel leaves.</p>}

        <h3 className="text-h3 mt-14">What you ordered</h3>
        <div className="mt-5">
          <OrderSummary order={order} />
        </div>

        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          <div>
            <h3 className="text-label text-stone-700">Delivery address</h3>
            <address className="mt-3 not-italic">
              {order.shipName}
              {order.shipLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
              <span className="block">{order.shipCountryCode}</span>
            </address>
          </div>
          <div>
            <h3 className="text-label text-stone-700">Contact</h3>
            <p className="mt-3 break-words">{order.email}</p>
          </div>
        </div>
      </div>

      <aside className="lg:col-span-4 lg:col-start-9">
        <LotTicket
          className="w-full"
          lot="—"
          rows={[
            { label: "Order", value: order.number },
            { label: "Payment", value: paid ? "Received" : "Not received" },
            { label: "Status", value: STATUS_LABEL[order.status] ?? order.status },
          ]}
        />
        <p className="text-small mt-3 text-stone-700">Lot numbers are assigned when your order is packed.</p>
        <h3 className="text-h3 mt-10">Progress</h3>
        <div className="mt-5">
          <OrderTimeline order={order} />
        </div>
        <ButtonLink href="/shop" variant="text" arrow className="mt-8">
          Back to the shop
        </ButtonLink>
      </aside>
    </div>
  );
}

export function TrackingView() {
  const [track, { data, loading, called, error }] = useLazyQuery(TrackOrderQuery, { fetchPolicy: "network-only" });
  const order = data?.order ?? null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void track({ variables: { number: String(form.get("number") ?? ""), email: String(form.get("email") ?? "") } });
  };

  return (
    <div className="grid gap-x-8 gap-y-12 lg:grid-cols-12">
      <form onSubmit={submit} className="space-y-6 lg:col-span-5">
        <TextField label="Order number" name="number" required placeholder="AZZ-1001" autoComplete="off" />
        <TextField label="Email address" name="email" type="email" required autoComplete="email" hint="The address used when ordering." />
        <Button type="submit" arrow disabled={loading}>
          {loading ? "Looking…" : "Track order"}
        </Button>
      </form>

      <div aria-live="polite" className="lg:col-span-6 lg:col-start-7">
        {!called && <p className="text-lead text-ink/80">Enter your order number and email address to see where your parcel is.</p>}
        {error && <p className="text-terracotta-700">{errorMessage(error)}</p>}
        {called && !loading && !error && !order && <p className="text-lead text-ink/80">No order matches that number and email address. Check both and try again.</p>}
        {order && (
          <div>
            <p className="text-label text-stone-700">Order {order.number}</p>
            <p className="text-h2 mt-3">{STATUS_LABEL[order.status] ?? order.status}</p>
            <div className="mt-8">
              <OrderTimeline order={order} />
            </div>
            <div className="mt-10">
              <OrderSummary order={order} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
