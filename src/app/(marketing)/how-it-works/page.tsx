import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  CalendarClock,
  FileCheck2,
  GraduationCap,
  Lock,
  MessageSquareText,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/features/marketing/Reveal";
import {
  CtaBand,
  DarkAtmosphere,
  Eyebrow,
  FactorBar,
  MatchCardMock,
  PageHero,
  PhotoPanel,
  ScoreDial,
  SectionHeading,
} from "@/features/marketing/primitives";
import { DEFAULT_RULES } from "@/services/assessment/scoring";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "From a ten-minute profile to a submitted application: how AdmitFlow scores your eligibility, keeps your documents private, and keeps you in control of every step.",
};

const STAGES = [
  {
    n: "01",
    icon: GraduationCap,
    eyebrow: "Your profile",
    title: "Tell us about you — once.",
    body: "Education history, grades, English test results (or an honest estimate if you have not sat one yet), budget, and where you would like to study. Six short steps, about ten minutes, and everything is saved as you go so you can stop and come back.",
    points: ["Saved as you type", "Estimates are allowed, and labelled as estimates", "Change anything later and re-run"],
    image: "/marketing/desk-writing.jpg",
    alt: "A student writing notes at a desk",
  },
  {
    n: "02",
    icon: ScanSearch,
    eyebrow: "The assessment",
    title: "Every programme, scored against your profile.",
    body: "Each programme's stated requirements are compared with what you told us across eight factors. Every factor gets its own score and its own written reasoning; the weighted total places the programme in a SAFE, TARGET or REACH zone.",
    points: ["Eight factors, each explained", "Zones with hard floors — a weak profile is never “safe”", "Versioned rules: results never silently change"],
    image: "/marketing/student-focus.jpg",
    alt: "A student concentrating on a laptop",
  },
  {
    n: "03",
    icon: Sparkles,
    eyebrow: "Your matches",
    title: "Read the reasoning. Decide for yourself.",
    body: "Every REACH match and your three strongest matches are always free to read in full. Unlock the rest of your SAFE and TARGET list with a single one-off payment — and what is locked is genuinely withheld, not blurred on your screen.",
    points: ["Strengths, weaknesses and missing requirements per match", "Tuition, intake and deadline on every card", "A freshness label on the data behind it"],
    image: "/marketing/library-aisle.jpg",
    alt: "Rows of books in a university library",
  },
  {
    n: "04",
    icon: FileCheck2,
    eyebrow: "The vault",
    title: "Upload each document once.",
    body: "Passport, transcripts, test certificates, references. Files are checked on the server before they are accepted, reviewed by a person, and marked verified — then reused across every application you make.",
    points: ["Private storage with no public address", "Short-lived download links issued only to you", "Review status you can see at a glance"],
    image: "/marketing/desk-planning.jpg",
    alt: "A desk with a notebook, laptop and coffee",
  },
  {
    n: "05",
    icon: CalendarClock,
    eyebrow: "Applications",
    title: "Apply, and track every one.",
    body: "Start an application from any match. Requirements are listed against your verified documents, so you can see what is still missing. Nothing is submitted until you say so, and every status change is recorded.",
    points: ["Requirement checklist per application", "Deadline reminders before intakes close", "A full history of what happened, and when"],
    image: "/marketing/students-laptop.jpg",
    alt: "Students working together on laptops",
  },
  {
    n: "06",
    icon: MessageSquareText,
    eyebrow: "When you want a person",
    title: "A consultant — on your terms.",
    body: "Ask a consultant to review your assessment and write back, or book a live 40-minute session from the calendar. Both are optional and priced per session. Nothing is bundled, and nobody is paid to steer you toward a particular university.",
    points: ["Written review of your assessment", "Live 40-minute consultation", "Priced per session, never a retainer"],
    image: "/marketing/students-talk.jpg",
    alt: "Students talking around a table",
  },
];

const FACTORS: { key: keyof typeof DEFAULT_RULES.weights; label: string; note: string }[] = [
  { key: "academic", label: "Academic record", note: "Your grades against the programme's stated entry standard." },
  { key: "english", label: "English proficiency", note: "IELTS, TOEFL and equivalents against the programme's minimum." },
  { key: "budget", label: "Budget fit", note: "Tuition against the budget you set — a hard ceiling if you want one." },
  { key: "programFit", label: "Programme fit", note: "Field of study and level against what you want to study." },
  { key: "countryPreference", label: "Country preference", note: "Where you said you would like to go." },
  { key: "risk", label: "Risk profile", note: "How much depends on estimates rather than evidence." },
  { key: "deadline", label: "Deadline proximity", note: "Whether the next intake is realistically reachable." },
  { key: "documentReadiness", label: "Document readiness", note: "How much of the required paperwork you already have verified." },
];

const GUARANTEES = [
  {
    icon: Lock,
    title: "Locked means withheld",
    body: "When a match is locked, its name, score and reasoning are never sent to your browser at all. There is nothing to un-blur.",
  },
  {
    icon: ShieldCheck,
    title: "Payments confirm server-side",
    body: "Access is granted only when the payment provider confirms it directly to us — never because a page said “success”.",
  },
  {
    icon: UserRoundCheck,
    title: "Your data is yours",
    body: "Export everything you have given us, or delete your account, from your settings. No email to a support desk required.",
  },
  {
    icon: BellRing,
    title: "No silent changes",
    body: "Scoring rules are versioned. When they change, you are told which version produced which result.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <PageHero
        eyebrow="How it works"
        title={
          <>
            From first question
            <span className="text-shine block animate-gradient-x pb-2">to submitted application.</span>
          </>
        }
        lead="Six stages, each one explained, each one under your control. Here is exactly what happens between creating an account and pressing submit."
        image="/marketing/campus-1.jpg"
        imagePosition="center 60%"
      >
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/signup">
            <Button size="lg" variant="secondary" className="bg-white text-primary shadow-xl hover:bg-white/90">
              Start your free assessment
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </Link>
        </div>
      </PageHero>

      {/* ----------------------------------------------------------- stages -- */}
      <section className="relative px-5 py-24 sm:px-8 lg:py-32">
        <div className="pointer-events-none absolute -left-40 top-1/3 h-[30rem] w-[30rem] rounded-full bg-secondary-200/40 blur-3xl" aria-hidden />
        <div className="relative mx-auto w-full max-w-7xl space-y-28">
          {STAGES.map(({ n, icon: Icon, eyebrow, title, body, points, image, alt }, i) => {
            const flip = i % 2 === 1;
            return (
              <div key={n} className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
                <Reveal variant={flip ? "right" : "left"} className={flip ? "lg:order-2" : ""}>
                  <div className="flex items-center gap-4">
                    <span className="text-5xl font-semibold text-primary-100">{n}</span>
                    <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-gradient-soft ring-1 ring-inset ring-secondary-200">
                      <Icon className="h-5 w-5 text-secondary-700" aria-hidden />
                    </span>
                  </div>
                  <Eyebrow className="mt-6">{eyebrow}</Eyebrow>
                  <h2 className="text-3xl font-semibold leading-tight tracking-tight text-text-primary sm:text-4xl">
                    {title}
                  </h2>
                  <p className="mt-5 text-lg leading-relaxed text-text-secondary">{body}</p>
                  <ul className="mt-7 space-y-3">
                    {points.map((p, j) => (
                      <Reveal key={p} delay={150 + j * 80} variant="up">
                        <li className="flex items-start gap-3 text-text-primary">
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-secondary-500" aria-hidden />
                          {p}
                        </li>
                      </Reveal>
                    ))}
                  </ul>
                </Reveal>
                <Reveal variant={flip ? "left" : "right"} delay={100} className={flip ? "lg:order-1" : ""}>
                  <div className="relative">
                    <PhotoPanel src={image} alt={alt} className="aspect-[4/3]" />
                    {n === "02" && (
                      <div className="absolute -bottom-10 -right-4 hidden animate-float sm:block lg:-right-10">
                        <MatchCardMock className="scale-90" />
                      </div>
                    )}
                    {n === "04" && (
                      <div className="absolute -bottom-6 left-6 hidden animate-float-x sm:flex items-center gap-3 rounded-lg border border-white/70 bg-white/95 px-4 py-3 shadow-xl backdrop-blur">
                        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary-100 text-secondary-700">
                          <FileCheck2 className="h-4 w-4" aria-hidden />
                        </span>
                        <span>
                          <span className="block text-xs font-semibold text-text-primary">Passport · Verified</span>
                          <span className="block text-[11px] text-text-secondary">Reviewed and ready to reuse</span>
                        </span>
                      </div>
                    )}
                  </div>
                </Reveal>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------------------------------------------------------- scoring -- */}
      <section className="relative overflow-hidden bg-primary px-5 py-24 text-white sm:px-8 lg:py-32">
        <DarkAtmosphere image="/marketing/library-round.jpg" dim={0.88} />
        <div className="relative mx-auto w-full max-w-7xl">
          <SectionHeading
            tone="light"
            eyebrow="The scoring, in detail"
            title="Eight factors, weighted, each with its own reasoning."
            lead="These are the default weights of the current rules. They are shown on every match, so you can see which factor moved the score and by how much."
          />
          <div className="mt-14 grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-start">
            <Reveal delay={120}>
              <ul className="space-y-4 rounded-xl glass p-7">
                {FACTORS.map((f, i) => (
                  <FactorBar key={f.key} label={f.label} weight={DEFAULT_RULES.weights[f.key]} index={i} light />
                ))}
              </ul>
            </Reveal>
            <div className="grid gap-3">
              {FACTORS.map((f, i) => (
                <Reveal key={f.key} delay={i * 60} variant="right" threshold={0.05}>
                  <div className="rounded-lg border border-white/10 bg-white/[0.04] px-5 py-3.5">
                    <p className="text-sm font-semibold">{f.label}</p>
                    <p className="text-sm text-white/60">{f.note}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>

          <div className="mt-16 grid gap-4 sm:grid-cols-3">
            {[
              { zone: "SAFE", min: DEFAULT_RULES.thresholds.safeMin, tone: "green" as const, body: "At or above this score and clear of the extra floors on academic, English and deadline fit." },
              { zone: "TARGET", min: DEFAULT_RULES.thresholds.targetMin, tone: "navy" as const, body: "At or above this score. Realistic, with one or two things to strengthen." },
              { zone: "REACH", min: DEFAULT_RULES.thresholds.reachMin, tone: "indigo" as const, body: "At or above this score. A stretch — and always free to read in full." },
            ].map((z, i) => (
              <Reveal key={z.zone} delay={i * 100} variant="scale">
                <div className="flex items-center gap-5 rounded-xl glass p-6">
                  <ScoreDial value={z.min} size={84} stroke={8} tone={z.tone} className="[&_span]:!text-white" />
                  <div>
                    <p className="font-semibold">{z.zone} from {z.min}</p>
                    <p className="mt-1 text-sm text-white/65">{z.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- guarantees -- */}
      <section className="px-5 py-24 sm:px-8 lg:py-32">
        <div className="mx-auto w-full max-w-7xl">
          <SectionHeading
            align="center"
            eyebrow="Built to be trusted"
            title="Four things that are true whatever you do."
          />
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {GUARANTEES.map(({ icon: Icon, title, body }, i) => (
              <Reveal key={title} delay={i * 90} variant="up">
                <div className="h-full rounded-xl border border-border bg-surface p-7 shadow-sm transition-all duration-slow hover:-translate-y-1 hover:shadow-lg">
                  <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-primary-50 ring-1 ring-inset ring-primary-100">
                    <Icon className="h-5 w-5 text-primary-700" aria-hidden />
                  </span>
                  <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
