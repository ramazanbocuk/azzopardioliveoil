import clsx from "clsx";

type LotTicketProps = {
  lot: string;
  rows?: { label: string; value: string }[];
  tone?: "light" | "dark";
  /** Marks the ticket as illustrative so no visitor mistakes it for real data. */
  sample?: boolean;
  className?: string;
};

/**
 * The brand's recurring motif: the lot number, set like a mill ticket.
 * Values are administrator-entered; an em dash means "not yet recorded".
 */
export function LotTicket({ lot, rows = [], tone = "light", sample = false, className }: LotTicketProps) {
  const dark = tone === "dark";
  return (
    <div className={clsx("text-ticket inline-block min-w-[13.5rem] border px-4 py-3", dark ? "border-ivory/35 text-ivory" : "border-ink/30 text-ink", className)}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
        <dt className={dark ? "text-ivory/70" : "text-stone-700"}>Lot N°</dt>
        <dd className="text-right">{lot}</dd>
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className={dark ? "text-ivory/70" : "text-stone-700"}>{row.label}</dt>
            <dd className="text-right">{row.value}</dd>
          </div>
        ))}
      </dl>
      {sample && <p className={clsx("mt-2 border-t border-dashed pt-2", dark ? "border-ivory/35 text-gold-300" : "border-ink/30 text-terracotta-700")}>Sample ticket</p>}
    </div>
  );
}
