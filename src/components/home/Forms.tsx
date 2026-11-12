"use client";

import { useLazyQuery, useMutation } from "@apollo/client/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { errorMessage } from "@/lib/apollo";
import { LotQuery, SubscribeNewsletter } from "@/lib/operations";

const date = (value: string | null | undefined) => (value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(value)) : "—");

/** Looks a lot number up in the published lot records. Shown on a dark ground. */
export function TraceForm() {
  const [lookup, { data, loading, called, error }] = useLazyQuery(LotQuery, { fetchPolicy: "network-only" });
  const record = data?.lot ?? null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void lookup({ variables: { lotNumber: String(new FormData(event.currentTarget).get("lot") ?? "") } });
  };

  return (
    <div className="max-w-md">
      <form onSubmit={submit} className="flex items-end gap-4">
        <TextField tone="dark" label="Lot number" name="lot" placeholder="AZ-0000" required autoComplete="off" className="flex-1" />
        <Button type="submit" variant="inverse" arrow disabled={loading}>
          Trace
        </Button>
      </form>
      <div aria-live="polite" className="mt-4 min-h-6">
        {error && <p className="text-small text-gold-300">{errorMessage(error)}</p>}
        {called && !loading && !error && !record && <p className="text-small text-gold-300">No published record for that lot number yet.</p>}
        {record && (
          <div className="border border-ivory/35 p-5">
            <p className="text-ticket text-gold-300">Lot {record.lot.lotNumber}</p>
            <p className="mt-2">
              <Link href={`/products/${record.productSlug}`} className="underline underline-offset-4">
                {record.productName}
              </Link>
            </p>
            <dl className="text-ticket mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
              {(
                [
                  ["Harvest", date(record.lot.harvestDate)],
                  ["Grove", record.lot.grove ?? "—"],
                  ["Mill", record.lot.mill ?? "—"],
                  ["Bottled", date(record.lot.bottledAt)],
                  ["Best before", date(record.lot.bestBefore)],
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
  const [message, setMessage] = useState("");
  const [subscribe, { loading }] = useMutation(SubscribeNewsletter);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await subscribe({ variables: { email: String(new FormData(form).get("email") ?? "") } });
      form.reset();
      // Double opt-in: nothing is sent to this address until the link in the confirmation email is used.
      setMessage("Thank you. Please confirm your address with the link we are emailing you.");
    } catch (cause) {
      setMessage(errorMessage(cause));
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <TextField tone="dark" label="Email address" name="email" type="email" placeholder="you@example.com" required autoComplete="email" className="flex-1" />
        <Button type="submit" variant="inverse" arrow disabled={loading}>
          Subscribe
        </Button>
      </div>
      <p role="status" className="text-small mt-3 min-h-6">
        {message}
      </p>
    </form>
  );
}
