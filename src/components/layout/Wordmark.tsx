import { Logo } from "@/components/brand/Logo";

/**
 * The header's logo: the full logo, the olive tree above the name and
 * "Olive Oil Company". Its height follows the header's (`--header-h`), so the
 * two are changed in one place. `mono` draws it in the text colour, for when
 * the header sits on a dark surface.
 */
export function Wordmark({ mono = false }: { mono?: boolean }) {
  return <Logo tone={mono ? "current" : "colour"} className="block h-[calc(var(--header-h)-1rem)]" />;
}
