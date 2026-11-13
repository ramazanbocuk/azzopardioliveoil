"use client";

import { useApolloClient, useQuery } from "@apollo/client/react";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { CartFieldsFragment } from "@/gql/graphql";
import { CartAdd, CartApplyDiscount, CartQuery, CartRemove, CartRemoveDiscount, CartSetQuantity } from "./operations";

/**
 * Cart: lives on the server. The browser holds only an HttpOnly cookie that
 * identifies it; every price, total and stock check comes back from the API.
 */

export type CartLine = CartFieldsFragment["lines"][number];

const EMPTY: CartFieldsFragment = { currency: "EUR", itemCount: 0, subtotalCents: 0, discountCents: 0, discountCode: null, freeShippingDiscount: false, lines: [] };

export function useCart() {
  const hydrated = useHydrated();
  const { data, loading, refetch } = useQuery(CartQuery, { skip: !hydrated });
  // A new delivery country can mean another currency: the server prices the cart again.
  useEffect(() => {
    const reprice = () => void refetch().catch(() => undefined);
    window.addEventListener("azz:ship", reprice);
    return () => window.removeEventListener("azz:ship", reprice);
  }, [refetch]);
  return { cart: data?.cart ?? EMPTY, ready: hydrated && !loading };
}

/** Cart mutations. Each resolves with the updated cart or rejects with the server's error. */
export function useCartActions() {
  const client = useApolloClient();
  const store = useCallback((cart: CartFieldsFragment | undefined | null) => {
    if (cart) client.writeQuery({ query: CartQuery, data: { cart } });
  }, [client]);

  return {
    add: useCallback(async (sku: string, quantity = 1) => store((await client.mutate({ mutation: CartAdd, variables: { sku, quantity } })).data?.cartAdd), [client, store]),
    setQuantity: useCallback(async (sku: string, quantity: number) => store((await client.mutate({ mutation: CartSetQuantity, variables: { sku, quantity } })).data?.cartSetQuantity), [client, store]),
    remove: useCallback(async (sku: string) => store((await client.mutate({ mutation: CartRemove, variables: { sku } })).data?.cartRemove), [client, store]),
    applyDiscount: useCallback(async (code: string) => store((await client.mutate({ mutation: CartApplyDiscount, variables: { code } })).data?.cartApplyDiscount), [client, store]),
    removeDiscount: useCallback(async () => store((await client.mutate({ mutation: CartRemoveDiscount })).data?.cartRemoveDiscount), [client, store]),
    /** After checkout or sign-in the server-side cart has changed underneath us. */
    refresh: useCallback(() => client.refetchQueries({ include: [CartQuery] }), [client]),
  };
}

/**
 * Favourites are kept in this browser's localStorage for now. Syncing them to
 * the signed-in account (the API already supports it) is not wired up yet.
 */
const KEY = "azz.favourites.v1";
const NONE: string[] = [];
let favouriteState: string[] = NONE;
let favouritesLoaded = false;
const listeners = new Set<() => void>();

function readFavourites(): string[] {
  if (!favouritesLoaded && typeof window !== "undefined") {
    favouritesLoaded = true;
    try {
      favouriteState = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as string[];
    } catch {
      favouriteState = NONE;
    }
  }
  return favouriteState;
}

export const favourites = {
  toggle(sku: string) {
    const list = readFavourites();
    favouriteState = list.includes(sku) ? list.filter((s) => s !== sku) : [...list, sku];
    try {
      window.localStorage.setItem(KEY, JSON.stringify(favouriteState));
    } catch {
      // Storage unavailable: the choice lasts for this visit only.
    }
    listeners.forEach((listener) => listener());
  },
};

export function useFavourites(): string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readFavourites,
    () => NONE,
  );
}

/** True only after hydration, so client-only state never mismatches the server HTML. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
