import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ScanSearch } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
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
      <div className="animate-fade-in">
        <PageHeader
          icon={ScanSearch}
          eyebrow="Your results"
          title="My matches"
        />
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
    <div className="animate-fade-in">
      <PageHeader
        icon={ScanSearch}
        eyebrow="Your results"
        title="My matches"
        description={
          <>
            Every score below comes with its reasoning — open “Why this score?” on any card.
          </>
        }
      />
      <AssessmentView />
    </div>
  );
}
