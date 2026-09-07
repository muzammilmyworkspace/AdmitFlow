import { cn } from "@/lib/cn";

// The AdmitFlow mark: an upward path breaking out of a ring.
//
// Deliberately not a copy of the SnZ Ventures corporate logo — this is the product's own
// mark, drawn in the brand's green-to-navy relationship (docs/54-decision-log.md D-12).
// It reads as a route out and upward, which is the thing the product is actually for.
export function LogoMark({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn("h-8 w-8", className)} aria-hidden>
      <defs>
        <linearGradient id="af-mark" x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
          <stop stopColor={inverted ? "#8ECBA5" : "#2F8449"} />
          <stop offset="1" stopColor={inverted ? "#FFFFFF" : "#0A2540"} />
        </linearGradient>
      </defs>
      <circle
        cx="16"
        cy="16"
        r="13"
        stroke="url(#af-mark)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="60 22"
        transform="rotate(-38 16 16)"
      />
      <path
        d="M10.5 20.5 L15 15 L18.5 18 L24 10"
        stroke="url(#af-mark)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M20.4 9.4 L24.6 9.2 L24.4 13.4" stroke="url(#af-mark)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({
  className,
  inverted = false,
  showText = true,
}: {
  className?: string;
  inverted?: boolean;
  showText?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark inverted={inverted} className="h-8 w-8 shrink-0" />
      {showText && (
        <span
          className={cn(
            "text-lg font-semibold tracking-tight",
            inverted ? "text-white" : "text-primary",
          )}
        >
          Admit<span className={inverted ? "text-secondary-200" : "text-secondary-600"}>Flow</span>
        </span>
      )}
    </span>
  );
}
