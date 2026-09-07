import { cn } from "@/lib/cn";

/**
 * Decorative dotted-globe motif for branded panels.
 *
 * Purely presentational and `aria-hidden`: it carries no information, so a screen reader
 * announcing it would be noise. Drawn as a light dot grid on a sphere rather than a real
 * world map, because a real map invites "why is my country missing?" — and any answer to
 * that would be a political statement the product has no business making.
 */
export function WorldMotif({ className }: { className?: string }) {
  const rows = 13;
  const dots: { cx: number; cy: number; r: number; o: number }[] = [];

  for (let row = 0; row < rows; row++) {
    const lat = (row / (rows - 1)) * Math.PI; // 0..π down the sphere
    const y = 50 - Math.cos(lat) * 46;
    const rowWidth = Math.sin(lat) * 46;
    const count = Math.max(1, Math.round(rowWidth / 3.6));
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const x = 50 - rowWidth + t * rowWidth * 2;
      dots.push({
        cx: x,
        cy: y,
        r: 0.85,
        // Fades toward the limb so the sphere reads as round rather than as a flat grid.
        o: 0.16 + 0.5 * Math.sin(lat) * (1 - Math.abs(t - 0.5) * 1.1),
      });
    }
  }

  return (
    <svg viewBox="0 0 100 100" className={cn("h-full w-full", className)} aria-hidden>
      {dots.map((d, i) => (
        <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill="currentColor" opacity={Math.max(0, d.o)} />
      ))}
    </svg>
  );
}

/** Soft radial glow used behind hero content to lift it off a flat gradient. */
export function GlowField({ className }: { className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      <div className="absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-secondary-400/20 blur-3xl" />
      <div className="absolute -right-16 bottom-0 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />
    </div>
  );
}
