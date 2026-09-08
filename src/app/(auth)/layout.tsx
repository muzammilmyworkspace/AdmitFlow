import Link from "next/link";
import { GraduationCap, Globe2, ShieldCheck, Sparkles } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { WorldMotif, GlowField } from "@/components/brand/WorldMotif";

// Split-screen auth shell.
//
// The left panel exists to set the stakes: someone signing in here is starting an
// application to a university in another country, and the interface should feel like
// that rather than like a generic SaaS login. It collapses away entirely below `lg` —
// on a phone the form is the whole job, and a decorative panel above it would just push
// the fields off-screen (docs/07 §"Responsive", the brief's §58 on mobile).
const ASSURANCES = [
  {
    icon: Globe2,
    title: "Universities across five countries",
    body: "Compare programmes side by side, with the entry requirements stated plainly.",
  },
  {
    icon: Sparkles,
    title: "Know where you stand, and why",
    body: "Every match comes with its reasoning — never an unexplained score.",
  },
  {
    icon: ShieldCheck,
    title: "Your documents stay private",
    body: "Passports and transcripts are encrypted and never publicly reachable.",
  },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-brand-gradient px-12 py-14 text-white lg:flex lg:flex-col">
        <GlowField />
        <div className="pointer-events-none absolute -right-28 top-1/2 h-[38rem] w-[38rem] -translate-y-1/2 text-white/30">
          <WorldMotif />
        </div>

        <div className="relative">
          <Link href="/" className="inline-flex">
            <Logo inverted />
          </Link>
        </div>

        <div className="relative mt-auto max-w-lg">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-medium tracking-wide text-secondary-100 ring-1 ring-inset ring-white/15">
            <GraduationCap className="h-3.5 w-3.5" aria-hidden />
            Say No to Consultants
          </p>
          <h2 className="text-4xl font-semibold leading-[1.12] tracking-tight">
            Your application abroad,
            <span className="block text-secondary-200">on your own terms.</span>
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">
            Discover universities, understand your real eligibility, and manage every
            document and deadline from one place.
          </p>

          <ul className="mt-10 space-y-5">
            {ASSURANCES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-inset ring-white/15">
                  <Icon className="h-5 w-5 text-secondary-200" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-medium text-white">{title}</span>
                  <span className="block text-sm text-white/60">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative mt-12 text-xs leading-relaxed text-white/45">
          AdmitFlow gives you an indicative eligibility assessment. Admission and visa
          decisions rest with universities and immigration authorities.
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex min-h-screen flex-col justify-center bg-bg px-4 py-12 sm:px-8">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="mb-8 inline-flex lg:hidden">
            <Logo />
          </Link>
          <div className="animate-fade-up">{children}</div>
          <p className="mt-8 text-center text-xs leading-relaxed text-text-muted lg:hidden">
            Eligibility guidance only — not an admission or visa decision.
          </p>
        </div>
      </main>
    </div>
  );
}
