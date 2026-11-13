"use client";

import { useLazyQuery, useMutation } from "@apollo/client/react";
import { Link } from "@/components/ui/Link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { errorMessage } from "@/lib/apollo";
import { useI18n } from "@/i18n/client";
import { LotQuery, SubscribeNewsletter } from "@/lib/operations";


/** Looks a lot number up in the published lot records. Shown on a dark ground. */
export function TraceForm() {
  const { m, fill, date: format, server } = useI18n();
  const date = (value: string | null | undefined) => (value ? format(value, { dateStyle: "long", timeZone: "UTC" }) : "—");
  const [lookup, { data, loading, called, error }] = useLazyQuery(LotQuery, { fetchPolicy: "network-only" });
  const record = data?.lot ?? null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void lookup({ variables: { lotNumber: String(new FormData(event.currentTarget).get("lot") ?? "") } });
  };

  return (
    <div className="max-w-md">
      <form onSubmit={submit} className="flex items-end gap-4">
        <TextField tone="dark" label={m.trace.lotNumber} name="lot" placeholder="AZ-0000" required autoComplete="off" className="flex-1" />
        <Button type="submit" variant="inverse" arrow disabled={loading}>
          {m.trace.trace}
        </Button>
      </form>
      <div aria-live="polite" className="mt-4 min-h-6">
        {error && <p className="text-small text-gold-300">{server(errorMessage(error))}</p>}
        {called && !loading && !error && !record && <p className="text-small text-gold-300">{m.trace.none}</p>}
        {record && (
          <div className="border border-ivory/35 p-5">
            <p className="text-ticket text-gold-300">{fill(m.shop.lot, { lot: record.lot.lotNumber })}</p>
            <p className="mt-2">
              <Link href={`/products/${record.productSlug}`} className="underline underline-offset-4">
                {record.productName}
              </Link>
            </p>
            <dl className="text-ticket mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
              {(
                [
                  [m.product.harvest, date(record.lot.harvestDate)],
                  [m.trace.grove, record.lot.grove ?? "—"],
                  [m.product.mill, record.lot.mill ?? "—"],
                  [m.product.bottled, date(record.lot.bottledAt)],
                  [m.product.bestBefore, date(record.lot.bestBefore)],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-ivory/70">{label}</dt>
                  <dd className="text-right">{value}</dd>
                </div>
              ))}
            </dl>
            {record.documents.length > 0 && (
              <ul className="text-small mt-4 space-y-1 border-t border-ivory/25 pt-3">
                {record.documents.map((document) => (
                  <li key={document.url}>
                    <a href={document.url} rel="noreferrer" className="underline underline-offset-4">
                      {document.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function NewsletterForm() {
  const { m, server } = useI18n();
  const [message, setMessage] = useState("");
  const [subscribe, { loading }] = useMutation(SubscribeNewsletter);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await subscribe({ variables: { email: String(new FormData(form).get("email") ?? "") } });
      form.reset();
      // Double opt-in: nothing is sent to this address until the link in the confirmation email is used.
      setMessage(m.newsletter.thanks);
    } catch (cause) {
      setMessage(server(errorMessage(cause)));
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <TextField tone="dark" label={m.checkout.email} name="email" type="email" placeholder={m.newsletter.placeholder} required autoComplete="email" className="flex-1" />
        <Button type="submit" variant="inverse" arrow disabled={loading}>
          {m.newsletter.subscribe}
        </Button>
      </div>
      <p role="status" className="text-small mt-3 min-h-6">
        {message}
      </p>
    </form>
  );
}
