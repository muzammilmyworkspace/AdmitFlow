import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-text-secondary/10", className)}
    />
  );
}

/**
 * A card-shaped loading placeholder.
 *
 * Every view used to load behind a single `<Skeleton className="h-64 w-full" />` — one
 * large grey slab where a page was about to be. It tells the reader nothing about what is
 * coming, and on a slow connection the whole screen is a rectangle for several seconds.
 * This traces the shape of the content instead, so the layout does not jump when the real
 * thing arrives.
 *
 * `role="status"` with a label, because a screen reader gets nothing at all from
 * aria-hidden boxes and would otherwise be told only silence while the page loads.
 */
export function SkeletonCard({ className, lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div className={cn("rounded-lg border border-border bg-surface/95 p-5 shadow-sm", className)}>
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <Skeleton className="mb-2 h-4 w-2/5" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
      <div className="space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-3"
            // Descending widths read as a paragraph rather than as a stack of bars.
            // Static, so the server and client renders agree.
            {...{ style: { width: `${92 - i * 14}%` } }}
          />
        ))}
      </div>
    </div>
  );
}

/** A stack of card placeholders, for list and table surfaces. */
export function SkeletonList({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("space-y-4", className)} role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
