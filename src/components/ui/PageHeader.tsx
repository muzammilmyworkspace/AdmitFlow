import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The masthead every signed-in page opens with.
 *
 * Before this, each inner page began with a bare `<h1>` and a line of grey text, so
 * "Universities", "Documents" and "Billing" were visually indistinguishable from one
 * another and from a plain document. A student moving between them got no sense of
 * having arrived anywhere.
 *
 * The icon tile is the piece doing most of the work: a brand-gradient plate that gives
 * each page a fixed, recognisable anchor in the same position every time.
 */
export function PageHeader({
  icon: Icon,
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  /** Small label above the title — the section a page belongs to, when that helps. */
  eyebrow?: string;
  /** Right-aligned controls. Wraps beneath the title on narrow screens. */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-7", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-gradient shadow-brand-glow">
            <Icon className="h-6 w-6 text-white" aria-hidden />
          </span>

          <div className="min-w-0">
            {eyebrow && (
              <p className="mb-1 text-xs font-semibold uppercase tracking-[0.09em] text-secondary-700">
                {eyebrow}
              </p>
            )}
            <h1 className="text-2xl font-semibold tracking-tight text-text-primary sm:text-[1.75rem]">
              {title}
            </h1>
            {description && (
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-text-secondary">
                {description}
              </p>
            )}
          </div>
        </div>

        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {/* Hairline that fades out to the right — closes the header without drawing a hard
          rule across the page. */}
      <div className="mt-6 h-px bg-gradient-to-r from-border via-border/60 to-transparent" />
    </header>
  );
}
