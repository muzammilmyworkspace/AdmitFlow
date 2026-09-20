"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "up" | "down" | "left" | "right" | "scale" | "blur";

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Milliseconds to hold before the transition starts — used to stagger siblings. */
  delay?: number;
  variant?: Variant;
  /** Fraction of the element that must be visible before it reveals. */
  threshold?: number;
}

/**
 * Scroll-triggered entrance. Adds `is-in` the first time the element enters the
 * viewport; the actual motion is CSS (globals.css `.reveal`), so it respects the global
 * prefers-reduced-motion rule and costs nothing while off-screen.
 *
 * Children that need to react to the same moment (a bar growing, a dial drawing) key off
 * the parent's `.is-in` rather than observing themselves — one observer per section.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  variant = "up",
  threshold = 0.18,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add("is-in");
            io.disconnect();
          }
        }
      },
      { threshold, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  return (
    <div
      ref={ref}
      className={cn("reveal", `reveal-${variant}`, className)}
      style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}
