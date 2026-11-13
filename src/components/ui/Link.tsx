"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";
import { useI18n } from "@/i18n/client";

/**
 * The storefront's link. Internal addresses are written without a locale
 * ("/shop") and receive the current one here ("/de-de/shop"), so a visitor
 * never leaves the language they chose.
 */
export function Link({ href, ...props }: ComponentProps<typeof NextLink>) {
  const { href: localize } = useI18n();
  return <NextLink href={typeof href === "string" ? localize(href) : href} {...props} />;
}
