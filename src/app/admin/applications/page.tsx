import type { Metadata } from "next";
import Link from "next/link";
import { listApplicationsForReview } from "@/services/admin-service";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = { title: "Applications · Admin" };

export default async function AdminApplicationsPage() {
  const result = await listApplicationsForReview({ pageSize: 50 });

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-text-primary">Applications</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Every application across the platform. Submitted ones carry a frozen snapshot of
        exactly what was sent.
      </p>

      {result.applications.length === 0 ? (
        <EmptyState title="No applications yet" description="They'll appear here as students start them." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-text-secondary/15 text-left">
                  <th className="pb-2 pr-4 font-medium text-text-secondary">Student</th>
                  <th className="pb-2 pr-4 font-medium text-text-secondary">Programme</th>
                  <th className="pb-2 pr-4 font-medium text-text-secondary">Intake</th>
                  <th className="pb-2 pr-4 font-medium text-text-secondary">Status</th>
                  <th className="pb-2 font-medium text-text-secondary">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {result.applications.map((app) => (
                  <tr key={app.id} className="border-b border-text-secondary/10">
                    <td className="py-2 pr-4">
                      <span className="text-text-primary">{app.student.name}</span>
                      <span className="block text-xs text-text-secondary">{app.student.email}</span>
                    </td>
                    <td className="py-2 pr-4">
                      <span className="text-text-primary">{app.program}</span>
                      <span className="block text-xs text-text-secondary">{app.university}</span>
                    </td>
                    <td className="py-2 pr-4 text-text-secondary">{app.term}</td>
                    <td className="py-2 pr-4">
                      <Badge tone={app.submittedAt ? "primary" : "neutral"}>
                        {app.status.replace(/_/g, " ").toLowerCase()}
                      </Badge>
                    </td>
                    <td className="py-2 text-text-secondary">
                      {app.submittedAt ? app.submittedAt.toISOString().slice(0, 10) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="mt-4 text-sm text-text-secondary">
        <Link href="/admin" className="underline">
          Back to overview
        </Link>
      </p>
    </div>
  );
}
