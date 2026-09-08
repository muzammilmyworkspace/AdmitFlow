import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, UserRoundPen } from "lucide-react";
import { getActor } from "@/lib/auth/guards";
import { OnboardingWizard } from "@/features/onboarding/OnboardingWizard";
import { Logo } from "@/components/brand/Logo";
import { AmbientBackground } from "@/components/brand/AmbientBackground";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Complete your profile" };

export default async function OnboardingPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.status === "EMAIL_UNVERIFIED" || actor.status === "REGISTERED") {
    redirect("/verify-email");
  }

  return (
    // No bg-* on the wrapper: it would paint over the -z-10 ambient layer, since a
    // relative element with z-index auto creates no stacking context. The page colour
    // comes from body.
    <div className="relative min-h-screen">
      <AmbientBackground />

      <header className="border-b border-border/70 bg-surface/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
          <Logo />
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-text-secondary transition-colors duration-fast hover:text-text-primary"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to dashboard
          </Link>
        </div>
      </header>

      <div className="h-px w-full bg-gradient-to-r from-secondary-500/70 via-primary-500/50 to-transparent" />

      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="animate-fade-up">
          <PageHeader
            icon={UserRoundPen}
            eyebrow="Step one"
            title="Tell us about you"
            description={
              <>
                The more accurate this is, the more honest your assessment will be.
                Everything saves as you go, so you can leave and come back whenever you
                like.
              </>
            }
          />
        </div>
        <OnboardingWizard />
      </main>
    </div>
  );
}
