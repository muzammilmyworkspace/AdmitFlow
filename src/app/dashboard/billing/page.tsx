import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/guards";
import { listPurchases } from "@/services/payments/billing-service";
import { listEntitlements } from "@/services/entitlement-service";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = { title: "Billing · AdmitFlow" };

export default async function BillingPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [purchases, entitlements] = await Promise.all([
    listPurchases(actor.userId),
    listEntitlements(actor.userId),
  ]);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-text-primary">Billing</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Everything you&apos;ve paid for, and what it unlocked.
      </p>

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
          What you have access to
        </h2>
        {entitlements.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Nothing unlocked yet. Your free assessment and ambitious matches don&apos;t require a
            purchase.
          </p>
        ) : (
          <ul className="space-y-2">
            {entitlements.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <span className="font-medium text-text-primary">{e.productName}</span>
                  <span className="block text-xs text-text-secondary">
                    {e.grants.join(", ").replace(/_/g, " ").toLowerCase()}
                    {e.scope?.assessmentId ? " · for one assessment" : ""}
                  </span>
                </div>
                <Badge tone={e.sourceType === "ADMIN_GRANT" ? "info" : "success"}>
                  {e.sourceType === "ADMIN_GRANT" ? "Granted by support" : "Purchased"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
        Payment history
      </h2>
      {purchases.length === 0 ? (
        <EmptyState
          title="No payments yet"
          description="When you unlock matches, pay an application fee, or book a consultation, it shows up here."
        />
      ) : (
        <ul className="space-y-2">
          {purchases.map((p) => (
            <li key={p.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="font-medium text-text-primary">{p.productName}</p>
                  <p className="text-xs text-text-secondary">
                    {p.createdAt.toISOString().slice(0, 10)}
                    {p.paidAt ? " · paid" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium text-text-primary">
                    {p.amount.toFixed(2)} {p.currency}
                  </span>
                  <Badge
                    tone={
                      p.status === "COMPLETED"
                        ? "success"
                        : p.status === "REFUNDED"
                          ? "neutral"
                          : p.status === "FAILED"
                            ? "error"
                            : "warning"
                    }
                  >
                    {p.status.toLowerCase()}
                  </Badge>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
