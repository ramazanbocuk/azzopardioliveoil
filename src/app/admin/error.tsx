"use client";

export default function AdminError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-6 py-20 font-sans">
      <h1 className="font-serif text-[2rem]">This page could not be shown.</h1>
      <p className="mt-4 text-stone-700">{error.message || "Something went wrong."}</p>
      <button type="button" onClick={reset} className="mt-6 h-10 border border-ink/30 px-4 text-[0.8125rem] font-medium uppercase tracking-[0.1em]">
        Try again
      </button>
    </div>
  );
}
