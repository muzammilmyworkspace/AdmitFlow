import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/rbac";
import { ReviewQueue } from "@/features/admin/ReviewQueue";

export const metadata: Metadata = { title: "Assessment reviews · Admin" };

// The layout already gates /admin on staff-ness generally; this page needs the specific
// permission, because an admin who can read the audit log has no business writing a
// consultant's review of a student's assessment.
export default async function AssessmentReviewsPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!actor.permissions.has(PERMISSIONS.ASSESSMENT_REVIEW_DELIVER)) redirect("/admin");

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-text-primary">Assessment reviews</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Students who paid for a consultant to read their assessment. Claim one to start
        writing; they&apos;re emailed the moment you deliver it.
      </p>
      <ReviewQueue />
    </div>
  );
}
