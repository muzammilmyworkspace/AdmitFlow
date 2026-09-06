"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";

interface IntakeOption {
  id: string;
  term: string;
  status: string;
  applicationDeadline: string;
  startDate: string;
}

interface ProgramDetail {
  id: string;
  name: string;
  level: string;
  fieldOfStudy: string;
  university: { name: string; country: string };
  tuition: { amount: number; currency: string } | null;
  intakes: IntakeOption[];
}

export function NewApplicationView() {
  const router = useRouter();
  const programId = useSearchParams().get("programId");
  const [program, setProgram] = useState<ProgramDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [creatingIntake, setCreatingIntake] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!programId) return;
    const result = await apiGet<{ program: ProgramDetail }>(`/api/v1/programs/${programId}`);
    setProgram(result.program);
  }, [programId]);

  useEffect(() => {
    load()
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Could not load that programme."),
      )
      .finally(() => setIsLoading(false));
  }, [load]);

  async function start(intakeId: string) {
    if (creatingIntake) return;
    setCreatingIntake(intakeId);
    setError(null);
    try {
      const result = await apiPost<{ id: string }>("/api/v1/applications", {
        programId,
        intakeId,
      });
      router.push(`/dashboard/applications/${result.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the application.");
      setCreatingIntake(null);
    }
  }

  if (!programId) return <Alert tone="error">No programme was specified.</Alert>;
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!program) return <Alert tone="error">{error ?? "Programme not found."}</Alert>;

  const openIntakes = program.intakes.filter((i) => i.status !== "CLOSED");

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-text-primary">Start an application</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Choose an intake. Nothing is submitted yet — you&apos;ll be able to attach documents and
        review everything first.
      </p>

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <Card className="mb-6">
        <h2 className="font-semibold text-text-primary">{program.name}</h2>
        <p className="text-sm text-text-secondary">
          {program.university.name} · {program.university.country} · {program.fieldOfStudy}
        </p>
        {program.tuition && (
          <p className="mt-2 text-sm text-text-secondary">
            Tuition {program.tuition.amount.toLocaleString()} {program.tuition.currency} per year
          </p>
        )}
      </Card>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
        Available intakes
      </h2>
      {openIntakes.length === 0 ? (
        <Alert tone="warning">
          Every intake for this programme is currently closed. Check back when the next cycle
          opens.
        </Alert>
      ) : (
        <ul className="space-y-3">
          {openIntakes.map((intake) => (
            <li key={intake.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-medium text-text-primary">{intake.term}</span>
                    <Badge tone={intake.status === "OPEN" ? "success" : "info"}>
                      {intake.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-text-secondary">
                    Apply by {intake.applicationDeadline.slice(0, 10)} · starts{" "}
                    {intake.startDate.slice(0, 10)}
                  </p>
                </div>
                <Button
                  onClick={() => start(intake.id)}
                  isLoading={creatingIntake === intake.id}
                >
                  Start for {intake.term}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
