import { cn } from "@/lib/cn";

/**
 * The atmosphere behind every signed-in screen.
 *
 * The signed-out surfaces carry the brand — the split-screen auth panel, the gradient
 * landing hero — and then a student logs in and lands on flat #f8f9fa with white cards
 * on it. The product they are about to trust with their university applications suddenly
 * looks like an internal admin tool.
 *
 * Colours here are written as explicit rgba rather than as palette tints, because the
 * first version of this file used `primary-50` (#F2F6FA) over a `--color-bg` of #f8f9fa —
 * a two-point difference, which is to say invisible. Anything meant to be *seen* against
 * this background has to be stated in terms that cannot collapse into it.
 *
 * Still decorative, and still restrained: fixed, pointer-events-none and aria-hidden, so
 * it never intercepts a click or reaches a screen reader, and every value is static — a
 * random or time-based one would differ between the server and client renders and produce
 * a hydration mismatch.
 */
export function AmbientBackground({ className }: { className?: string }) {
  return (
    <div
      className={cn("pointer-events-none fixed inset-0 -z-10 overflow-hidden", className)}
      aria-hidden
    >
      {/* Base wash: a cool tint under the header that clears by the fold, so the sticky
          nav has something to sit against and the top of every page has depth. */}
      <div
        className="absolute inset-x-0 top-0 h-[520px]"
        style={{
          background:
            "linear-gradient(to bottom, rgba(26,74,120,0.10) 0%, rgba(26,74,120,0.04) 45%, rgba(26,74,120,0) 100%)",
        }}
      />

      {/* Brand aurora — the logo's own Green -> Navy travel, spread across the viewport.
          Large radii and heavy blur keep them as light rather than as shapes. */}
      <div
        className="absolute -left-48 -top-40 h-[620px] w-[620px] rounded-full blur-[110px]"
        style={{ background: "rgba(61,163,93,0.20)" }}
      />
      <div
        className="absolute -right-40 top-10 h-[640px] w-[640px] rounded-full blur-[120px]"
        style={{ background: "rgba(10,37,64,0.13)" }}
      />
      <div
        className="absolute -bottom-56 left-1/4 h-[560px] w-[560px] rounded-full blur-[120px]"
        style={{ background: "rgba(99,91,255,0.10)" }}
      />

      {/* Dot grid. This is what turns "blank" into "paper" — the page gains a surface
          without gaining any content. Masked so it fades out down the page. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(10,37,64,0.16) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage: "linear-gradient(to bottom, black 0%, rgba(0,0,0,0.35) 55%, transparent 88%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 0%, rgba(0,0,0,0.35) 55%, transparent 88%)",
        }}
      />
    </div>
  );
}
