"use client";

import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { useState, type ReactNode } from "react";

/**
 * Apollo Client for the browser. Session and cart travel as HttpOnly cookies
 * on same-origin requests, so no token is ever held in JavaScript.
 */
export function ApolloWrapper({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new ApolloClient({
        link: new HttpLink({ uri: "/api/graphql", credentials: "same-origin" }),
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
