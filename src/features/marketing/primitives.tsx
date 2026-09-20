import Link from "next/link";
import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { WorldMotif } from "@/components/brand/WorldMotif";
import { cn } from "@/lib/cn";
import { Reveal } from "./Reveal";

/* ------------------------------------------------------------------ text -- */

export function Eyebrow({
  children,
  tone = "green",
  className,
}: {
  children: ReactNode;
  tone?: "green" | "light";
  className?: string;
}) {
  return (
    <p
      className={cn(
        "mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em]",
        tone === "green" ? "text-secondary-700" : "text-secondary-200",
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "green" ? "bg-secondary-500" : "bg-secondary-300",
        )}
        aria-hidden
      />
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = "left",
  tone = "dark",
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  align?: "left" | "center";
  tone?: "dark" | "light";
  className?: string;
}) {
  const light = tone === "light";
  return (
    <Reveal className={cn(align === "center" && "mx-auto text-center", "max-w-2xl", className)}>
      {eyebrow && <Eyebrow tone={light ? "light" : "green"}>{eyebrow}</Eyebrow>}
      <h2
        className={cn(
          "text-3xl font-semibold leading-[1.1] tracking-tight sm:text-4xl lg:text-[2.75rem]",
          light ? "text-white" : "text-text-primary",
        )}
      >
        {title}
      </h2>
      {lead && (
        <p
          className={cn(
            "mt-5 text-lg leading-relaxed",
            light ? "text-white/70" : "text-text-secondary",
          )}
        >
          {lead}
        </p>
      )}
    </Reveal>
  );
}

/* --------------------------------------------------------------- shells -- */

/** Dark, atmospheric backdrop: aurora blobs, dot globe and a faint grid. */
export function DarkAtmosphere({
  className,
  image,
  imageAlt = "",
  imagePosition = "center",
  dim = 0.72,
}: {
  className?: string;
  image?: string;
  imageAlt?: string;
  imagePosition?: string;
  dim?: number;
}) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      {image && (
        <Image
          src={image}
          alt={imageAlt}
          fill
          priority
          sizes="100vw"
          className="object-cover"
          style={{ objectPosition: imagePosition }}
        />
      )}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(120deg, rgba(10,37,64,${dim + 0.2}) 0%, rgba(10,37,64,${dim}) 45%, rgba(20,55,31,${dim - 0.1}) 100%)`,
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-primary-900/40 via-transparent to-primary-900/80" />
      <div className="absolute -left-40 top-1/4 h-[34rem] w-[34rem] animate-aurora rounded-full bg-secondary-500/25 blur-[110px]" />
      <div className="absolute -right-32 -top-20 h-[30rem] w-[30rem] animate-aurora-slow rounded-full bg-accent/20 blur-[110px]" />
      <div className="absolute bottom-0 left-1/3 h-[26rem] w-[26rem] animate-aurora rounded-full bg-primary-400/25 blur-[100px]" />
      <div className="grid-lines absolute inset-0" />
      <div className="absolute -right-48 top-1/2 h-[50rem] w-[50rem] -translate-y-1/2 animate-spin-slow text-white/20">
        <WorldMotif />
      </div>
    </div>
  );
}

/** Subpage opener: same atmosphere as the landing hero, shorter. */
export function PageHero({
  eyebrow,
  title,
  lead,
  image,
  imagePosition,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  lead: ReactNode;
  image: string;
  imagePosition?: string;
  children?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden bg-primary px-5 pb-24 pt-36 text-white sm:px-8 sm:pt-44">
      <DarkAtmosphere image={image} imagePosition={imagePosition} dim={0.78} />
      <div className="relative mx-auto max-w-7xl">
        <div className="max-w-3xl">
          <Reveal variant="blur">
            <Eyebrow tone="light">{eyebrow}</Eyebrow>
          </Reveal>
          <Reveal delay={80} variant="blur">
            <h1 className="text-4xl font-semibold leading-[1.06] tracking-tight sm:text-6xl">
              {title}
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/75 sm:text-xl">{lead}</p>
          </Reveal>
          {children && <Reveal delay={240}>{children}</Reveal>}
        </div>
      </div>
    </section>
  );
}

/** Closing call to action, identical on every public page. */
export function CtaBand({
  title = "Find out where you stand — in about ten minutes.",
  lead = "Complete your profile once and see every match, with the reasoning behind it. Free to start, no card required.",
}: {
  title?: ReactNode;
  lead?: ReactNode;
}) {
  return (
    <section className="px-5 pb-24 pt-8 sm:px-8">
      <Reveal variant="scale">
        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-xl bg-primary px-8 py-20 text-center text-white sm:px-16">
          <DarkAtmosphere image="/marketing/lecture-hall.jpg" dim={0.8} />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">{title}</h2>
            <p className="mt-5 text-lg text-white/70">{lead}</p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link href="/signup">
                <Button size="lg" variant="secondary" className="bg-white text-primary shadow-xl hover:bg-white/90">
                  Start your free assessment
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              </Link>
              <Link href="/how-it-works">
                <Button size="lg" variant="ghost" className="border-0 bg-white/10 text-white ring-white/25 hover:bg-white/20">
                  See how it works
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ------------------------------------------------------------- visuals -- */

/** Animated ring that draws itself to `value` (0–100) when its <Reveal> parent enters. */
export function ScoreDial({
  value,
  label,
  size = 160,
  stroke = 12,
  className,
  tone = "green",
}: {
  value: number;
  label?: string;
  size?: number;
  stroke?: number;
  className?: string;
  tone?: "green" | "navy" | "indigo";
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const target = c * (1 - Math.min(100, Math.max(0, value)) / 100);
  const colour = tone === "green" ? "#3DA35D" : tone === "navy" ? "#0A2540" : "#635BFF";
  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" strokeWidth={stroke} fill="none" className="text-primary-100" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colour}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          className="dial-arc"
          style={{ "--dial-full": c, "--dial-target": target } as CSSProperties}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tracking-tight text-text-primary" style={{ fontSize: size / 4.4 }}>
          {value}
        </span>
        {label && <span className="mt-0.5 text-xs font-medium uppercase tracking-wider text-text-muted">{label}</span>}
      </div>
    </div>
  );
}

/** Weighted-factor bar that grows in when its <Reveal> parent enters. */
export function FactorBar({
  label,
  weight,
  index,
  light = false,
}: {
  label: string;
  weight: number;
  index: number;
  light?: boolean;
}) {
  return (
    <li className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3 sm:grid-cols-[11rem_1fr_3rem]">
      <span className={cn("text-sm font-medium", light ? "text-white/85" : "text-text-primary")}>{label}</span>
      <span className={cn("h-2.5 overflow-hidden rounded-full", light ? "bg-white/10" : "bg-primary-100")}>
        <span
          className="grow-bar block h-full rounded-full bg-gradient-to-r from-secondary-400 to-secondary-600"
          style={{ width: `${(weight / 25) * 100}%`, "--reveal-delay": `${120 + index * 70}ms` } as CSSProperties}
        />
      </span>
      <span className={cn("text-right text-sm tabular-nums", light ? "text-white/60" : "text-text-muted")}>
        {weight}%
      </span>
    </li>
  );
}

/** Horizontal ticker. Content is duplicated so the loop is seamless. */
export function Marquee({ items, className }: { items: string[]; className?: string }) {
  const row = [...items, ...items];
  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={{
        maskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)",
        WebkitMaskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)",
      }}
    >
      <ul className="marquee-track flex w-max animate-marquee items-center gap-10 whitespace-nowrap">
        {row.map((item, i) => (
          <li key={i} className="flex items-center gap-10 text-sm font-medium tracking-wide text-text-secondary">
            <span>{item}</span>
            <span className="h-1.5 w-1.5 rounded-full bg-secondary-400" aria-hidden />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A photo panel with a slow zoom on hover and a soft brand tint. */
export function PhotoPanel({
  src,
  alt,
  className,
  caption,
  priority = false,
  sizes = "(min-width: 1024px) 50vw, 100vw",
}: {
  src: string;
  alt: string;
  className?: string;
  caption?: ReactNode;
  priority?: boolean;
  sizes?: string;
}) {
  return (
    <figure className={cn("group relative overflow-hidden rounded-xl shadow-xl", className)}>
      <Image
        src={src}
        alt={alt}
        fill
        priority={priority}
        sizes={sizes}
        className="object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-primary-900/70 via-primary-900/10 to-transparent" />
      {caption && (
        <figcaption className="absolute inset-x-0 bottom-0 p-6 text-white">{caption}</figcaption>
      )}
    </figure>
  );
}

/* ------------------------------------------------------------- mockups -- */

const ZONE_STYLES = {
  SAFE: "bg-secondary-100 text-secondary-800 ring-secondary-200",
  TARGET: "bg-primary-50 text-primary-700 ring-primary-100",
  REACH: "bg-warning/10 text-warning ring-warning/20",
} as const;

/**
 * A match card exactly as the product draws it, used as a hero prop. The programme is
 * from the demo catalog on purpose — nothing here should read as a real institution
 * making a real claim.
 */
export function MatchCardMock({
  className,
  zone = "SAFE",
  score = 84,
  programme = "MSc Data Science and Analytics",
  university = "Northgate University",
  place = "London, United Kingdom",
  tuition = "£18,500 / year",
  deadline = "Deadline in 41 days",
  factors = [
    { label: "Academic", value: 88 },
    { label: "English", value: 80 },
    { label: "Budget", value: 92 },
    { label: "Programme fit", value: 76 },
  ],
}: {
  className?: string;
  zone?: keyof typeof ZONE_STYLES;
  score?: number;
  programme?: string;
  university?: string;
  place?: string;
  tuition?: string;
  deadline?: string;
  factors?: { label: string; value: number }[];
}) {
  return (
    <div className={cn("w-[21rem] rounded-xl border border-white/60 bg-white/95 p-5 shadow-xl backdrop-blur", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ring-1 ring-inset", ZONE_STYLES[zone])}>
            {zone} MATCH
          </span>
          <p className="mt-2.5 text-sm font-semibold leading-snug text-text-primary">{programme}</p>
          <p className="mt-0.5 text-xs text-text-secondary">
            {university} · {place}
          </p>
        </div>
        <ScoreDial value={score} size={64} stroke={6} />
      </div>
      <ul className="mt-4 space-y-2">
        {factors.map((f, i) => (
          <li key={f.label} className="grid grid-cols-[6.5rem_1fr_2.2rem] items-center gap-2 text-xs">
            <span className="text-text-secondary">{f.label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-primary-100">
              <span
                className="grow-bar block h-full rounded-full bg-secondary-500"
                style={{ width: `${f.value}%`, "--reveal-delay": `${200 + i * 90}ms` } as CSSProperties}
              />
            </span>
            <span className="text-right tabular-nums text-text-muted">{f.value}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
        <span className="font-medium text-text-primary">{tuition}</span>
        <span className="text-text-secondary">{deadline}</span>
      </div>
    </div>
  );
}

/** Small floating status chips used around the hero mock. */
export function FloatChip({
  icon,
  title,
  body,
  className,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border border-white/60 bg-white/95 px-3.5 py-2.5 shadow-lg backdrop-blur", className)}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary-100 text-secondary-700 [&>svg]:h-4 [&>svg]:w-4">
        {icon}
      </span>
      <span>
        <span className="block text-xs font-semibold text-text-primary">{title}</span>
        <span className="block text-[11px] text-text-secondary">{body}</span>
      </span>
    </div>
  );
}
