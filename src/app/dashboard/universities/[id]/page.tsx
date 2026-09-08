import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramDetail } from "@/services/catalog-service";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

export const metadata: Metadata = { title: "Programme" };

export default async function ProgramDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const program = await getProgramDetail(id);
  if (!program) notFound();

  return (
    <div>
      <Link href="/dashboard/universities" className="text-sm text-text-secondary underline">
        ← All universities
      </Link>

      <div className="mb-6 mt-3">
        <h1 className="text-2xl font-semibold text-text-primary">{program.name}</h1>
        <p className="text-sm text-text-secondary">
          {program.university.name} · {program.city ? `${program.city}, ` : ""}
          {program.university.country}
          {program.university.worldRanking ? ` · Ranked #${program.university.worldRanking}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone="neutral">{program.level}</Badge>
          <Badge tone="neutral">{program.fieldOfStudy}</Badge>
          <Badge tone="neutral">{program.durationMonths} months</Badge>
          <Badge tone="neutral">{program.deliveryMode.replace(/_/g, " ")}</Badge>
        </div>
      </div>

      {program.dataFreshness.source && (
        <Alert tone="warning" className="mb-6">
          Source: {program.dataFreshness.source}. Always confirm requirements on the
          university&apos;s own website before applying.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
            Entry requirements
          </h2>
          <ul className="space-y-2 text-sm">
            {program.academicRequirements.map((req, i) => (
              <li key={i} className="text-text-primary">
                <span className="font-medium">{req.requirementType.replace(/_/g, " ")}</span>
                {req.minValue !== null && ` — minimum ${req.minValue}`}
                <span className="block text-text-secondary">{req.description}</span>
              </li>
            ))}
            {program.academicRequirements.length === 0 && (
              <li className="text-text-secondary">None published.</li>
            )}
          </ul>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
            English requirements
          </h2>
          <ul className="space-y-1 text-sm">
            {program.englishRequirements.map((req) => (
              <li key={req.testType} className="text-text-primary">
                {req.testType}: <span className="font-medium">{req.minOverallScore}</span>
              </li>
            ))}
            {program.englishRequirements.length === 0 && (
              <li className="text-text-secondary">None published.</li>
            )}
          </ul>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
            Tuition
          </h2>
          <ul className="space-y-1 text-sm">
            {program.tuitionFees.map((fee, i) => (
              <li key={i} className="text-text-primary">
                {fee.category}: {fee.amount.toLocaleString()} {fee.currency}{" "}
                <span className="text-text-secondary">
                  ({fee.perPeriod.replace(/_/g, " ").toLowerCase()})
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
            Intakes
          </h2>
          <ul className="space-y-2 text-sm">
            {program.intakes.map((intake) => (
              <li key={intake.id} className="flex items-center justify-between gap-2">
                <span className="text-text-primary">
                  {intake.term}
                  <span className="block text-xs text-text-secondary">
                    Apply by {intake.applicationDeadline.toISOString().slice(0, 10)}
                  </span>
                </span>
                <Badge tone={intake.status === "OPEN" ? "success" : intake.status === "CLOSED" ? "neutral" : "info"}>
                  {intake.status}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>

        {program.documentRequirements.length > 0 && (
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
              Documents needed
            </h2>
            <ul className="space-y-1 text-sm">
              {program.documentRequirements.map((doc, i) => (
                <li key={i} className="text-text-primary">
                  {doc.documentType.replace(/_/g, " ")}
                  {!doc.isMandatory && (
                    <span className="text-text-secondary"> (optional)</span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {program.scholarships.length > 0 && (
          <Card>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
              Scholarships
            </h2>
            <ul className="space-y-2 text-sm">
              {program.scholarships.map((s) => (
                <li key={s.id} className="text-text-primary">
                  <span className="font-medium">{s.name}</span>
                  {s.amount !== null && ` — ${s.amount.toLocaleString()} ${s.currency ?? ""}`}
                  {s.coveragePercent !== null && ` (${s.coveragePercent}% of tuition)`}
                  <span className="block text-text-secondary">{s.eligibilityCriteria}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className="mt-6">
        <Link href={`/dashboard/applications/new?programId=${program.id}`}>
          <Button size="lg">Start an application</Button>
        </Link>
      </div>
    </div>
  );
}
