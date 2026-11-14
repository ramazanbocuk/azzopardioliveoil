/**
 * With Cache Components, Next.js refuses to build a page whose
 * `generateStaticParams` returns nothing. A shop with no categories or
 * products yet (a new database, before the first one is added) would
 * therefore fail to build at all. In that case one address that no record
 * can have is built instead; the page answers it with "not found", like any
 * other unknown address.
 */
export const NO_RECORD_YET = "-";

export function atLeastOne<T>(params: T[], placeholder: T): T[] {
  return params.length > 0 ? params : [placeholder];
}
