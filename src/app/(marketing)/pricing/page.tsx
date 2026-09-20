import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, CreditCard, Lock, ReceiptText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Reveal } from "@/features/marketing/Reveal";
import { CtaBand, DarkAtmosphere, PageHero, PhotoPanel, SectionHeading } from "@/features/marketing/primitives";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Free to start. Unlock all your matches for €9.99, add a consultant review for €10 or a 40-minute consultation for €30 — one-off, no retainers, no commission.",
};

// Prices mirror the seeded Product/Price rows (prisma/seed.ts). If they change there,
// change them here; the marketing site must never quote a number the checkout disagrees with.
const PLANS = [
  {
    name: "Free assessment",
    price: "€0",
    period: "always",
    lead: "Everything you need to know where you stand.",
    features: [
      "Complete profile, saved as you go",
      "Full eligibility scoring across all programmes",
      "Every REACH match, readable in full",
      "Your three strongest matches, readable in full",
      "Browse and search the whole catalog",
      "Document vault and application tracker",
    ],
    cta: "Start free",
    href: "/signup",
    featured: false,
  },
  {
    name: "Unlock all matches",
    price: "€9.99",
    period: "one-off",
    lead: "Your full SAFE and TARGET lists, with the reasoning.",
    features: [
      "Every SAFE and TARGET programme unlocked",
      "Factor-by-factor breakdown on each",
      "Strengths, gaps and missing requirements",
      "Tuition, intake and deadline detail",
      "Stays unlocked for that assessment",
    ],
    cta: "Run your assessment first",
    href: "/signup",
    featured: true,
  },
  {
    name: "Human help",
    price: "€10 – €30",
    period: "per session",
    lead: "A consultant, only when you ask for one.",
    features: [
      "Consultant review of your assessment — €10",
      "Live 40-minute consultation — €30",
      "Booked from a calendar, at your time",
      "Written notes you keep afterwards",
      "Never bundled, never a retainer",
    ],
    cta: "See how it works",
    href: "/how-it-works",
    featured: false,
  },
];

const APPLICATION_FEE = {
  name: "Application submission",
  price: "€15",
  body: "Charged per application, only when you choose to submit one through AdmitFlow. Preparing, tracking and editing an application is free.",
};

const ASSURANCES = [
  { icon: CreditCard, title: "Card payments by Stripe", body: "Your card details never touch our servers. Checkout is hosted by the payment provider." },
  { icon: ShieldCheck, title: "Access confirmed server-side", body: "Nothing unlocks because a page said “success”. The provider confirms the payment directly to us, and only then is access granted." },
  { icon: ReceiptText, title: "Every purchase on record", body: "Your billing page lists what you bought, when, and what it unlocked." },
  { icon: Lock, title: "No subscriptions", body: "Every price here is one-off. There is nothing to cancel because nothing renews." },
];

const FAQ = [
  {
    q: "Why is the assessment free if the results cost money?",
    a: "Because the assessment is where the value is decided, and you should not pay before you know it is worth paying for. You see every REACH match and your three best matches in full before spending anything.",
  },
  {
    q: "What exactly do I get for €9.99?",
    a: "The full list of SAFE and TARGET programmes for your assessment, each with its score, zone, factor breakdown, reasoning, tuition, intake and deadline. It is one payment for that assessment's results.",
  },
  {
    q: "Is there any commission from universities?",
    a: "No. AdmitFlow is not paid by universities to place you, which is why nobody here has a reason to steer you toward one over another.",
  },
  {
    q: "Can I get a refund?",
    a: "Consultations can be cancelled from your bookings page before the session starts, and the slot is freed for someone else. Unlocked results are delivered instantly, so please read your free matches first and decide from there.",
  },
];

export default function PricingPage() {
  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title={
          <>
            Free to start.
            <span className="text-shine block animate-gradient-x pb-2">Pay only for what you use.</span>
          </>
        }
        lead="No retainers. No commission on your tuition. Small, one-off amounts for the pieces you choose — and you always know what you are getting before you pay."
        image="/marketing/desk-backpack.jpg"
        imagePosition="center 40%"
      />

      {/* ------------------------------------------------------------ plans -- */}
      <section className="relative -mt-12 px-5 pb-24 sm:px-8 lg:pb-32">
        <div className="relative mx-auto w-full max-w-7xl">
          <div className="grid gap-5 lg:grid-cols-3">
            {PLANS.map((plan, i) => (
              <Reveal key={plan.name} delay={i * 110} variant="up" threshold={0.05}>
                <div
                  className={cn(
                    "relative flex h-full flex-col rounded-xl border p-8 shadow-lg transition-all duration-slow hover:-translate-y-1 hover:shadow-xl",
                    plan.featured
                      ? "border-secondary-300 bg-surface ring-4 ring-secondary-200/60"
                      : "border-border bg-surface",
                  )}
                >
                  {plan.featured && (
                    <span className="absolute -top-3.5 left-8 rounded-full bg-brand-gradient px-3 py-1 text-xs font-semibold text-white shadow-brand-glow">
                      Most useful
                    </span>
                  )}
                  <p className="text-sm font-semibold uppercase tracking-[0.12em] text-secondary-700">{plan.name}</p>
                  <p className="mt-4 flex items-baseline gap-2">
                    <span className="text-5xl font-semibold tracking-tight text-text-primary">{plan.price}</span>
                    <span className="text-sm text-text-muted">{plan.period}</span>
                  </p>
                  <p className="mt-3 text-text-secondary">{plan.lead}</p>
                  <ul className="mt-7 flex-1 space-y-3">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-3 text-sm text-text-primary">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-secondary-600" aria-hidden />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link href={plan.href} className="mt-8 block">
                    <Button className="w-full" size="lg" variant={plan.featured ? "primary" : "ghost"}>
                      {plan.cta}
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Button>
                  </Link>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={350} className="mt-5">
            <div className="flex flex-col gap-4 rounded-xl border border-border bg-brand-gradient-soft p-7 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.12em] text-secondary-700">{APPLICATION_FEE.name}</p>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-text-secondary">{APPLICATION_FEE.body}</p>
              </div>
              <p className="text-4xl font-semibold tracking-tight text-text-primary">
                {APPLICATION_FEE.price}
                <span className="ml-2 text-sm font-normal text-text-muted">per application</span>
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------- assurances -- */}
      <section className="relative overflow-hidden bg-primary px-5 py-24 text-white sm:px-8 lg:py-32">
        <DarkAtmosphere image="/marketing/campus-1.jpg" dim={0.88} />
        <div className="relative mx-auto w-full max-w-7xl">
          <SectionHeading
            tone="light"
            align="center"
            eyebrow="How payment works"
            title="Boring, on purpose."
            lead="The interesting part of AdmitFlow is your assessment. Payment should be the least interesting thing that happens to you here."
          />
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ASSURANCES.map(({ icon: Icon, title, body }, i) => (
              <Reveal key={title} delay={i * 90} variant="up">
                <div className="h-full rounded-xl glass p-7 transition-all duration-slow hover:-translate-y-1 hover:bg-white/[0.12]">
                  <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-white/10 ring-1 ring-inset ring-white/15">
                    <Icon className="h-5 w-5 text-secondary-200" aria-hidden />
                  </span>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- faq -- */}
      <section className="px-5 py-24 sm:px-8 lg:py-32">
        <div className="mx-auto grid w-full max-w-7xl gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <SectionHeading eyebrow="Questions about paying" title="What people ask before they pay." />
            <Reveal delay={150} className="mt-8 hidden lg:block">
              <PhotoPanel src="/marketing/students-laptop.jpg" alt="Students working together on laptops" className="aspect-[4/3]" />
            </Reveal>
          </div>
          <div className="self-start divide-y divide-border rounded-xl border border-border bg-surface">
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

      <CtaBand
        title="Start with the free part."
        lead="Complete your profile, run the assessment, read your free matches. Decide about the rest afterwards."
      />
    </>
  );
}
