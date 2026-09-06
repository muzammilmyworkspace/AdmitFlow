import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getActor } from "@/lib/auth/guards";
import { OnboardingWizard } from "@/features/onboarding/OnboardingWizard";

export const metadata: Metadata = { title: "Complete your profile · AdmitFlow" };

export default async function OnboardingPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.status === "EMAIL_UNVERIFIED" || actor.status === "REGISTERED") {
    redirect("/verify-email");
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-10">
      <div className="mb-8">
        <Link href="/dashboard" className="text-sm text-text-secondary underline">
          ← Back to dashboard
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-text-primary">Complete your profile</h1>
        <p className="text-sm text-text-secondary">
          The more accurate this is, the more honest your eligibility assessment will be.
          Everything saves as you go, so you can leave and come back.
        </p>
      </div>
      <OnboardingWizard />
    </main>
  );
}
