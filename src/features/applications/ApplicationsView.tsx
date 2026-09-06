"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { apiGet, ApiError } from "@/lib/api-client";

interface ApplicationRow {
  id: string;
  status: string;
  submittedAt: string | null;
  program: { name: string; university: string; country: string; level: string };
  intake: { term: string; applicationDeadline: string; status: string };
}

const STATUS_TONE: Record<string, "success" | "warning" | "error" | "neutral" | "info" | "primary"> = {
  DRAFT: "neutral",
  READY_FOR_REVIEW: "info",
  READY_TO_SUBMIT: "primary",
  SUBMITTED: "primary",
  UNDER_REVIEW: "info",
  ADDITIONAL_INFORMATION_REQUIRED: "warning",
  OFFER_RECEIVED: "success",
  OFFER_ACCEPTED: "success",
  OFFER_DECLINED: "neutral",
  WAITLISTED: "warning",
  REJECTED: "error",
  WITHDRAWN: "neutral",
};

function humanize(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
}

export function ApplicationsView() {
  const [applications, setApplications] = useState<ApplicationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    const result = await apiGet<{ applications: ApplicationRow[] }>("/api/v1/applications");
    setApplications(result.applications);
  }, []);

  useEffect(() => {
    load()
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Could not load your applications."),
      )
      .finally(() => setIsLoading(false));
  }, [load]);

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  if (error) return <Alert tone="error">{error}</Alert>;

  if (!applications || applications.length === 0) {
    return (
      <EmptyState
        title="No applications yet"
        description="Pick a programme from your matches to start one. You can prepare it fully before anything is submitted."
        action={
          <Link href="/dashboard/assessment">
            <Button>View my matches</Button>
          </Link>
        }
      />
    );
  }

  return (
    <ul className="space-y-3">
      {applications.map((app) => {
        const daysLeft = Math.ceil(
          (new Date(app.intake.applicationDeadline).getTime() - Date.now()) / 86_400_000,
        );
        return (
          <li key={app.id}>
            <Link href={`/dashboard/applications/${app.id}`} className="block">
              <Card className="transition-shadow duration-base hover:shadow-md">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Badge tone={STATUS_TONE[app.status] ?? "neutral"}>{humanize(app.status)}</Badge>
                    <h3 className="mt-1.5 font-semibold text-text-primary">{app.program.name}</h3>
                    <p className="text-sm text-text-secondary">
                      {app.program.university} · {app.program.country} · {app.intake.term}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="text-text-secondary">
                      {app.submittedAt ? "Submitted" : "Deadline"}
                    </p>
                    <p className="font-medium text-text-primary">
                      {app.submittedAt
                        ? app.submittedAt.slice(0, 10)
                        : `${daysLeft > 0 ? `${daysLeft} days left` : "passed"}`}
                    </p>
                  </div>
                </div>
              </Card>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
