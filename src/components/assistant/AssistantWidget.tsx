"use client";

import clsx from "clsx";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@/components/ui/Link";
import { useI18n } from "@/i18n/client";
import { useCartActions } from "@/lib/store";

type Actions = { products: { slug: string; name: string; blurb: string; price: string; url: string }[]; cart: { sku: string; quantity: number; name: string; price: string }[]; handover: { reference: string } | null };
type Entry = { from: "you" | "assistant"; text: string; actions?: Actions; note?: boolean };
type Saved = { conversationId: string | null; entries: Entry[] };

const STORE_KEY = "azz.assistant.v1";
const MAX_CHARS = 1500;

function load(): Saved {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(STORE_KEY) ?? "null") as Saved | null;
    if (saved && Array.isArray(saved.entries)) return saved;
  } catch {
    // Unreadable or unavailable storage: start fresh.
  }
  return { conversationId: null, entries: [] };
}

/**
 * The shop assistant. Rendered only when the assistant can actually answer
 * (connected, switched on, within budget): a dead chat button is worse than
 * none. What the assistant says comes from the server; this component only
 * shows it, with the product cards and the add-to-cart buttons it proposed.
 * Nothing is added to the cart unless the customer presses a button here.
 */
export function AssistantWidget() {
  const { m, locale, fill } = useI18n();
  const a = m.assistant;
  const cart = useCartActions();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Saved>({ conversationId: null, entries: [] });
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const [rated, setRated] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);

  // The transcript survives a page reload within the same browser tab, and nothing longer.
  // It is read the first time the panel is opened, and only saved after that, so an empty start never overwrites it.
  const loaded = useRef(false);
  const toggle = () => {
    if (!loaded.current) {
      loaded.current = true;
      setState(load());
    }
    setOpen((value) => !value);
  };
  useEffect(() => {
    if (!loaded.current) return;
    try {
      window.sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      // Storage unavailable: the conversation simply does not survive a reload.
    }
  }, [state]);
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: "end" });
  }, [open, state.entries.length, busy]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        launcher.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const post = (body: object) => fetch("/api/assistant", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-azz-locale": locale }, body: JSON.stringify(body) });
  const note = (text: string): Entry => ({ from: "assistant", text, note: true });

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    if (message.length > MAX_CHARS) {
      setState((current) => ({ ...current, entries: [...current.entries, note(fill(a.tooLong, { max: MAX_CHARS }))] }));
      return;
    }
    setDraft("");
    setBusy(true);
    setState((current) => ({ ...current, entries: [...current.entries, { from: "you", text: message }] }));
    let reply: Entry;
    let conversationId = state.conversationId;
    try {
      const response = await post({ conversationId: state.conversationId, message });
      const data = (await response.json()) as { conversationId?: string | null; status?: string; text?: string; actions?: Actions };
      conversationId = data.conversationId ?? conversationId;
      if (!response.ok || !data.status) reply = note(a.unavailable);
      else if (data.status === "ok") reply = { from: "assistant", text: data.text ?? "", actions: data.actions };
      else if (data.status === "limit") reply = note(a.limit);
      else if (data.status === "refused") reply = note(a.refused);
      else reply = note(a.unavailable);
    } catch {
      reply = note(a.unavailable);
    }
    setState((current) => ({ conversationId, entries: [...current.entries, reply] }));
    setBusy(false);
  };

  const addToCart = async (key: string, sku: string, quantity: number) => {
    try {
      await cart.add(sku, quantity);
      setAdded((current) => [...current, key]);
    } catch {
      setState((current) => ({ ...current, entries: [...current.entries, note(m.common.genericError)] }));
    }
  };

  const rate = (helpful: boolean) => {
    setRated(true);
    if (state.conversationId) void post({ conversationId: state.conversationId, helpful }).catch(() => undefined);
  };

  const restart = () => {
    setState({ conversationId: null, entries: [] });
    setAdded([]);
    setRated(false);
  };

  const answered = state.entries.some((entry) => entry.from === "assistant" && !entry.note);

  return (
    <>
      <button
        ref={launcher}
        type="button"
        aria-expanded={open}
        aria-controls="assistant-panel"
        onClick={toggle}
        className={clsx("text-label fixed bottom-4 right-4 z-[54] inline-flex min-h-12 items-center gap-2 bg-olive-900 px-5 text-ivory shadow-[0_18px_40px_-20px_rgb(0_0_0/0.6)] transition-colors duration-300 hover:bg-olive-950", open && "max-sm:hidden")}
      >
        {open ? a.close : a.open}
      </button>

      <section
        id="assistant-panel"
        role="dialog"
        aria-label={a.title}
        hidden={!open}
        className="fixed inset-x-0 bottom-0 z-[57] flex max-h-[min(42rem,100svh)] flex-col border border-ink/15 bg-ivory shadow-[0_30px_80px_-30px_rgb(0_0_0/0.6)] sm:inset-x-auto sm:bottom-20 sm:right-4 sm:w-[26rem]"
      >
        <header className="flex items-center justify-between gap-4 border-b border-ink/15 px-5 py-4">
          <h2 className="text-h3 !text-[1.125rem]">{a.title}</h2>
          <div className="flex items-center gap-4">
            {state.entries.length > 0 && (
              <button type="button" onClick={restart} className="text-small underline underline-offset-4">
                {a.newChat}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                launcher.current?.focus();
              }}
              aria-label={a.close}
              className="grid size-9 place-items-center text-[1.25rem] leading-none"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </header>

        <div className="min-h-40 flex-1 overflow-y-auto px-5 py-4" data-lenis-prevent>
          <p className="text-small text-stone-700">{a.disclosure}</p>
          {state.entries.length === 0 && <p className="mt-4">{a.intro}</p>}
          <ol aria-live="polite" className="mt-4 space-y-4">
            {state.entries.map((entry, index) => (
              <li key={index} className={clsx(entry.from === "you" ? "ml-8 bg-paper px-4 py-3" : "mr-4")}>
                <p className="text-label text-stone-700">{entry.from === "you" ? a.you : a.assistant}</p>
                <p className={clsx("mt-1 whitespace-pre-wrap", entry.note && "text-stone-700")}>{entry.text}</p>

                {entry.actions?.products.length ? (
                  <ul className="mt-3 space-y-2">
                    {entry.actions.products.map((product) => (
                      <li key={product.slug} className="flex items-center justify-between gap-4 border border-ink/15 px-4 py-3">
                        <span>
                          <span className="block font-medium">{product.name}</span>
                          <span className="text-small block text-stone-700">{product.price}</span>
                        </span>
                        {/* The address already carries the locale; the Link keeps it. */}
                        <Link href={product.url} className="text-label shrink-0 underline underline-offset-4" onClick={() => setOpen(false)}>
                          {a.view}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {entry.actions?.cart.map((item, itemIndex) => {
                  const key = `${index}-${itemIndex}`;
                  const done = added.includes(key);
                  return (
                    <button key={key} type="button" disabled={done} onClick={() => addToCart(key, item.sku, item.quantity)} className="text-label mt-3 block min-h-11 w-full border border-olive-700 bg-olive-700 px-4 text-ivory transition-colors hover:bg-olive-950 disabled:border-ink/20 disabled:bg-transparent disabled:text-stone-700">
                      {done ? a.added : fill(a.addToCart, { quantity: item.quantity, name: item.name })}
                    </button>
                  );
                })}

                {entry.actions?.handover && <p className="text-small mt-3 border-l-2 border-gold-700 pl-3">{fill(a.handover, { reference: entry.actions.handover.reference })}</p>}
              </li>
            ))}
            {busy && (
              <li className="mr-4 text-stone-700" role="status">
                {a.working}
              </li>
            )}
          </ol>

          {answered && !busy && (
            <p className="text-small mt-5 flex flex-wrap items-center gap-3 text-stone-700">
              {rated ? (
                a.thanks
              ) : (
                <>
                  {a.helpful}
                  <button type="button" onClick={() => rate(true)} className="underline underline-offset-4">
                    {a.yes}
                  </button>
                  <button type="button" onClick={() => rate(false)} className="underline underline-offset-4">
                    {a.no}
                  </button>
                </>
              )}
            </p>
          )}
          <div ref={end} />
        </div>

        <form onSubmit={send} className="flex items-end gap-3 border-t border-ink/15 px-5 py-4">
          <label className="flex-1">
            <span className="sr-only">{a.placeholder}</span>
            <textarea
              ref={input}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={2}
              maxLength={MAX_CHARS}
              placeholder={a.placeholder}
              className="w-full resize-none border border-ink/30 bg-transparent px-3 py-2 outline-none focus:border-ink"
            />
          </label>
          <button type="submit" disabled={busy || draft.trim() === ""} className="text-label h-11 bg-olive-700 px-5 text-ivory transition-colors hover:bg-olive-950 disabled:opacity-40">
            {a.send}
          </button>
        </form>
      </section>
    </>
  );
}
