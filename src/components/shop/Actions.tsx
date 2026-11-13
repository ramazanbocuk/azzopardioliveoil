"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { HeartIcon } from "@/components/ui/icons";
import { errorMessage } from "@/lib/apollo";
import { useI18n } from "@/i18n/client";
import { favourites, useCartActions, useFavourites } from "@/lib/store";

export function AddToCart({ sku, qty = 1, disabled, variant = "primary", size = "md", className }: { sku: string; qty?: number; disabled?: boolean; variant?: ButtonVariant; size?: ButtonSize; className?: string }) {
  const { m, server } = useI18n();
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const { add: addToCart } = useCartActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const add = async () => {
    setBusy(true);
    setError("");
    try {
      await addToCart(sku, qty);
      setAdded(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setAdded(false), 2200);
    } catch (cause) {
      setError(server(errorMessage(cause)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button onClick={add} disabled={disabled || busy} variant={variant} size={size} className={className}>
        {disabled ? m.shop.soldOut : added ? m.product.added : m.product.addToCart}
      </Button>
      <span role="status" className="sr-only">
        {added ? m.product.added : ""}
      </span>
      {error && (
        <p role="alert" className="text-small basis-full text-terracotta-700">
          {error}
        </p>
      )}
    </>
  );
}

export function FavouriteButton({ sku, label, className }: { sku: string; label: string; className?: string }) {
  const saved = useFavourites().includes(sku);
  const { m, fill } = useI18n();
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={fill(saved ? m.product.removeFavourite : m.product.saveFavourite, { name: label })}
      onClick={() => favourites.toggle(sku)}
      className={clsx("grid size-11 place-items-center transition-colors duration-300 hover:text-terracotta-700", saved ? "text-terracotta-700" : "text-ink/70", className)}
    >
      <HeartIcon fill={saved ? "currentColor" : "none"} />
    </button>
  );
}
