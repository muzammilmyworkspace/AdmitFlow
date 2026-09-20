import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  CalendarClock,
  ChevronDown,
  Eye,
  FileCheck2,
  Globe2,
  GraduationCap,
  Lock,
  MessageSquareText,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { LoginForm } from "@/features/auth/LoginForm";
import { Reveal } from "@/features/marketing/Reveal";
import {
  CtaBand,
  DarkAtmosphere,
  FactorBar,
  FloatChip,
  Marquee,
  MatchCardMock,
  PhotoPanel,
  ScoreDial,
  SectionHeading,
} from "@/features/marketing/primitives";
import { DEFAULT_RULES } from "@/services/assessment/scoring";
import { getEnv } from "@/lib/env";

export const metadata: Metadata = {
  title: "AdmitFlow — Say No to Consultants. Apply Abroad Yourself.",
  description:
    "See which universities actually fit your profile, understand your real eligibility, keep your documents in one private place and run every application yourself.",
};

// Every number on this page describes how the product works — five destination
// countries, three free matches, the engine's real factor weights — never an invented
// statistic. docs/44-seo-strategy.md §8 forbids fabricated figures and fake social proof,
// and there are no real usage numbers yet to quote honestly.

const TICKER = [
  "United Kingdom",
  "Canada",
  "Germany",
  "Australia",
  "Netherlands",
  "Bachelor's",
  "Master's",
  "Graduate diplomas",
  "Online programmes",
  "Scholarships",
  "Intake deadlines",
  "Document vault",
];

const PURPOSE_POINTS = [
  {
    icon: Eye,
    title: "You see the reasoning, not just a verdict",
    body: "A consultant tells you where to apply. AdmitFlow shows you why — every factor, every weight, every gap — so the decision is genuinely yours.",
  },
  {
    icon: Wallet,
    title: "You keep the money an agency would take",
    body: "No commission on your tuition, no retainer. You pay small, one-off fees only for the pieces you actually use.",
  },
  {
    icon: ShieldCheck,
    title: "You hear the truth about your chances",
    body: "We say “strong match”, never “guaranteed”. Universities and immigration authorities make those calls, and we won't pretend otherwise.",
  },
];

const FEATURES = [
  {
    icon: ScanSearch,
    title: "Eligibility engine",
    body: "Every programme is scored against your actual profile across eight weighted factors, then placed in a SAFE, TARGET or REACH zone.",
    span: "lg:col-span-2",
  },
  {
    icon: Sparkles,
    title: "Explainable matches",
    body: "Open any match and read exactly what helped, what hurt, and what is missing.",
  },
  {
    icon: Lock,
    title: "Private document vault",
    body: "Passports, transcripts and test scores in private storage, reviewed once and reused across every application.",
  },
  {
    icon: CalendarClock,
    title: "Application tracker",
    body: "Requirements, deadlines and status for each application — nothing is sent until you say so.",
  },
  {
    icon: MessageSquareText,
    title: "A human when you want one",
    body: "Book a 40-minute consultation or have a consultant review your assessment — optional, and priced per session.",
    span: "lg:col-span-2",
  },
  {
    icon: BellRing,
    title: "Deadline reminders",
    body: "Intake windows close on their own schedule. You are told before they do.",
  },
];

const STEPS = [
  {
    n: "01",
    icon: GraduationCap,
    title: "Tell us about you",
    body: "Grades, budget, English scores, where you want to go. About ten minutes, saved as you type.",
    image: "/marketing/desk-writing.jpg",
  },
  {
    n: "02",
    icon: ScanSearch,
    title: "See where you stand",
    body: "Every programme scored against your profile, sorted into zones, with the reasoning shown.",
    image: "/marketing/student-focus.jpg",
  },
  {
    n: "03",
    icon: FileCheck2,
    title: "Get your documents ready",
    body: "Upload once, get them reviewed and verified, reuse them across every application.",
    image: "/marketing/desk-planning.jpg",
  },
  {
    n: "04",
    icon: CalendarClock,
    title: "Apply and track",
    body: "Deadlines, requirements and status in one place, with a consultant on call if you want one.",
    image: "/marketing/students-laptop.jpg",
  },
];

const FACTORS: { key: keyof typeof DEFAULT_RULES.weights; label: string }[] = [
  { key: "academic", label: "Academic record" },
  { key: "english", label: "English proficiency" },
  { key: "budget", label: "Budget fit" },
  { key: "programFit", label: "Programme fit" },
  { key: "countryPreference", label: "Country preference" },
  { key: "risk", label: "Risk profile" },
  { key: "deadline", label: "Deadline proximity" },
  { key: "documentReadiness", label: "Document readiness" },
];

const ZONES = [
  {
    zone: "SAFE",
    score: 84,
    tone: "green" as const,
    body: "Strong compatibility on the information you gave — and it has cleared extra floors on academic, English and deadline fit. A weak profile can never be called “safe”.",
  },
  {
    zone: "TARGET",
    score: 66,
    tone: "navy" as const,
    body: "A realistic option. Some factors are strong, one or two need work — and the card tells you which.",
  },
  {
    zone: "REACH",
    score: 38,
    tone: "indigo" as const,
    body: "Possible but a stretch. Always free to see, so you can decide for yourself whether it is worth the attempt.",
  },
];

const DESTINATIONS = [
  { country: "United Kingdom", cities: "London · Manchester · Bristol", image: "/marketing/city-london.jpg" },
  { country: "Canada", cities: "Toronto · Vancouver · Calgary", image: "/marketing/city-toronto.jpg" },
  { country: "Germany", cities: "Berlin · Munich · Hamburg", image: "/marketing/city-berlin.jpg" },
  { country: "Australia", cities: "Sydney · Melbourne · Brisbane", image: "/marketing/city-sydney.jpg" },
  { country: "Netherlands", cities: "Amsterdam · Rotterdam", image: "/marketing/city-amsterdam.jpg" },
];

const COMPARISON = [
  { row: "Who chooses your universities", agent: "The agent — often those paying commission", flow: "You, from a scored, explained shortlist" },
  { row: "How eligibility is judged", agent: "Opinion, rarely written down", flow: "Eight weighted factors, shown in full" },
  { row: "What it costs", agent: "Retainers and a cut of tuition", flow: "Free to start; small one-off fees" },
  { row: "Where your passport goes", agent: "WhatsApp, email, someone's laptop", flow: "A private vault with short-lived links" },
  { row: "Honesty about outcomes", agent: "“Guaranteed admission”", flow: "“Strong match” — never a guarantee" },
  { row: "Human help", agent: "Bundled, whether you need it or not", flow: "Optional, per session, when you ask" },
];

const FAQ = [
  {
    q: "Is the assessment really free?",
    a: "Yes. Completing your profile and running the assessment costs nothing, and every REACH match plus your three highest-scoring matches are always readable. Unlocking the full SAFE and TARGET lists is a single one-off fee.",
  },
  {
    q: "Do you guarantee admission?",
    a: "No — and anyone who does is not being straight with you. AdmitFlow gives an indicative eligibility assessment based on what you tell us and on programme data that can change. Admission and visa decisions are made by universities and immigration authorities.",
  },
  {
    q: "What happens to my documents?",
    a: "They are stored in private object storage that has no public address. Every download is a short-lived link issued to you, files are checked on the server before they are accepted, and you can export or delete your account at any time.",
  },
  {
    q: "Can I still talk to a real person?",
    a: "Whenever you like. Book a 40-minute consultation or ask a consultant to review your assessment. Both are optional and priced per session — nothing is bundled in.",
  },
  {
    q: "Which countries are covered?",
    a: "Programmes across the United Kingdom, Canada, Germany, Australia and the Netherlands, with the entry requirements, tuition and intake deadlines stated on each one and a freshness label so you know when they were last verified.",
  },
];

export default function HomePage() {
  // One-click test sign-in while the auth module is being finished; hidden in production.
  const quickLogin = getEnv().APP_ENV !== "production";
  return (
    <>
      {/* ------------------------------------------------------------- hero -- */}
      <section className="relative overflow-hidden bg-primary text-white">
        <DarkAtmosphere image="/marketing/hero-graduation.jpg" imagePosition="center 40%" dim={0.74} />

        <div className="relative mx-auto grid min-h-screen w-full max-w-7xl items-center gap-14 px-5 pb-24 pt-32 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:pb-28 lg:pt-36">
          {/* Copy */}
          <div className="max-w-2xl">
            <Reveal variant="blur">
              <p className="mb-6 inline-flex items-center gap-2 rounded-full glass px-4 py-1.5 text-xs font-medium tracking-wide">
                <Globe2 className="h-3.5 w-3.5 text-secondary-200" aria-hidden />
                For students applying abroad on their own
              </p>
            </Reveal>

            <Reveal delay={90} variant="blur">
              <h1 className="text-[2.6rem] font-semibold leading-[1.04] tracking-tight sm:text-6xl lg:text-[4.4rem]">
                Say No to Consultants.
                <span className="text-shine mt-2 block animate-gradient-x pb-2 leading-[1.1]">
                  Apply abroad yourself.
                </span>
              </h1>
            </Reveal>

            <Reveal delay={180}>
              <p className="mt-7 max-w-xl text-lg leading-relaxed text-white/78 sm:text-xl">
                Find the universities that actually fit you, understand your real eligibility,
                keep your documents in one private place, and run your whole application from
                one dashboard — with a human consultant only when you choose one.
              </p>
            </Reveal>

            <Reveal delay={260}>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link href="/signup">
                  <Button size="lg" variant="secondary" className="bg-white text-primary shadow-xl hover:bg-white/90">
                    Start your free assessment
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Button>
                </Link>
                <Link href="/how-it-works">
                  <Button size="lg" variant="ghost" className="border-0 glass text-white ring-0 hover:bg-white/20">
                    See how it works
                  </Button>
                </Link>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/60">
                {["Free to start", "No card required", "Your first matches are always free"].map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <BadgeCheck className="h-4 w-4 text-secondary-300" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          {/* Sign-in panel with floating product props */}
          <div className="relative lg:justify-self-end">
            <Reveal delay={200} variant="scale" className="relative z-10">
              <div className="w-full max-w-md rounded-xl border border-white/70 bg-white p-6 text-text-primary shadow-xl sm:p-8">
                <div className="mb-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-secondary-700">
                    Welcome back
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-tight">Sign in to your dashboard</h2>
                  <p className="mt-1.5 text-sm text-text-secondary">
                    Your matches, documents and deadlines are where you left them.
                  </p>
                </div>
                <LoginForm embedded quickLogin={quickLogin} />
              </div>
            </Reveal>

            {/* Product props: two status chips at the panel's corners and a match card
                peeking out from behind it, like the next card in a stack. Desktop only —
                on a phone the sign-in form is the whole job. */}
            <div className="pointer-events-none absolute -left-28 -top-12 z-20 hidden animate-float-x xl:block" aria-hidden>
              <FloatChip icon={<FileCheck2 />} title="Transcript verified" body="Reused across 3 applications" />
            </div>
            <div className="pointer-events-none absolute -right-16 -top-8 z-20 hidden animate-float xl:block" aria-hidden>
              <FloatChip icon={<BellRing />} title="Deadline in 41 days" body="MSc Data Science · Northgate" />
            </div>
            <Reveal delay={420} variant="scale" className="pointer-events-none absolute -bottom-24 -right-12 z-0 hidden xl:block">
              <div className="animate-float-slow">
                <MatchCardMock className="rotate-[6deg] scale-[0.85]" />
              </div>
            </Reveal>
          </div>
        </div>

        {/* Scroll cue */}
        <div className="pointer-events-none absolute inset-x-0 bottom-6 hidden justify-center lg:flex" aria-hidden>
          <span className="flex h-10 w-6 items-start justify-center rounded-full border border-white/30 p-1.5">
            <span className="h-2 w-1 animate-scroll-cue rounded-full bg-white/80" />
          </span>
        </div>
      </section>

      {/* ----------------------------------------------------------- ticker -- */}
      <section className="border-b border-border bg-surface py-5">
        <Marquee items={TICKER} />
      </section>

      {/* ---------------------------------------------------------- purpose -- */}
      <section className="relative overflow-hidden px-5 py-24 sm:px-8 lg:py-32">
        <div className="pointer-events-none absolute -left-40 top-20 h-96 w-96 rounded-full bg-secondary-200/40 blur-3xl" aria-hidden />
        <div className="relative mx-auto grid w-full max-w-7xl items-center gap-14 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Why AdmitFlow exists"
              title={
                <>
                  Applying abroad is not complicated.
                  <span className="block text-secondary-600">It has just been kept that way.</span>
                </>
              }
              lead="Eligibility rules, tuition and deadlines are all public. What students lack is a clear way to see how they measure up — and someone honest enough to show them. AdmitFlow is that."
            />
            <ul className="mt-10 space-y-7">
              {PURPOSE_POINTS.map(({ icon: Icon, title, body }, i) => (
                <Reveal key={title} delay={120 + i * 100} variant="left">
                  <li className="flex gap-4">
                    <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-gradient-soft ring-1 ring-inset ring-secondary-200">
                      <Icon className="h-5 w-5 text-secondary-700" aria-hidden />
                    </span>
                    <span>
                      <span className="block text-lg font-semibold text-text-primary">{title}</span>
                      <span className="mt-1 block leading-relaxed text-text-secondary">{body}</span>
                    </span>
                  </li>
                </Reveal>
              ))}
            </ul>
          </div>

          <div className="relative">
            <Reveal variant="right" className="relative">
              <PhotoPanel
                src="/marketing/students-talk.jpg"
                alt="Students talking around a table with laptops and notebooks"
                className="aspect-[4/5] sm:aspect-[5/4] lg:aspect-[4/5]"
                caption={
                  <span className="block max-w-xs text-sm leading-relaxed text-white/85">
                    “Strong match” means we checked. It never means we promised.
                  </span>
                }
              />
            </Reveal>
            <Reveal delay={300} variant="scale" className="absolute -bottom-8 -left-6 hidden sm:block lg:-left-12">
              <div className="animate-float rounded-xl border border-white/70 bg-white/95 p-5 shadow-xl backdrop-blur">
                <div className="flex items-center gap-4">
                  <ScoreDial value={84} size={72} stroke={7} />
                  <div>
                    <p className="text-sm font-semibold text-text-primary">Overall fit</p>
                    <p className="text-xs text-text-secondary">8 factors · reasoning shown</p>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- features -- */}
      <section className="relative overflow-hidden bg-primary px-5 py-24 text-white sm:px-8 lg:py-32">
        <DarkAtmosphere image="/marketing/library-round.jpg" dim={0.86} />
        <div className="relative mx-auto w-full max-w-7xl">
          <SectionHeading
            tone="light"
            align="center"
            eyebrow="Everything in one place"
            title="The whole journey, from first question to submitted application."
            lead="Six pieces that usually live in six different tabs, a WhatsApp thread and somebody else's inbox."
          />

          <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, body, span }, i) => (
              <Reveal key={title} delay={i * 80} variant="up" className={span}>
                <div className="group relative h-full overflow-hidden rounded-xl glass p-7 transition-all duration-slow hover:-translate-y-1 hover:bg-white/[0.12]">
                  <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-secondary-400/0 blur-3xl transition-all duration-slow group-hover:bg-secondary-400/30" aria-hidden />
                  <span className="mb-6 flex h-12 w-12 items-center justify-center rounded-lg bg-white/10 ring-1 ring-inset ring-white/15">
                    <Icon className="h-5 w-5 text-secondary-200" aria-hidden />
                  </span>
                  <h3 className="text-lg font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- flow -- */}
      <section className="relative px-5 py-24 sm:px-8 lg:py-32">
        <div className="mx-auto w-full max-w-7xl">
          <SectionHeading
            eyebrow="How it works"
            title="Four steps. You are in control of every one."
            lead="Nothing is submitted, shared or paid for until you decide. Each step is saved, so you can come back whenever you like."
          />

          <ol className="relative mt-16 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {/* Connecting line */}
            <div className="pointer-events-none absolute left-0 right-0 top-[7.25rem] hidden h-px xl:block" aria-hidden>
              <Reveal variant="left" threshold={0.1}>
                <div className="h-px w-full bg-gradient-to-r from-secondary-300 via-primary-200 to-transparent" />
              </Reveal>
            </div>

            {STEPS.map(({ n, icon: Icon, title, body, image }, i) => (
              <Reveal key={n} delay={i * 110} variant="up">
                <li className="group relative h-full overflow-hidden rounded-xl border border-border bg-surface shadow-md transition-all duration-slow hover:-translate-y-1 hover:shadow-xl">
                  <div className="relative h-44 overflow-hidden">
                    <Image
                      src={image}
                      alt=""
                      fill
                      sizes="(min-width: 1280px) 25vw, (min-width: 768px) 50vw, 100vw"
                      className="object-cover transition-transform duration-[1400ms] group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-primary-900/60 to-transparent" />
                    <span className="absolute left-5 top-5 text-4xl font-semibold text-white/90">{n}</span>
                  </div>
                  <div className="p-6">
                    <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-gradient-soft ring-1 ring-inset ring-secondary-200">
                      <Icon className="h-5 w-5 text-secondary-700" aria-hidden />
                    </span>
                    <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{body}</p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>

          <Reveal delay={200} className="mt-10 text-center">
            <Link href="/how-it-works" className="inline-flex items-center gap-2 font-medium text-secondary-700 underline-offset-4 hover:underline">
              Read the full walkthrough
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Reveal>
        </div>
      </section>

      {/* --------------------------------------------------------- matching -- */}
      <section className="relative overflow-hidden bg-surface px-5 py-24 sm:px-8 lg:py-32">
        <div className="pointer-events-none absolute -right-40 top-0 h-[32rem] w-[32rem] rounded-full bg-accent/10 blur-3xl" aria-hidden />
        <div className="relative mx-auto grid w-full max-w-7xl gap-16 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <SectionHeading
              eyebrow="How universities are matched to you"
              title="Eight factors. Real weights. Nothing hidden."
              lead="Your profile is compared with every programme's stated requirements. Each factor is scored separately, weighted, and combined — and each one is shown to you, so a score is never a mystery."
            />
            <Reveal delay={120} className="mt-10">
              <ul className="space-y-3.5">
                {FACTORS.map((f, i) => (
                  <FactorBar key={f.key} label={f.label} weight={DEFAULT_RULES.weights[f.key]} index={i} />
                ))}
              </ul>
              <p className="mt-5 text-xs text-text-muted">
                Default weights of the current scoring rules. Rules are versioned: a change creates a
                new version and never rewrites a result you have already seen.
              </p>
            </Reveal>
          </div>

          <div className="grid gap-4">
            {ZONES.map(({ zone, score, tone, body }, i) => (
              <Reveal key={zone} delay={i * 120} variant="right">
                <div className="flex items-center gap-6 rounded-xl border border-border bg-bg p-6 shadow-sm transition-all duration-slow hover:-translate-y-0.5 hover:shadow-md">
                  <ScoreDial value={score} size={96} stroke={9} tone={tone} label={zone} />
                  <div>
                    <h3 className="text-lg font-semibold text-text-primary">{zone} zone</h3>
                    <p className="mt-1 text-sm leading-relaxed text-text-secondary">{body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- destinations -- */}
      <section className="px-5 py-24 sm:px-8 lg:py-32">
        <div className="mx-auto w-full max-w-7xl">
          <SectionHeading
            align="center"
            eyebrow="Where you can go"
            title="Programmes across five destination countries."
            lead="Entry requirements, tuition, intakes and deadlines are stated on every programme, with a freshness label so you know when they were last verified."
          />

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {DESTINATIONS.map(({ country, cities, image }, i) => (
              <Reveal key={country} delay={i * 90} variant="scale">
                <Link
                  href="/universities"
                  className="group relative block aspect-[3/4] overflow-hidden rounded-xl shadow-md transition-all duration-slow hover:-translate-y-1 hover:shadow-xl"
                >
                  <Image
                    src={image}
                    alt={country}
                    fill
                    sizes="(min-width: 1024px) 20vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover transition-transform duration-[1600ms] group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-primary-900/85 via-primary-900/20 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-5 text-white">
                    <p className="text-lg font-semibold">{country}</p>
                    <p className="mt-0.5 text-xs text-white/70">{cities}</p>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- comparison -- */}
      <section className="relative overflow-hidden bg-primary px-5 py-24 text-white sm:px-8 lg:py-32">
        <DarkAtmosphere image="/marketing/campus-2.jpg" dim={0.88} />
        <div className="relative mx-auto w-full max-w-6xl">
          <SectionHeading
            tone="light"
            align="center"
            eyebrow="The difference"
            title="What an agent does for you — and what you can now do for yourself."
          />

          <Reveal delay={120} className="mt-14">
            <div className="overflow-hidden rounded-xl glass">
              <div className="grid grid-cols-[1.2fr_1fr_1fr] border-b border-white/10 text-xs font-semibold uppercase tracking-[0.12em] text-white/60">
                <div className="px-5 py-4">&nbsp;</div>
                <div className="px-5 py-4">Typical agent</div>
                <div className="bg-secondary-500/15 px-5 py-4 text-secondary-200">AdmitFlow</div>
              </div>
              {COMPARISON.map((r, i) => (
                <Reveal key={r.row} delay={160 + i * 60} variant="up" threshold={0.05}>
                  <div className="grid grid-cols-[1.2fr_1fr_1fr] border-b border-white/10 text-sm last:border-b-0">
                    <div className="px-5 py-4 font-medium">{r.row}</div>
                    <div className="flex items-start gap-2 px-5 py-4 text-white/60">
                      <X className="mt-0.5 h-4 w-4 shrink-0 text-error/80" aria-hidden />
                      {r.agent}
                    </div>
                    <div className="flex items-start gap-2 bg-secondary-500/10 px-5 py-4 text-white">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-secondary-300" aria-hidden />
                      {r.flow}
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------------------------------------------------- pricing -- */}
      <section className="px-5 py-24 sm:px-8 lg:py-32">
        <div className="mx-auto w-full max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.3fr] lg:items-center">
            <SectionHeading
              eyebrow="Pricing"
              title="Free to start. Pay only for the pieces you use."
              lead="No retainers, no commission on your tuition. Each paid piece is a small one-off amount, and you always know what you are getting before you pay."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { name: "Free assessment", price: "€0", body: "Profile, full scoring, every REACH match and your three best matches — always readable." },
                { name: "Unlock all matches", price: "€9.99", body: "Every SAFE and TARGET programme with full detail and reasoning. One-off." },
                { name: "Consultant review", price: "€10", body: "A consultant reads your assessment and writes back with what they would do next." },
                { name: "40-minute consultation", price: "€30", body: "A live session with a consultant, booked from the calendar when you want it." },
              ].map((p, i) => (
                <Reveal key={p.name} delay={i * 90} variant="up">
                  <div className="h-full rounded-xl border border-border bg-surface p-6 shadow-sm transition-all duration-slow hover:-translate-y-1 hover:shadow-lg">
                    <p className="text-sm font-medium text-text-secondary">{p.name}</p>
                    <p className="mt-2 text-3xl font-semibold tracking-tight text-text-primary">{p.price}</p>
                    <p className="mt-3 text-sm leading-relaxed text-text-secondary">{p.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
          <Reveal delay={200} className="mt-8">
            <Link href="/pricing" className="inline-flex items-center gap-2 font-medium text-secondary-700 underline-offset-4 hover:underline">
              See full pricing
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Reveal>
        </div>
      </section>

      {/* -------------------------------------------------------------- faq -- */}
      <section className="bg-surface px-5 py-24 sm:px-8 lg:py-32">
        <div className="mx-auto grid w-full max-w-7xl gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <SectionHeading
              eyebrow="Questions"
              title="Straight answers."
              lead="If it is not answered here, it is answered on the page for each part of the product."
            />
            <Reveal delay={150} className="mt-8 hidden lg:block">
              <PhotoPanel
                src="/marketing/students-group.jpg"
                alt="A group of students sitting together outdoors"
                className="aspect-[4/3]"
              />
            </Reveal>
          </div>
          <div className="self-start divide-y divide-border rounded-xl border border-border bg-bg">
            {FAQ.map((item, i) => (
              <Reveal key={item.q} delay={i * 70} variant="up" threshold={0.05}>
                <details className="faq group px-6 py-5">
                  <summary className="flex items-center justify-between gap-4 text-base font-semibold text-text-primary">
                    {item.q}
                    <ChevronDown className="faq-chevron h-5 w-5 shrink-0 text-text-muted" aria-hidden />
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-text-secondary">{item.a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
