import clsx from "clsx";

/** Typeset wordmark. Replace with the supplied logo artwork when available. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex flex-col items-center leading-none", className)}>
      <span className="font-serif text-[1.0625rem] tracking-[0.2em] uppercase sm:text-[1.375rem]">Azzopardi</span>
      <span className="mt-1 font-sans text-[0.5rem] font-medium tracking-[0.42em] sm:mt-1.5 sm:text-[0.5625rem] uppercase opacity-75">Olive Oil</span>
    </span>
  );
}
