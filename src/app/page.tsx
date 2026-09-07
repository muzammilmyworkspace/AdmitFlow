import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  FileCheck2,
  Globe2,
  GraduationCap,
  Lock,
  ScanSearch,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/brand/Logo";
import { WorldMotif, GlowField } from "@/components/brand/WorldMotif";

// The landing page's job is to make an unfamiliar, expensive process feel navigable.
//
// Every number on this page is a description of how the product works — five seeded
// countries, three free matches, forty minutes — never an invented statistic. The brief's
// §55 forbids fabricated savings counters and social proof, and there are no real usage
// figures yet to quote honestly.

const STEPS = [
  {
    icon: GraduationCap,
    title: "Tell us about you",
    body: "Grades, budget, English scores, where you want to go. Ten minutes, saved as you type.",
  },
  {
    icon: ScanSearch,
    title: "See where you stand",
    body: "Every programme scored against your actual profile, with the reasoning shown.",
  },
  {
    icon: FileCheck2,
    title: "Get your documents ready",
    body: "Upload once, reviewed and verified, reused across every application.",
  },
  {
    icon: CalendarClock,
    title: "Apply and track",
    body: "Deadlines, requirements and status in one place — nothing sent until you say so.",
  },
];

const PILLARS = [
  {
    icon: Sparkles,
    title: "Nothing is a black box",
    body: "Each match shows its academic, English, budget and deadline fit separately — so you can see exactly what to strengthen, not just a number.",
  },
  {
    icon: ShieldCheck,
    title: "No inflated promises",
    body: "We say “strong match”, never “guaranteed admission”. Universities and immigration authorities make those decisions, and we won't pretend otherwise.",
  },
  {
    icon: Lock,
    title: "Your documents stay yours",
    body: "Passports and transcripts sit in private storage, reachable only through short-lived links issued to you.",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-bg">
      {/* ------------------------------------------------------------------ nav -- */}
      <header className="absolute inset-x-0 top-0 z-10">
        <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
          <Logo inverted />
          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost" size="sm" className="border-0 bg-white/10 text-white ring-white/20 hover:bg-white/20 hover:ring-white/30">
                Sign in
              </Button>
            </Link>
            <Link href="/signup" className="hidden sm:block">
              <Button size="sm" variant="secondary" className="bg-white text-primary hover:bg-white/90">
                Get started
              </Button>
            </Link>
          </div>
        </nav>
      </header>

      {/* ----------------------------------------------------------------- hero -- */}
      <section className="relative overflow-hidden bg-brand-gradient px-6 pb-28 pt-32 text-white sm:pt-36">
        <GlowField />
        <div className="pointer-events-none absolute -right-40 top-8 h-[44rem] w-[44rem] text-white/25">
          <WorldMotif />
        </div>

        <div className="relative mx-auto max-w-6xl">
          <div className="max-w-2xl animate-fade-up">
            <p className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium tracking-wide ring-1 ring-inset ring-white/15">
              <Globe2 className="h-3.5 w-3.5 text-secondary-200" aria-hidden />
              For students applying abroad on their own
            </p>

            <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
              Say No to Consultants.
              {/* pb-1 + relaxed leading: bg-clip-text crops to the text box, which
                  otherwise shears the descenders off "Apply" and "yourself". */}
              <span className="mt-2 block bg-gradient-to-r from-secondary-200 to-white bg-clip-text pb-1 leading-[1.14] text-transparent">
                Apply abroad yourself.
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/75">
              Find the universities that actually fit you, understand your real eligibility,
              organise your documents, and run your whole application from one place.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/signup">
                <Button size="lg" variant="secondary" className="bg-white text-primary shadow-xl hover:bg-white/90">
                  Start your free assessment
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="ghost" className="border-0 bg-white/10 text-white ring-white/25 hover:bg-white/20">
                  I already have an account
                </Button>
              </Link>
            </div>

            <p className="mt-6 text-sm text-white/55">
              Free to start · No card required · Your first matches are always free
            </p>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- how it -- */}
      {/* z-10 is load-bearing: the hero establishes a stacking context, so without it
          these cards paint *behind* the hero background and lose their top edge. */}
      <section className="relative z-10 mx-auto -mt-20 w-full max-w-6xl px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ icon: Icon, title, body }, index) => (
            <div
              key={title}
              className="rounded-lg border border-border bg-surface p-6 shadow-md transition-all duration-base hover:-translate-y-0.5 hover:shadow-lg"
            >
              <div className="mb-4 flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-gradient-soft ring-1 ring-inset ring-secondary-200">
                  <Icon className="h-5 w-5 text-secondary-700" aria-hidden />
                </span>
                <span className="text-2xl font-semibold text-primary-100">0{index + 1}</span>
              </div>
              <h3 className="mb-1.5 font-semibold text-text-primary">{title}</h3>
              <p className="text-sm leading-relaxed text-text-secondary">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------- pillars -- */}
      <section className="mx-auto w-full max-w-6xl px-6 py-24">
        <div className="mb-12 max-w-2xl">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-secondary-700">
            Why it works differently
          </p>
          <h2 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
            The parts a consultant usually keeps to themselves.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-text-secondary">
            You should be able to see how a recommendation was reached, what it depends on,
            and where you fall short — without paying someone for the privilege.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border border-border bg-surface p-7 shadow-sm">
              <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-primary-50 ring-1 ring-inset ring-primary-100">
                <Icon className="h-5 w-5 text-primary-700" aria-hidden />
              </span>
              <h3 className="mb-2 text-lg font-semibold text-text-primary">{title}</h3>
              <p className="text-sm leading-relaxed text-text-secondary">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ cta -- */}
      <section className="px-6 pb-24">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-xl bg-brand-gradient px-8 py-16 text-center text-white sm:px-16">
          <GlowField />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Find out where you stand — in about ten minutes.
            </h2>
            <p className="mt-4 text-lg text-white/70">
              Complete your profile and see your matches, with the reasoning behind every one.
            </p>
            <Link href="/signup" className="mt-8 inline-block">
              <Button size="lg" variant="secondary" className="bg-white text-primary shadow-xl hover:bg-white/90">
                Start your free assessment
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------- footer -- */}
      <footer className="border-t border-border bg-surface px-6 py-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <Logo />
          <p className="max-w-xl text-xs leading-relaxed text-text-muted">
            AdmitFlow provides an indicative eligibility assessment based on the information
            you provide and on programme data that may change. It is not an admission or visa
            decision — those rest with universities and immigration authorities.
          </p>
        </div>
      </footer>
    </div>
  );
}
