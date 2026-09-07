import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getActor } from "@/lib/auth/guards";
import { OnboardingWizard } from "@/features/onboarding/OnboardingWizard";
import { Logo } from "@/components/brand/Logo";

export const metadata: Metadata = { title: "Complete your profile · AdmitFlow" };

export default async function OnboardingPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.status === "EMAIL_UNVERIFIED" || actor.status === "REGISTERED") {
    redirect("/verify-email");
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
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

      <main className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="mb-9 max-w-2xl animate-fade-up">
          <h1 className="text-3xl font-semibold tracking-tight text-text-primary">
            Tell us about you
          </h1>
          <p className="mt-2 leading-relaxed text-text-secondary">
            The more accurate this is, the more honest your assessment will be. Everything
            saves as you go, so you can leave and come back whenever you like.
          </p>
        </div>
        <OnboardingWizard />
      </main>
    </div>
  );
}
