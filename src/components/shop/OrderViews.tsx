"use client";

import { useLazyQuery, useMutation, useQuery } from "@apollo/client/react";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { LotTicket } from "@/components/ui/LotTicket";
import { Notice } from "@/components/ui/Page";
import { useI18n } from "@/i18n/client";
import type { OrderFieldsFragment } from "@/gql/graphql";
import { errorMessage } from "@/lib/apollo";
import { OrderByTokenQuery, StartPayment, TrackOrderQuery } from "@/lib/operations";
import { useHydrated } from "@/lib/store";

export function OrderSummary({ order }: { order: OrderFieldsFragment }) {
  const { m, fill, money } = useI18n();
  const o = m.order;
  return (
    <div>
      <ul className="border-t border-ink/20">
        {order.items.map((item) => (
          <li key={item.sku} className="flex justify-between gap-6 border-b border-ink/20 py-4">
            <span>
              {item.productName}
              <span className="text-small block text-stone-700">
                {item.variantLabel} × {item.quantity}
                {item.lotNumber ? ` · ${fill(o.lot, { lot: item.lotNumber })}` : ""}
              </span>
            </span>
            <span className="tabular-nums">{money(item.lineTotalCents)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-5 space-y-2">
        <div className="flex justify-between gap-6">
          <dt>{m.checkout.subtotal}</dt>
          <dd className="tabular-nums">{money(order.subtotalCents)}</dd>
        </div>
        {order.discountCents > 0 && (
          <div className="flex justify-between gap-6">
            <dt>{m.checkout.discount}</dt>
            <dd className="tabular-nums">−{money(order.discountCents)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-6">
          <dt>{fill(o.shippingWith, { name: order.shippingRateName })}</dt>
          <dd className="tabular-nums">{order.shippingCents === 0 ? m.common.free : money(order.shippingCents)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-6 border-t border-ink/20 pt-3">
          <dt className="text-h3">{m.checkout.total}</dt>
          <dd className="font-serif text-[1.75rem] tabular-nums">{money(order.totalCents)}</dd>
        </div>
        {order.taxCents !== null && order.taxCents !== undefined && (
          <div className="text-small flex justify-between gap-6 text-stone-700">
            <dt>{o.includesVat}</dt>
            <dd className="tabular-nums">{money(order.taxCents)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function OrderTimeline({ order }: { order: OrderFieldsFragment }) {
  const { m, fill, date, server } = useI18n();
  const f = m.fulfil;
  const when = (iso: string) => date(iso, { dateStyle: "medium", timeStyle: "short" });
  const day = (iso: string) => date(iso, { dateStyle: "long" });
  const shipmentStatus = (value: string) => (f.status as Record<string, string>)[value] ?? value;
  const eventText = (event: { kind: string; message: string }) => (f.events as Record<string, string>)[event.kind] ?? server(event.message);

  const toCome = order.items.filter((item) => item.toFollow > 0);
  const removed = order.items.filter((item) => item.cancelledQuantity > 0);
  // One more shipment is expected for as long as anything is still owed.
  const total = order.shipments.length + (toCome.length > 0 ? 1 : 0);
  const name = (line: { productName: string; variantLabel: string }) => `${line.productName} ${line.variantLabel}`;

  return (
    <div>
      <ol>
        {order.events.map((event, index) => (
          <li key={`${event.kind}-${event.at}-${index}`} className="relative flex gap-5 pb-7 last:pb-0">
            {index < order.events.length - 1 && <span aria-hidden="true" className="absolute left-[7px] top-4 h-full w-px bg-ink/20" />}
            <span aria-hidden="true" className="relative mt-1 block size-[15px] shrink-0 rounded-full border border-olive-700 bg-olive-700" />
            <span>
              {eventText(event)}
              <span className="text-small block text-stone-700">{when(event.at)}</span>
            </span>
          </li>
        ))}
      </ol>

      {(order.shipments.length > 0 || removed.length > 0 || (toCome.length > 0 && toCome.some((item) => item.awaitingStock > 0))) && (
        <section aria-label={f.shipments} className="mt-8 border-t border-ink/20 pt-6">
          <h4 className="text-label text-stone-700">{f.shipments}</h4>
          {total > 1 && <p className="text-small mt-3 max-w-[52ch] text-ink/80">{f.partialNote}</p>}

          {order.shipments.map((shipment, index) => (
            <article key={`${shipment.trackingNumber ?? "shipment"}-${index}`} className="mt-5 border border-ink/15 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <h5 className="font-medium">{fill(f.shipmentOf, { index: index + 1, total })}</h5>
                <p className="text-label">{shipmentStatus(shipment.status)}</p>
              </div>
              <p className="text-small mt-2 text-stone-700">
                {shipment.deliveredAt ? fill(f.deliveredOn, { date: day(shipment.deliveredAt) }) : shipment.shippedAt ? fill(f.sent, { date: day(shipment.shippedAt) }) : ""}
              </p>
              <ul className="mt-3 space-y-1">
                {shipment.items.map((line) => (
                  <li key={line.sku}>
                    {line.quantity} × {name(line)}
                    {line.lotNumber ? <span className="text-small text-stone-700"> · {fill(m.order.lot, { lot: line.lotNumber })}</span> : null}
                  </li>
                ))}
              </ul>
              {shipment.hasProblem && (
                <p role="status" className="text-small mt-3 border-l-2 border-terracotta-700 pl-3 text-terracotta-700">
                  {f.problem}
                </p>
              )}
              {!shipment.deliveredAt && shipment.estimatedDeliveryAt && <p className="text-small mt-3 text-stone-700">{fill(f.estimate, { date: day(shipment.estimatedDeliveryAt) })}</p>}
              {shipment.events.length > 0 && (
                <details className="mt-3">
                  <summary className="text-small cursor-pointer underline underline-offset-4">{f.latest}</summary>
                  {/* Carrier wording is shown as the carrier wrote it, which is not always the reader's language. */}
                  <ol className="text-small mt-2 space-y-1 text-stone-700">
                    {shipment.events.map((event, eventIndex) => (
                      <li key={`${event.at}-${eventIndex}`}>
                        {when(event.at)} · {event.description}
                        {event.location ? ` · ${event.location}` : ""}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              <p className="mt-3">
                {shipment.carrier}
                {" · "}
                {shipment.trackingNumber ?? f.noTracking}
                {shipment.trackingUrl && (
                  <a href={shipment.trackingUrl} rel="noreferrer" className="ml-3 underline underline-offset-4">
                    {m.order.trackWithCarrier}
                  </a>
                )}
              </p>
            </article>
          ))}

          {toCome.length > 0 && (
            <div className="mt-5 border border-dashed border-ink/30 p-5">
              <h5 className="font-medium">{order.shipments.length > 0 ? `${fill(f.shipmentOf, { index: total, total })} — ${f.toCome}` : f.toCome}</h5>
              <ul className="mt-3 space-y-1">
                {toCome.flatMap((item) => {
                  const ready = item.toFollow - item.awaitingStock;
                  return [
                    ...(ready > 0 ? [<li key={`${item.sku}-ready`}>{fill(f.preparing, { count: ready, name: name(item) })}</li>] : []),
                    ...(item.awaitingStock > 0 ? [<li key={`${item.sku}-waiting`}>{fill(f.awaitingStock, { count: item.awaitingStock, name: name(item) })}</li>] : []),
                  ];
                })}
              </ul>
            </div>
          )}

          {removed.length > 0 && (
            <ul className="text-small mt-4 space-y-1 text-stone-700">
              {removed.map((item) => (
                <li key={`${item.sku}-removed`}>{fill(f.removed, { count: item.cancelledQuantity, name: name(item) })}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/** Order page reached from the private link issued at checkout. Shows the truth as the server knows it. */
export function ConfirmationView() {
  const hydrated = useHydrated();
  const { m, fill, money, server } = useI18n();
  const o = m.order;
  const status = (value: string) => (o.status as Record<string, string>)[value] ?? value;
  const params = useSearchParams();
  const number = params.get("order") ?? "";
  const token = params.get("token") ?? "";
  const cancelled = params.get("cancelled") === "1";
  const [payError, setPayError] = useState("");
  const [startPayment, payment] = useMutation(StartPayment);

  const { data, loading } = useQuery(OrderByTokenQuery, { variables: { number, token }, skip: !hydrated || !number || !token, fetchPolicy: "network-only", pollInterval: 4000, skipPollAttempt: () => document.hidden });
  const order = data?.orderByToken ?? null;

  if (!hydrated || loading) return <p className="text-lead py-20 text-stone-700">{o.loading}</p>;

  if (!order) {
    return (
      <div className="border border-dashed border-ink/30 px-6 py-24 text-center">
        <p className="text-h2">{o.notFound}</p>
        <p className="mx-auto mt-4 max-w-[48ch] text-ink/80">{o.notFoundHint}</p>
        <ButtonLink href="/order-tracking" variant="secondary" arrow className="mt-8">
          {m.tracking.title}
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
      setPayError(server(errorMessage(cause)));
    }
  };

  return (
    <div className="grid gap-x-8 gap-y-12 lg:grid-cols-12">
      <div className="lg:col-span-7">
        <p className="text-label text-stone-700">{fill(o.number, { number: order.number })}</p>
        <h2 className="text-h1 mt-3">{paid ? o.confirmed : awaiting ? o.awaiting : status(order.status)}</h2>

        {awaiting && (
          <div className="mt-8">
            {cancelled && <p className="mb-4 text-terracotta-700">{o.notCompleted}</p>}
            {data?.paymentAvailable ? (
              <>
                <p className="max-w-[56ch] text-ink/80">{o.justPaid}</p>
                <Button onClick={pay} disabled={payment.loading} arrow className="mt-6">
                  {fill(o.pay, { amount: money(order.totalCents) })}
                </Button>
                <p role="alert" className="text-small mt-3 min-h-5 text-terracotta-700">
                  {payError}
                </p>
              </>
            ) : (
              <Notice title={m.checkout.noProviderTitle}>{o.held}</Notice>
            )}
          </div>
        )}

        {paid && <p className="text-lead mt-6 max-w-[52ch] text-ink/80">{fill(o.paidLead, { email: order.email })}</p>}

        <h3 className="text-h3 mt-14">{o.whatYouOrdered}</h3>
        <div className="mt-5">
          <OrderSummary order={order} />
        </div>

        <div className="mt-12 grid gap-8 sm:grid-cols-2">
          <div>
            <h3 className="text-label text-stone-700">{o.deliveryAddress}</h3>
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
            <h3 className="text-label text-stone-700">{o.contact}</h3>
            <p className="mt-3 break-words">{order.email}</p>
          </div>
        </div>
      </div>

      <aside className="lg:col-span-4 lg:col-start-9">
        <LotTicket
          className="w-full"
          lot="—"
          rows={[
            { label: o.orderLabel, value: order.number },
            { label: o.payment, value: paid ? o.received : o.notReceived },
            { label: o.statusLabel, value: status(order.status) },
          ]}
        />
        <p className="text-small mt-3 text-stone-700">{o.lotsAssigned}</p>
        <h3 className="text-h3 mt-10">{o.progress}</h3>
        <div className="mt-5">
          <OrderTimeline order={order} />
        </div>
        <ButtonLink href="/shop" variant="text" arrow className="mt-8">
          {m.common.backToShop}
        </ButtonLink>
      </aside>
    </div>
  );
}

export function TrackingView() {
  const { m, fill, server } = useI18n();
  const t = m.tracking;
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
        <TextField label={t.number} name="number" required placeholder="AZZ-1001" autoComplete="off" />
        <TextField label={m.checkout.email} name="email" type="email" required autoComplete="email" hint={t.emailHint} />
        <Button type="submit" arrow disabled={loading}>
          {loading ? t.looking : t.track}
        </Button>
      </form>

      <div aria-live="polite" className="lg:col-span-6 lg:col-start-7">
        {!called && <p className="text-lead text-ink/80">{t.intro}</p>}
        {error && <p className="text-terracotta-700">{server(errorMessage(error))}</p>}
        {called && !loading && !error && !order && <p className="text-lead text-ink/80">{t.none}</p>}
        {order && (
          <div>
            <p className="text-label text-stone-700">{fill(m.order.number, { number: order.number })}</p>
            <p className="text-h2 mt-3">{(m.order.status as Record<string, string>)[order.status] ?? order.status}</p>
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
