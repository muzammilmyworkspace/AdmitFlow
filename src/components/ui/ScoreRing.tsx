import { cn } from "@/lib/cn";

/**
 * Circular compatibility score.
 *
 * The arc is drawn against a full track so a low score still occupies the same footprint
 * as a high one — a bare number shrinks visually as it falls, which reads as the interface
 * being embarrassed by it. The number is what matters; the ring just makes it scannable
 * across a list.
 */
export function ScoreRing({
  value,
  size = 64,
  className,
  label,
}: {
  value: number;
  size?: number;
  className?: string;
  label?: string;
}) {
  const stroke = size >= 60 ? 5 : 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, value));
  const offset = circumference * (1 - clamped / 100);

  // Colour tracks the band the score falls in, matching the zone language elsewhere.
  const strokeColour = clamped >= 78 ? "#2F8449" : clamped >= 58 ? "#164166" : "#B7791F";

  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColour}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-slow"
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-semibold tabular-nums text-text-primary"
          style={{ fontSize: size * 0.34 }}
        >
          {Math.round(clamped)}
        </span>
      </span>
      {label && <span className="sr-only">{label}</span>}
    </div>
  );
}
