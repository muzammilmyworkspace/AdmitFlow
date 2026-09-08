import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  ArrowRight,
  CalendarClock,
  FileCheck2,
  Globe2,
  ScanSearch,
  Send,
  Sparkles,
} from "lucide-react";
import { getActor } from "@/lib/auth/guards";
import { getDashboardSummary } from "@/services/dashboard-service";
import { Card, CardLabel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/EmptyState";
import { JourneyRoadmap } from "@/features/dashboard/JourneyRoadmap";
import { GlowField } from "@/components/brand/WorldMotif";

export const metadata: Metadata = { title: "Dashboard · AdmitFlow" };

export default async function DashboardPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const summary = await getDashboardSummary(actor.userId, actor.profileId, actor.status);

  return (
    <div className="animate-fade-in">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-secondary-50 px-3 py-1 text-xs font-medium text-secondary-700 ring-1 ring-inset ring-secondary-200">
            <Globe2 className="h-3.5 w-3.5" aria-hidden />
            Applying abroad, on your own terms
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
            {/* Their own name, never an email prefix — "Welcome back, a.khan-1788" is a
                worse greeting than none at all. */}
            Welcome back{summary.firstName ? `, ${summary.firstName}` : ""}
          </h1>
          <p className="mt-1.5 text-sm text-text-secondary">
            Here&apos;s where your application stands today.
          </p>
        </div>
      </div>

      {/* The single most useful thing to do next, given precedence over everything else
          on the page — the brief's §73 core UX principle. */}
      {summary.nextAction && (
        <div className="relative mb-9 overflow-hidden rounded-xl bg-brand-gradient p-8 text-white shadow-lg">
          <GlowField />
          <div className="relative flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-xl">
              <p className="mb-2.5 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-inset ring-white/15">
                <Sparkles className="h-3.5 w-3.5 text-secondary-200" aria-hidden />
                Do this next
              </p>
              <h2 className="text-2xl font-semibold tracking-tight">{summary.nextAction.label}</h2>
              <p className="mt-2 text-white/70">{summary.nextAction.rationale}</p>
            </div>
            <Link href={summary.nextAction.href}>
              <Button size="lg" variant="secondary" className="bg-white text-primary hover:bg-white/90">
                {summary.nextAction.label}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </Link>
          </div>
        </div>
      )}

      <section className="mb-10">
        <CardLabel>Your journey</CardLabel>
        <JourneyRoadmap stages={summary.journey} />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ------------------------------------------------------------ matches -- */}
        <Card>
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-gradient-soft ring-1 ring-inset ring-secondary-200">
              <ScanSearch className="h-5 w-5 text-secondary-700" aria-hidden />
            </span>
            <h2 className="font-semibold text-text-primary">Your matches</h2>
          </div>

          {summary.latestAssessment ? (
            <>
              <div className="mb-4 grid grid-cols-3 gap-3">
                {[
                  { label: "Strong", value: summary.latestAssessment.safe, tone: "success" as const },
                  { label: "Good", value: summary.latestAssessment.target, tone: "primary" as const },
                  { label: "Ambitious", value: summary.latestAssessment.reach, tone: "warning" as const },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-md bg-bg px-3 py-3 text-center">
                    <p className="text-2xl font-semibold text-text-primary">{stat.value}</p>
                    <p className="text-xs text-text-secondary">{stat.label}</p>
                  </div>
                ))}
              </div>
              <p className="mb-4 text-sm text-text-secondary">
                Last assessed {summary.latestAssessment.generatedAt.toISOString().slice(0, 10)}.
                {!summary.latestAssessment.unlocked && " Some matches are still locked."}
              </p>
              <Link href="/dashboard/assessment">
                <Button variant="ghost" size="sm">
                  View matches
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              </Link>
            </>
          ) : (
            <EmptyState
              title="No assessment yet"
              description="Complete your profile and we'll score every programme against it."
              action={
                <Link href="/onboarding">
                  <Button size="sm">Complete profile</Button>
                </Link>
              }
              align="left"
              className="border-0 px-0 py-4"
            />
          )}
        </Card>

        {/* ---------------------------------------------------------- documents -- */}
        <Card>
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 ring-1 ring-inset ring-primary-100">
              <FileCheck2 className="h-5 w-5 text-primary-700" aria-hidden />
            </span>
            <h2 className="font-semibold text-text-primary">Documents</h2>
          </div>

          {/* Stacked stat blocks rather than label/value rows: on a two-column grid the
              rows read as "0 Awaiting review" across the gap, pairing each number with
              the wrong label. */}
          <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Verified", value: summary.counts.documentsVerified, accent: "text-secondary-700" },
              { label: "In review", value: summary.counts.documentsPending, accent: "text-info" },
              { label: "Rejected", value: summary.counts.documentsRejected, accent: "text-error" },
              { label: "Needed", value: summary.counts.documentsMissing, accent: "text-text-primary" },
            ].map((row) => (
              <div key={row.label} className="rounded-md bg-bg px-3 py-3">
                <dd className={`text-xl font-semibold tabular-nums ${row.accent}`}>{row.value}</dd>
                <dt className="mt-0.5 text-xs text-text-secondary">{row.label}</dt>
              </div>
            ))}
          </dl>

          <Link href="/dashboard/vault">
            <Button variant="ghost" size="sm">
              Manage documents
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </Link>
        </Card>

        {/* ------------------------------------------------------- applications -- */}
        <Card>
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 ring-1 ring-inset ring-primary-100">
              <Send className="h-5 w-5 text-primary-700" aria-hidden />
            </span>
            <h2 className="font-semibold text-text-primary">Applications</h2>
          </div>

          {summary.counts.applications === 0 ? (
            <p className="mb-5 text-sm text-text-secondary">
              None started yet. Pick a programme from your matches whenever you&apos;re ready.
            </p>
          ) : (
            <div className="mb-5 flex gap-6">
              <div>
                <p className="text-2xl font-semibold text-text-primary">
                  {summary.counts.applications}
                </p>
                <p className="text-xs text-text-secondary">in progress</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-secondary-700">
                  {summary.counts.applicationsSubmitted}
                </p>
                <p className="text-xs text-text-secondary">submitted</p>
              </div>
            </div>
          )}

          <Link href="/dashboard/applications">
            <Button variant="ghost" size="sm">
              View applications
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </Link>
        </Card>

        {/* ---------------------------------------------------------- deadlines -- */}
        <Card tone={summary.deadlines.some((d) => d.daysLeft <= 14) ? "warning" : "default"}>
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 ring-1 ring-inset ring-primary-100">
              <CalendarClock className="h-5 w-5 text-primary-700" aria-hidden />
            </span>
            <h2 className="font-semibold text-text-primary">Upcoming deadlines</h2>
          </div>

          {summary.deadlines.length === 0 ? (
            <p className="text-sm text-text-secondary">Nothing due right now.</p>
          ) : (
            <ul className="space-y-2.5">
              {summary.deadlines.map((d) => (
                <li key={d.applicationId} className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text-primary">
                      {d.program}
                    </span>
                    <span className="text-xs text-text-secondary">{d.term}</span>
                  </span>
                  <Badge tone={d.daysLeft <= 14 ? "error" : d.daysLeft <= 30 ? "warning" : "neutral"}>
                    {d.daysLeft}d left
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {summary.accountStatus === "ONBOARDING" && (
        <Alert tone="info" className="mt-8">
          Your profile isn&apos;t finished yet — assessment, applications and bookings unlock
          once it is.{" "}
          <Link href="/onboarding" className="font-medium underline underline-offset-2">
            Finish your profile
          </Link>
          .
        </Alert>
      )}
    </div>
  );
}
