import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AmbientBackground } from "@/components/brand/AmbientBackground";
import { Logo } from "@/components/brand/Logo";

/**
 * The full-page frame for the states nobody designs until they happen: a wrong URL, a
 * thrown error, a page still loading.
 *
 * Before this existed, all three fell through to Next's own screens — an unstyled "404
 * This page could not be found" on a white page. A student who mistypes a URL, or hits a
 * transient failure, sees that and reasonably concludes the site is broken. It is a
 * cheap moment to lose someone, and a cheap one to keep.
 */
export function StatusScreen({
  icon: Icon,
  eyebrow,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  eyebrow?: string;
  title: string;
  description: React.ReactNode;
  /** Actions. Falls back to a link home when none are given. */
  children?: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col">
      <AmbientBackground />

      <header className="mx-auto w-full max-w-6xl px-4 py-5">
        <Link href="/">
          <Logo />
        </Link>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 pb-24">
        <div className="animate-fade-in text-center">
          <span className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-gradient shadow-brand-glow">
            <Icon className="h-7 w-7 text-white" aria-hidden />
          </span>

          {eyebrow && (
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.09em] text-secondary-700">
              {eyebrow}
            </p>
          )}

          <h1 className="text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl">
            {title}
          </h1>

          <div className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-text-secondary">
            {description}
          </div>

          <div className="mt-7 flex flex-wrap justify-center gap-3">
            {children ?? (
              <Link href="/dashboard">
                <Button>Back to your dashboard</Button>
              </Link>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
