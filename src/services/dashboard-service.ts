import "server-only";
import { db } from "@/lib/db";
import { getOnboardingStatus } from "@/services/profile-service";
import { getLatestAssessment } from "@/services/assessment/assessment-service";
import { listEntitlements } from "@/services/entitlement-service";

// Dashboard aggregation — docs/31 of the build brief ("Where am I? What's missing? What
// should I do next?").
//
// The journey roadmap is computed, not stored: a stored "current stage" pointer goes
// stale the moment a student deletes a document or their assessment is re-run, and then
// the dashboard confidently tells them the wrong next step.

export type StageStatus = "COMPLETE" | "ACTIVE" | "BLOCKED" | "LOCKED";

export interface JourneyStage {
  key: string;
  label: string;
  status: StageStatus;
  detail: string;
  href: string;
}

export interface NextAction {
  label: string;
  href: string;
  rationale: string;
}

export interface DashboardSummary {
  accountStatus: string;
  journey: JourneyStage[];
  nextAction: NextAction | null;
  counts: {
    documentsVerified: number;
    documentsPending: number;
    documentsRejected: number;
    documentsMissing: number;
    applications: number;
    applicationsSubmitted: number;
    upcomingBookings: number;
    unreadNotifications: number;
  };
  latestAssessment: {
    id: string;
    generatedAt: Date;
    safe: number;
    target: number;
    reach: number;
    unlocked: boolean;
  } | null;
  deadlines: { applicationId: string; program: string; term: string; deadline: Date; daysLeft: number }[];
}

export async function getDashboardSummary(
  userId: string,
  profileId: string | null,
  accountStatus: string,
): Promise<DashboardSummary> {
  const [documents, requirements, applications, bookings, entitlements, unreadNotifications] =
    await Promise.all([
      db.document.findMany({ where: { ownerId: userId, deletedAt: null } }),
      db.documentRequirement.findMany({ where: { programId: null, isMandatory: true } }),
      db.application.findMany({
        where: { studentId: userId, deletedAt: null },
        include: { program: true, intake: true },
      }),
      db.booking.findMany({
        where: { studentId: userId, status: { in: ["HELD", "CONFIRMED"] } },
        include: { slot: true },
      }),
      listEntitlements(userId),
      db.notification.count({ where: { userId, readAt: null } }),
    ]);

  const onboarding = profileId ? await getOnboardingStatus(profileId) : null;
  const assessmentRow = profileId ? await getLatestAssessment(profileId) : null;

  const verifiedTypes = new Set(
    documents.filter((d) => d.status === "VERIFIED").map((d) => d.type),
  );
  const counts = {
    documentsVerified: documents.filter((d) => d.status === "VERIFIED").length,
    documentsPending: documents.filter((d) => d.status === "PENDING_REVIEW").length,
    documentsRejected: documents.filter((d) => d.status === "REJECTED").length,
    documentsMissing: requirements.filter((r) => !verifiedTypes.has(r.documentType)).length,
    applications: applications.length,
    applicationsSubmitted: applications.filter((a) => a.submittedAt !== null).length,
    upcomingBookings: bookings.filter((b) => b.slot.startsAt > new Date()).length,
    unreadNotifications,
  };

  let latestAssessment: DashboardSummary["latestAssessment"] = null;
  if (assessmentRow) {
    const zones = (assessmentRow.results as unknown as { zone: string }[]) ?? [];
    latestAssessment = {
      id: assessmentRow.id,
      generatedAt: assessmentRow.generatedAt,
      safe: zones.filter((z) => z.zone === "SAFE").length,
      target: zones.filter((z) => z.zone === "TARGET").length,
      reach: zones.filter((z) => z.zone === "REACH").length,
      unlocked: entitlements.some((e) => e.grants.includes("TARGET_RESULTS")),
    };
  }

  const now = new Date();
  const deadlines = applications
    .filter((a) => a.intake.applicationDeadline > now && !a.submittedAt)
    .map((a) => ({
      applicationId: a.id,
      program: a.program.name,
      term: a.intake.term,
      deadline: a.intake.applicationDeadline,
      daysLeft: Math.ceil((a.intake.applicationDeadline.getTime() - now.getTime()) / 86_400_000),
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 5);

  const journey = buildJourney({ accountStatus, onboarding, latestAssessment, counts });

  return {
    accountStatus,
    journey,
    nextAction: pickNextAction(journey, counts),
    counts,
    latestAssessment,
    deadlines,
  };
}

function buildJourney(input: {
  accountStatus: string;
  onboarding: { isComplete: boolean; completedCount: number; totalSteps: number } | null;
  latestAssessment: DashboardSummary["latestAssessment"];
  counts: DashboardSummary["counts"];
}): JourneyStage[] {
  const { onboarding, latestAssessment, counts } = input;
  const profileDone = !!onboarding?.isComplete;

  return [
    {
      key: "profile",
      label: "Profile",
      status: profileDone ? "COMPLETE" : "ACTIVE",
      detail: onboarding
        ? `${onboarding.completedCount} of ${onboarding.totalSteps} sections complete`
        : "Not started",
      href: "/onboarding",
    },
    {
      key: "assessment",
      label: "Assessment",
      status: !profileDone ? "LOCKED" : latestAssessment ? "COMPLETE" : "ACTIVE",
      detail: latestAssessment
        ? `${latestAssessment.safe + latestAssessment.target + latestAssessment.reach} matches found`
        : profileDone
          ? "Ready to run"
          : "Complete your profile first",
      href: "/dashboard/assessment",
    },
    {
      key: "documents",
      label: "Documents",
      status:
        counts.documentsRejected > 0
          ? "BLOCKED"
          : counts.documentsMissing === 0 && counts.documentsVerified > 0
            ? "COMPLETE"
            : "ACTIVE",
      detail:
        counts.documentsRejected > 0
          ? `${counts.documentsRejected} rejected — needs your attention`
          : counts.documentsMissing > 0
            ? `${counts.documentsMissing} still needed`
            : `${counts.documentsVerified} verified`,
      href: "/dashboard/vault",
    },
    {
      key: "applications",
      label: "Applications",
      status: !latestAssessment
        ? "LOCKED"
        : counts.applicationsSubmitted > 0
          ? "COMPLETE"
          : counts.applications > 0
            ? "ACTIVE"
            : "ACTIVE",
      detail:
        counts.applicationsSubmitted > 0
          ? `${counts.applicationsSubmitted} submitted`
          : counts.applications > 0
            ? `${counts.applications} in progress`
            : "None started",
      href: "/dashboard/applications",
    },
    {
      key: "offer",
      label: "Offer",
      status: counts.applicationsSubmitted > 0 ? "ACTIVE" : "LOCKED",
      detail: counts.applicationsSubmitted > 0 ? "Awaiting decisions" : "Submit an application first",
      href: "/dashboard/applications",
    },
    {
      key: "visa",
      label: "Visa preparation",
      status: "LOCKED",
      detail: "Unlocks once you accept an offer",
      href: "/dashboard/applications",
    },
  ];
}

/**
 * The single most useful thing to do next.
 *
 * Ordered by what actually blocks progress rather than by journey position: a rejected
 * document is more urgent than an unstarted application, because everything downstream
 * waits on it.
 */
function pickNextAction(
  journey: JourneyStage[],
  counts: DashboardSummary["counts"],
): NextAction | null {
  if (counts.documentsRejected > 0) {
    return {
      label: "Fix your rejected documents",
      href: "/dashboard/vault",
      rationale: `${counts.documentsRejected} document${counts.documentsRejected === 1 ? " was" : "s were"} rejected and need re-uploading.`,
    };
  }

  const profile = journey.find((s) => s.key === "profile");
  if (profile?.status === "ACTIVE") {
    return {
      label: "Complete your profile",
      href: "/onboarding",
      rationale: "Your assessment is only as accurate as the profile behind it.",
    };
  }

  const assessment = journey.find((s) => s.key === "assessment");
  if (assessment?.status === "ACTIVE") {
    return {
      label: "Run your assessment",
      href: "/dashboard/assessment",
      rationale: "See which programmes fit your profile, and why.",
    };
  }

  if (counts.documentsMissing > 0) {
    return {
      label: "Upload your documents",
      href: "/dashboard/vault",
      rationale: `${counts.documentsMissing} required document${counts.documentsMissing === 1 ? "" : "s"} still missing.`,
    };
  }

  if (counts.applications === 0) {
    return {
      label: "Start an application",
      href: "/dashboard/assessment",
      rationale: "Your documents are ready — pick a programme from your matches.",
    };
  }

  return null;
}
