"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="h-10 bg-olive-700 px-4 text-[0.8125rem] font-medium uppercase tracking-[0.1em] text-ivory">
      Print
    </button>
  );
}
