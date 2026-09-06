import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getActor } from "@/lib/auth/guards";
import { getDashboardSummary } from "@/services/dashboard-service";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

export const metadata: Metadata = { title: "Dashboard · AdmitFlow" };

const STAGE_TONE = {
  COMPLETE: "success",
  ACTIVE: "primary",
  BLOCKED: "error",
  LOCKED: "neutral",
} as const;

export default async function DashboardPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const summary = await getDashboardSummary(actor.userId, actor.profileId, actor.status);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-text-primary">Your journey</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Everything you need to apply abroad, in one place.
      </p>

      {summary.nextAction && (
        <Card className="mb-6 border-secondary/40 bg-secondary/5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-secondary">
            Do this next
          </p>
          <h2 className="mb-1 text-lg font-semibold text-text-primary">
            {summary.nextAction.label}
          </h2>
          <p className="mb-4 text-sm text-text-secondary">{summary.nextAction.rationale}</p>
          <Link href={summary.nextAction.href}>
            <Button>{summary.nextAction.label}</Button>
          </Link>
        </Card>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Progress
        </h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summary.journey.map((stage) => (
            <li key={stage.key}>
              <Link href={stage.status === "LOCKED" ? "#" : stage.href} className="block">
                <Card
                  className={
                    stage.status === "LOCKED"
                      ? "opacity-60"
                      : "transition-shadow duration-base hover:shadow-md"
                  }
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium text-text-primary">{stage.label}</span>
                    <Badge tone={STAGE_TONE[stage.status]}>
                      {stage.status === "COMPLETE"
                        ? "Done"
                        : stage.status === "ACTIVE"
                          ? "In progress"
                          : stage.status === "BLOCKED"
                            ? "Needs attention"
                            : "Locked"}
                    </Badge>
                  </div>
                  <p className="text-sm text-text-secondary">{stage.detail}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
            Your matches
          </h2>
          {summary.latestAssessment ? (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge tone="success">{summary.latestAssessment.safe} strong</Badge>
                <Badge tone="primary">{summary.latestAssessment.target} good</Badge>
                <Badge tone="warning">{summary.latestAssessment.reach} ambitious</Badge>
              </div>
              <p className="mb-4 text-sm text-text-secondary">
                Last assessed{" "}
                {summary.latestAssessment.generatedAt.toISOString().slice(0, 10)}.
                {!summary.latestAssessment.unlocked &&
                  " Strong and good matches are locked until you unlock them."}
              </p>
              <Link href="/dashboard/assessment">
                <Button variant="ghost" size="sm">
                  View matches
                </Button>
              </Link>
            </>
          ) : (
            <p className="text-sm text-text-secondary">
              No assessment yet — complete your profile to run one.
            </p>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
            Documents
          </h2>
          <dl className="mb-4 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-text-secondary">Verified</dt>
              <dd className="font-medium text-text-primary">{summary.counts.documentsVerified}</dd>
            </div>
            <div>
              <dt className="text-text-secondary">Awaiting review</dt>
              <dd className="font-medium text-text-primary">{summary.counts.documentsPending}</dd>
            </div>
            <div>
              <dt className="text-text-secondary">Rejected</dt>
              <dd className="font-medium text-error">{summary.counts.documentsRejected}</dd>
            </div>
            <div>
              <dt className="text-text-secondary">Still needed</dt>
              <dd className="font-medium text-text-primary">{summary.counts.documentsMissing}</dd>
            </div>
          </dl>
          <Link href="/dashboard/vault">
            <Button variant="ghost" size="sm">
              Manage documents
            </Button>
          </Link>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
            Applications
          </h2>
          <p className="mb-4 text-sm text-text-secondary">
            {summary.counts.applications === 0
              ? "No applications started yet."
              : `${summary.counts.applications} total · ${summary.counts.applicationsSubmitted} submitted`}
          </p>
          <Link href="/dashboard/applications">
            <Button variant="ghost" size="sm">
              View applications
            </Button>
          </Link>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
            Upcoming deadlines
          </h2>
          {summary.deadlines.length === 0 ? (
            <p className="text-sm text-text-secondary">Nothing due right now.</p>
          ) : (
            <ul className="space-y-2">
              {summary.deadlines.map((d) => (
                <li key={d.applicationId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-text-primary">
                    {d.program} · {d.term}
                  </span>
                  <Badge tone={d.daysLeft <= 14 ? "error" : d.daysLeft <= 30 ? "warning" : "neutral"}>
                    {d.daysLeft}d
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {summary.accountStatus === "ONBOARDING" && (
        <Alert tone="info" className="mt-6">
          Your profile isn&apos;t finished yet. Assessment, applications and bookings unlock once
          it is. <Link href="/onboarding" className="font-medium underline">Finish your profile</Link>.
        </Alert>
      )}
    </div>
  );
}
