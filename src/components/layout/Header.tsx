"use client";

import Link from "next/link";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { navigation } from "@/content/site";
import { AccountIcon, BagIcon, SearchIcon } from "@/components/ui/icons";
import { useCart } from "@/lib/store";
import { Wordmark } from "./Wordmark";

const iconButton = "grid size-11 place-items-center transition-opacity duration-300 hover:opacity-60";

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const lastY = useRef(0);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const count = useCart().cart.itemCount;

  // Solid after the first screen-edge; tucks away scrolling down, returns scrolling up.
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = window.scrollY;
        setScrolled(y > 24);
        setHidden(y > 480 && y > lastY.current);
        lastY.current = y;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <header
        className={clsx(
          "header-in fixed inset-x-0 top-0 z-50 transition-[transform,background-color,border-color,color] duration-700 ease-out-expo",
          hidden && !open ? "-translate-y-full" : "translate-y-0",
          open
            ? "border-b border-transparent text-ivory"
            : scrolled
              ? "border-b border-ink/10 bg-ivory/90 text-ink backdrop-blur-md"
              : "border-b border-transparent text-ink",
        )}
      >
        <div className="container-page grid h-(--header-h) grid-cols-[1fr_auto_1fr] items-center">
          <nav aria-label="Primary" className="hidden xl:block">
            <ul className="flex items-center gap-7 whitespace-nowrap">
              {navigation.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-label link-underline inline-flex min-h-11 items-center">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <button
            ref={toggleRef}
            type="button"
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((value) => !value)}
            className="text-label -ml-2 inline-flex h-11 items-center gap-3 justify-self-start px-2 xl:hidden"
          >
            <span aria-hidden="true" className="relative block h-2.5 w-6">
              <span className={clsx("absolute inset-x-0 top-0 h-px bg-current transition-transform duration-500 ease-out-expo", open && "translate-y-[5px] rotate-45")} />
              <span className={clsx("absolute inset-x-0 bottom-0 h-px bg-current transition-transform duration-500 ease-out-expo", open && "-translate-y-[4px] -rotate-45")} />
            </span>
            <span className="max-sm:sr-only">{open ? "Close" : "Menu"}</span>
          </button>

          <Link href="/" className="justify-self-center" onClick={() => setOpen(false)}>
            <Wordmark />
            <span className="sr-only">, home</span>
          </Link>

          <div className="flex items-center justify-self-end">
            <Link href="/search" aria-label="Search" className={clsx(iconButton, "hidden sm:grid")}>
              <SearchIcon />
            </Link>
            <Link href="/account" aria-label="Account" className={clsx(iconButton, "hidden sm:grid")}>
              <AccountIcon />
            </Link>
            <Link href="/cart" aria-label={`Cart, ${count} ${count === 1 ? "item" : "items"}`} className={clsx(iconButton, "relative -mr-2.5")}>
              <BagIcon />
              <span aria-hidden="true" className="text-ticket absolute right-1 top-1.5 !text-[0.5625rem]">
                {count}
              </span>
            </Link>
          </div>
        </div>
      </header>

      <div
        id="mobile-menu"
        inert={!open}
        className={clsx(
          "fixed inset-0 z-40 flex flex-col bg-olive-900 text-ivory transition-[opacity,visibility] duration-700 ease-out-expo xl:hidden",
          open ? "visible opacity-100" : "invisible opacity-0",
        )}
      >
        <nav aria-label="Mobile" className="container-page flex flex-1 flex-col justify-center pt-(--header-h)">
          <ul>
            {navigation.map((item, index) => (
              <li key={item.href} className="overflow-hidden border-b border-ivory/15">
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  style={{ transitionDelay: open ? `${120 + index * 60}ms` : "0ms" }}
                  className={clsx(
                    "text-h2 block py-3.5 transition-transform duration-[900ms] ease-out-expo",
                    open ? "translate-y-0" : "translate-y-full",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="container-page text-label flex justify-between pb-8 text-ivory/80">
          <Link href="/account" onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center">
            Account
          </Link>
          <Link href="/search" onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center">
            Search
          </Link>
          <Link href="/contact" onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center">
            Contact
          </Link>
        </div>
      </div>
    </>
  );
}
