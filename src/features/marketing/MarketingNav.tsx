"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/universities", label: "Universities" },
  { href: "/pricing", label: "Pricing" },
];

/**
 * Public-site navigation. Every marketing page opens on a dark hero, so the bar starts
 * transparent with inverted text and becomes a light glass strip once the reader has
 * scrolled past the top — a single component, two states, no per-page variants.
 */
export function MarketingNav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the sheet on navigation.
  useEffect(() => setOpen(false), [pathname]);

  const solid = scrolled || open;

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-slow",
        solid ? "glass-light shadow-sm" : "bg-transparent",
      )}
    >
      <nav className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-3.5 sm:px-8">
        <Link href="/" className="inline-flex" aria-label="AdmitFlow home">
          <Logo inverted={!solid} />
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={cn(
                    "relative rounded-full px-4 py-2 text-sm font-medium transition-colors duration-base",
                    solid
                      ? active
                        ? "text-primary"
                        : "text-text-secondary hover:text-primary"
                      : active
                        ? "text-white"
                        : "text-white/75 hover:text-white",
                  )}
                >
                  {link.label}
                  {active && (
                    <span
                      className={cn(
                        "absolute inset-x-4 -bottom-0.5 h-0.5 rounded-full",
                        solid ? "bg-secondary-500" : "bg-secondary-300",
                      )}
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="hidden items-center gap-2 md:flex">
          <Link href="/login">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                !solid &&
                  "border-0 bg-white/10 text-white ring-white/20 hover:bg-white/20 hover:ring-white/30",
              )}
            >
              Sign in
            </Button>
          </Link>
          <Link href="/signup">
            <Button
              size="sm"
              variant={solid ? "primary" : "secondary"}
              className={cn(!solid && "bg-white text-primary hover:bg-white/90")}
            >
              Get started
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="marketing-menu"
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-md md:hidden",
            solid ? "text-primary hover:bg-primary-50" : "text-white hover:bg-white/10",
          )}
        >
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
        </button>
      </nav>

      {/* Mobile sheet */}
      <div
        id="marketing-menu"
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows] duration-slow md:hidden",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0">
          <div className="border-t border-border/60 px-5 pb-5 pt-2">
            <ul className="flex flex-col">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="block rounded-md px-3 py-3 text-base font-medium text-text-primary hover:bg-primary-50"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link href="/login">
                <Button variant="ghost" className="w-full">
                  Sign in
                </Button>
              </Link>
              <Link href="/signup">
                <Button className="w-full">Get started</Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
