"use client";

import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/client";

/**
 * Apollo Client for the browser. Session and cart travel as HttpOnly cookies
 * on same-origin requests, so no token is ever held in JavaScript.
 */
export function ApolloWrapper({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const [client] = useState(
    () =>
      new ApolloClient({
        link: // The API answers product names and saves orders in the language of the page that asked.
        new HttpLink({ uri: "/api/graphql", credentials: "same-origin", headers: { "x-azz-locale": locale } }),
        cache: new InMemoryCache(),
      }),
  );
  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}

/** The human-readable message of a failed operation, as written by the server. */
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const maybe = error as { errors?: { message?: string }[]; message?: string };
    return maybe.errors?.[0]?.message ?? maybe.message ?? "Something went wrong. Please try again.";
  }
  return "Something went wrong. Please try again.";
}
