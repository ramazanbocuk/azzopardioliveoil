import type { Plural } from "./messages/en";

/** Fills {placeholders} in a message. Unknown placeholders are left as written. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}

/** Picks the singular or plural form for a count in a locale, then fills {count}. */
export function plural(tag: string, count: number, forms: Plural, values: Record<string, string | number> = {}): string {
  const form = new Intl.PluralRules(tag).select(count) === "one" ? forms.one : forms.other;
  return fill(form, { count, ...values });
}

export function formatMoney(tag: string, cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat(tag, { style: "currency", currency }).format(cents / 100);
}

export function formatDate(tag: string, value: string | Date, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  return new Intl.DateTimeFormat(tag, options).format(new Date(value));
}

/** A country's name in the reader's language, e.g. "Belgien". Falls back to the code. */
export function countryName(tag: string, code: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
