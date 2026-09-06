import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getActor } from "@/lib/auth/guards";
import { AssessmentView } from "@/features/assessment/AssessmentView";
import { Alert } from "@/components/ui/Alert";

export const metadata: Metadata = { title: "My matches · AdmitFlow" };

export default async function AssessmentPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  // The assessment needs a finished profile to say anything honest, so an unfinished one
  // is redirected to the wizard rather than shown an engine error.
  if (actor.status === "ONBOARDING") {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-semibold text-text-primary">My matches</h1>
        <Alert tone="info">
          Finish your profile first — the assessment is only as accurate as what it is given.{" "}
          <Link href="/onboarding" className="font-medium underline">
            Complete your profile
          </Link>
          .
        </Alert>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-text-primary">My matches</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Every score below comes with its reasoning — open “Why this score?” on any card.
      </p>
      <AssessmentView />
    </div>
  );
}
