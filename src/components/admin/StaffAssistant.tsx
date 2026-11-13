"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import type { ProposalView } from "@/server/ai/proposals";
import type { StaffReply } from "@/server/ai/staffAssistant";
import { ask, decide, startOver } from "@/app/admin/staff-assistant/actions";

type Turn = { id: string; from: "you" | "assistant" | "notice"; text: string; actions?: StaffReply["actions"] };

const NOTICE: Record<string, string> = {
  unavailable: "The assistant could not answer. It may be switched off, out of budget, or the provider may be unreachable. Nothing was changed.",
  limit: "This conversation has reached its length limit. Start a new one.",
  refused: "The assistant declined that request.",
};
const STATUS: Record<string, string> = { PENDING: "Waiting for your decision", EXECUTING: "Running", EXECUTED: "Done", REJECTED: "Rejected", FAILED: "Not done", EXPIRED: "Expired" };
const button = "inline-flex h-10 items-center justify-center whitespace-nowrap px-4 text-[0.8125rem] font-medium uppercase tracking-[0.1em] transition-colors disabled:opacity-50";
const day = (value: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

/** The staff assistant: a conversation on the left of what it says, and beside it the proposals waiting for this person's decision. */
export function StaffAssistant({ initial, waiting, decided, maxChars }: { initial: { id: string; turns: { id: string; from: "you" | "assistant"; text: string }[] } | null; waiting: ProposalView[]; decided: ProposalView[]; maxChars: number }) {
  const [conversationId, setConversationId] = useState<string | null>(initial?.id ?? null);
  const [turns, setTurns] = useState<Turn[]>(initial?.turns ?? []);
  const [proposals, setProposals] = useState<ProposalView[]>([...waiting, ...decided]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [deciding, setDeciding] = useState<string | null>(null);
  const counter = useRef(0);
  const nextId = () => `local-${(counter.current += 1)}`;

  function send() {
    const message = draft.trim();
    if (!message || busy) return;
    setError(null);
    setDraft("");
    setTurns((current) => [...current, { id: nextId(), from: "you", text: message }]);
    startTransition(async () => {
      const reply = await ask(conversationId, message);
      if ("error" in reply) {
        setError(reply.error);
        return;
      }
      setConversationId(reply.conversationId);
      setTurns((current) => [...current, reply.status === "ok" ? { id: nextId(), from: "assistant", text: reply.text, actions: reply.actions } : { id: nextId(), from: "notice", text: NOTICE[reply.status] ?? NOTICE.unavailable, actions: reply.actions }]);
      if (reply.actions.proposals.length > 0) {
        const now = new Date();
        setProposals((current) => [...reply.actions.proposals.filter((entry) => !current.some((row) => row.id === entry.id)).map((entry) => ({ id: entry.id, reference: entry.reference, kind: "", label: entry.label, summary: entry.summary, status: "PENDING", result: null, createdAt: now, decidedAt: null, expiresAt: new Date(now.getTime() + 24 * 3_600_000), path: null })), ...current]);
      }
    });
  }

  async function settle(id: string, approve: boolean) {
    setDeciding(id);
    setError(null);
    const outcome = await decide(id, approve);
    setDeciding(null);
    if ("error" in outcome) {
      setError(outcome.error);
      return;
    }
    setProposals((current) => current.map((row) => (row.id === id ? outcome.proposal : row)));
  }

  function reset() {
    if (conversationId) void startOver(conversationId);
    setConversationId(null);
    setTurns([]);
    setError(null);
  }

  const open = proposals.filter((row) => row.status === "PENDING");
  const closed = proposals.filter((row) => row.status !== "PENDING");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <section className="min-w-0 border border-ink/10 bg-white" aria-label="Conversation">
        <div className="flex items-center justify-between border-b border-ink/10 px-5 py-4">
          <h2 className="text-[1.0625rem] font-medium">Conversation</h2>
          <button type="button" onClick={reset} disabled={busy || turns.length === 0} className={`${button} border border-ink/20 hover:bg-ink/5`}>
            New conversation
          </button>
        </div>
        <ol className="space-y-5 p-5" aria-live="polite">
          {turns.length === 0 && <li className="text-stone-700">Ask about orders, shipments, stock, sales or support requests. For example: “Which orders are waiting for a second shipment?”</li>}
          {turns.map((turn) => (
            <li key={turn.id}>
              <p className="text-small font-medium text-stone-700">{turn.from === "you" ? "You" : turn.from === "assistant" ? "Assistant" : "Notice"}</p>
              <p className="mt-1 whitespace-pre-wrap break-words">{turn.text}</p>
              {turn.actions?.drafts.map((email, index) => (
                <div key={index} className="mt-3 border border-ink/15 bg-stone-50 p-4">
                  <p className="text-small font-medium">Draft email — not sent</p>
                  <p className="text-small mt-2 text-stone-700">To: {email.to}</p>
                  <p className="text-small text-stone-700">Subject: {email.subject}</p>
                  <p className="mt-3 whitespace-pre-wrap break-words">{email.body}</p>
                  <button type="button" className={`${button} mt-3 border border-ink/20 hover:bg-ink/5`} onClick={() => void navigator.clipboard?.writeText(`${email.subject}\n\n${email.body}`)}>
                    Copy text
                  </button>
                </div>
              ))}
              {turn.actions && turn.actions.proposals.length > 0 && <p className="text-small mt-3 text-stone-700">Waiting for your decision: {turn.actions.proposals.map((entry) => entry.reference).join(", ")}. See “Proposals”.</p>}
              {turn.actions && turn.actions.links.length > 0 && (
                <p className="text-small mt-3 flex flex-wrap gap-x-4 gap-y-1">
                  {turn.actions.links.map((entry) => (
                    <Link key={entry.href} href={entry.href} className="underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
                      {entry.label}
                    </Link>
                  ))}
                </p>
              )}
            </li>
          ))}
          {busy && <li className="text-stone-700">Looking that up…</li>}
        </ol>
        {error && (
          <p role="alert" className="mx-5 mb-4 border border-red-700/30 bg-red-50 px-4 py-3 text-red-900">
            {error}
          </p>
        )}
        <form
          className="border-t border-ink/10 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <label className="block">
            <span className="text-small font-medium">Your message</span>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
              rows={3}
              maxLength={maxChars}
              className="mt-1.5 block w-full border border-ink/20 bg-white px-3 py-2 focus:border-ink focus:outline-none"
            />
          </label>
          <div className="mt-3 flex items-center justify-between gap-4">
            <p className="text-small text-stone-700">Enter sends. Shift and Enter starts a new line.</p>
            <button type="submit" disabled={busy || draft.trim().length === 0} className={`${button} bg-ink text-paper hover:bg-ink/90`}>
              Send
            </button>
          </div>
        </form>
      </section>

      <section className="min-w-0 border border-ink/10 bg-white" aria-label="Proposals">
        <div className="border-b border-ink/10 px-5 py-4">
          <h2 className="text-[1.0625rem] font-medium">Proposals</h2>
          <p className="text-small mt-1 text-stone-700">The assistant cannot change money, stock or an order. It writes a proposal; nothing happens until you approve it. A proposal expires after 24 hours.</p>
        </div>
        <div className="space-y-4 p-5">
          {open.length === 0 && <p className="text-stone-700">Nothing is waiting for your decision.</p>}
          {open.map((row) => (
            <article key={row.id} className="border border-ink/15 p-4">
              <p className="text-small font-medium">
                {row.reference} · {row.label}
              </p>
              <p className="mt-2 break-words">{row.summary}</p>
              <div className="mt-4 flex gap-3">
                <button type="button" disabled={deciding !== null} onClick={() => void settle(row.id, true)} className={`${button} bg-ink text-paper hover:bg-ink/90`}>
                  {deciding === row.id ? "Working…" : "Approve"}
                </button>
                <button type="button" disabled={deciding !== null} onClick={() => void settle(row.id, false)} className={`${button} border border-ink/20 hover:bg-ink/5`}>
                  Reject
                </button>
              </div>
            </article>
          ))}
          {closed.length > 0 && <h3 className="text-small pt-2 font-medium text-stone-700">Decided</h3>}
          {closed.map((row) => (
            <article key={row.id} className="border border-ink/10 p-4">
              <p className="text-small font-medium">
                {row.reference} · {row.label} · {STATUS[row.status] ?? row.status}
                {row.decidedAt ? ` · ${day(row.decidedAt)}` : ""}
              </p>
              <p className="text-small mt-2 break-words text-stone-700">{row.summary}</p>
              {row.result && <p className="mt-2 break-words">{row.result}</p>}
              {row.path && (
                <Link href={row.path} className="text-small mt-2 inline-block underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
                  Open the record
                </Link>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
