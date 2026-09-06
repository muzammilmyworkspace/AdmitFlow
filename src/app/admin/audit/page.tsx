import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/rbac";
import { listAuditLog } from "@/services/admin-service";
import { writeAuditLog } from "@/lib/audit";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = { title: "Audit log · Admin" };

export default async function AdminAuditPage() {
  const actor = await getActor();
  if (!actor?.permissions.has(PERMISSIONS.AUDIT_LOG_READ)) redirect("/dashboard");

  const result = await listAuditLog({ pageSize: 50 });

  // Reading the audit log is itself an auditable event — docs/27-audit-logging.md §6.
  await writeAuditLog({
    actorId: actor.userId,
    actorType: "ADMIN",
    action: "admin.action",
    entityType: "AuditLog",
    entityId: "page-view",
    metadata: { subtype: "AUDIT_LOG_ACCESSED" },
  });

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-text-primary">Audit log</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Append-only. Nothing here can be edited or deleted, including your own actions — and
        opening this page is itself recorded.
      </p>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-text-secondary/15 text-left">
                <th className="pb-2 pr-4 font-medium text-text-secondary">When</th>
                <th className="pb-2 pr-4 font-medium text-text-secondary">Actor</th>
                <th className="pb-2 pr-4 font-medium text-text-secondary">Action</th>
                <th className="pb-2 pr-4 font-medium text-text-secondary">Entity</th>
              </tr>
            </thead>
            <tbody>
              {result.entries.map((entry) => (
                <tr key={entry.id} className="border-b border-text-secondary/10">
                  <td className="py-2 pr-4 text-text-secondary">
                    {entry.createdAt.toISOString().slice(0, 19).replace("T", " ")}
                  </td>
                  <td className="py-2 pr-4">
                    <Badge tone={entry.actorType === "SYSTEM" ? "neutral" : "info"}>
                      {entry.actorType}
                    </Badge>
                    <span className="ml-2 text-text-secondary">{entry.actorEmail ?? "—"}</span>
                  </td>
                  <td className="py-2 pr-4 font-medium text-text-primary">{entry.action}</td>
                  <td className="py-2 pr-4 text-text-secondary">
                    {entry.entityType}
                    <span className="block text-xs opacity-70">
                      {entry.entityId.slice(0, 8)}…
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result.entries.length === 0 && (
          <p className="py-6 text-center text-sm text-text-secondary">No entries yet.</p>
        )}
      </Card>
    </div>
  );
}
