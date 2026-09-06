import type { Metadata } from "next";
import Link from "next/link";
import { getPlatformStats } from "@/services/admin-service";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = { title: "Admin · AdmitFlow" };

export default async function AdminOverviewPage() {
  const stats = await getPlatformStats();

  const tiles = [
    { label: "Students", value: stats.students, detail: `${stats.activeStudents} active` },
    {
      label: "Applications",
      value: stats.applications,
      detail: `${stats.submittedApplications} submitted`,
    },
    { label: "Assessments run", value: stats.assessments, detail: "all time" },
    {
      label: "Revenue",
      value: `€${stats.revenue.total.toFixed(2)}`,
      detail: `${stats.revenue.count} payments`,
    },
    { label: "Universities", value: stats.universities, detail: `${stats.programs} programmes` },
    {
      label: "Documents awaiting review",
      value: stats.pendingDocuments,
      detail: stats.pendingDocuments > 0 ? "needs attention" : "queue clear",
    },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-text-primary">Platform overview</h1>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <p className="text-sm text-text-secondary">{tile.label}</p>
            <p className="text-2xl font-semibold text-text-primary">{tile.value}</p>
            <p className="text-xs text-text-secondary">{tile.detail}</p>
          </Card>
        ))}
      </div>

      {stats.pendingDocuments > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Badge tone="warning">Action needed</Badge>
              <p className="mt-1.5 font-medium text-text-primary">
                {stats.pendingDocuments} document{stats.pendingDocuments === 1 ? "" : "s"} awaiting
                review
              </p>
              <p className="text-sm text-text-secondary">
                Students are blocked from applying until these are checked.
              </p>
            </div>
            <Link href="/admin/documents" className="font-medium text-primary underline">
              Open the queue
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
