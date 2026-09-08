"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Select } from "@/components/ui/Select";
import { FormField } from "@/components/ui/FormField";
import { SkeletonList } from "@/components/ui/Skeleton";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";

interface ReadinessCheck {
  key: string;
  label: string;
  satisfied: boolean;
  detail: string;
}

interface ApplicationDetail {
  id: string;
  status: string;
  submittedAt: string | null;
  program: { id: string; name: string; university: string; country: string; level: string };
  intake: { term: string; applicationDeadline: string; startDate: string; status: string };
  documents: { id: string; type: string; filename: string; status: string }[];
  requiredDocumentTypes: string[];
  history: { fromStatus: string | null; toStatus: string; changedAt: string; reason: string | null }[];
  readiness: { ready: boolean; checks: ReadinessCheck[]; missing: string[] } | null;
  submittedSnapshot: { capturedAt: string; documents: { documentId: string }[] } | null;
}

interface VaultDoc {
  id: string;
  type: string;
  originalFilename: string;
  status: string;
}

export function ApplicationDetailView({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [vaultDocs, setVaultDocs] = useState<VaultDoc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);

  const load = useCallback(async () => {
    const [detail, vault] = await Promise.all([
      apiGet<{ application: ApplicationDetail }>(`/api/v1/applications/${applicationId}`),
      apiGet<{ documents: VaultDoc[] }>("/api/v1/vault/documents"),
    ]);
    setApp(detail.application);
    setVaultDocs(vault.documents.filter((d) => d.status === "VERIFIED"));
  }, [applicationId]);

  useEffect(() => {
    load()
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Could not load this application."),
      )
      .finally(() => setIsLoading(false));
  }, [load]);

  async function run(action: () => Promise<unknown>, successMessage?: string) {
    if (isBusy) return;
    setIsBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
      if (successMessage) setNotice(successMessage);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setIsBusy(false);
    }
  }

  async function payApplicationFee() {
    const result = await apiPost<{ checkoutUrl: string }>("/api/v1/billing/checkout", {
      productKey: "APPLICATION_FEE",
      applicationId,
    });
    window.location.href = result.checkoutUrl;
  }

  if (isLoading) return <SkeletonList count={3} />;
  if (!app) return <Alert tone="error">{error ?? "Application not found."}</Alert>;

  const attachedIds = new Set(app.documents.map((d) => d.id));
  const attachable = vaultDocs.filter((d) => !attachedIds.has(d.id));
  const isEditable = app.status === "DRAFT" || app.status === "READY_FOR_REVIEW";

  return (
    <div>
      <Link href="/dashboard/applications" className="text-sm text-text-secondary underline">
        ← All applications
      </Link>

      <div className="mb-6 mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Badge tone={app.submittedAt ? "success" : "neutral"}>
            {app.status.charAt(0) + app.status.slice(1).toLowerCase().replace(/_/g, " ")}
          </Badge>
          <h1 className="mt-2 text-2xl font-semibold text-text-primary">{app.program.name}</h1>
          <p className="text-sm text-text-secondary">
            {app.program.university} · {app.program.country} · {app.intake.term} intake
          </p>
        </div>
      </div>

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}

      {app.submittedSnapshot ? (
        <Alert tone="success" className="mb-6">
          Submitted on {app.submittedSnapshot.capturedAt.slice(0, 10)} with{" "}
          {app.submittedSnapshot.documents.length} document
          {app.submittedSnapshot.documents.length === 1 ? "" : "s"}. What was sent is frozen — later
          profile or document changes won&apos;t alter this record.
        </Alert>
      ) : (
        app.readiness && (
          <Card className="mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
              Before you can submit
            </h2>
            <ul className="mb-4 space-y-2">
              {app.readiness.checks.map((check) => (
                <li key={check.key} className="flex items-start gap-2 text-sm">
                  <span
                    aria-hidden
                    className={check.satisfied ? "text-success" : "text-text-secondary"}
                  >
                    {check.satisfied ? "✓" : "○"}
                  </span>
                  <span>
                    <span className="font-medium text-text-primary">{check.label}</span>
                    <span className="block text-text-secondary">{check.detail}</span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() =>
                  run(
                    () => apiPost(`/api/v1/applications/${app.id}/submit`),
                    "Application submitted.",
                  )
                }
                disabled={!app.readiness.ready}
                isLoading={isBusy}
              >
                Submit application
              </Button>
              {!app.readiness.checks.find((c) => c.key === "fee")?.satisfied && (
                <Button variant="ghost" onClick={() => run(payApplicationFee)}>
                  Pay application fee — €15
                </Button>
              )}
            </div>
          </Card>
        )
      )}

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Attached documents
        </h2>
        {app.documents.length === 0 ? (
          <p className="mb-3 text-sm text-text-secondary">No documents attached yet.</p>
        ) : (
          <ul className="mb-3 space-y-2">
            {app.documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-text-primary">
                  {doc.filename}{" "}
                  <span className="text-text-secondary">({doc.type.replace(/_/g, " ")})</span>
                </span>
                <Badge tone={doc.status === "VERIFIED" ? "success" : "warning"}>{doc.status}</Badge>
              </li>
            ))}
          </ul>
        )}

        {isEditable &&
          (attachable.length > 0 ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-52 flex-1">
                <FormField label="Attach a verified document">
                  <Select value={selectedDoc} onChange={(e) => setSelectedDoc(e.target.value)}>
                    <option value="">Choose…</option>
                    {attachable.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.originalFilename} ({doc.type.replace(/_/g, " ")})
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
              <div className="mb-4">
                <Button
                  disabled={!selectedDoc}
                  isLoading={isBusy}
                  onClick={() =>
                    run(async () => {
                      await apiPatch(`/api/v1/applications/${app.id}`, {
                        action: "attachDocument",
                        documentId: selectedDoc,
                      });
                      setSelectedDoc("");
                    })
                  }
                >
                  Attach
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-text-secondary">
              No more verified documents available.{" "}
              <Link href="/dashboard/vault" className="font-medium text-primary underline">
                Upload one
              </Link>
              .
            </p>
          ))}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
          History
        </h2>
        <ol className="space-y-2">
          {app.history.map((entry, index) => (
            <li key={index} className="flex items-start gap-3 text-sm">
              <span className="text-text-secondary">{entry.changedAt.slice(0, 10)}</span>
              <span className="text-text-primary">
                {entry.fromStatus ? `${entry.fromStatus} → ` : ""}
                {entry.toStatus}
                {entry.reason && (
                  <span className="block text-text-secondary">{entry.reason}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      {!app.submittedAt && app.status !== "WITHDRAWN" && (
        <div className="mt-6">
          <Button
            variant="ghost"
            onClick={() =>
              run(async () => {
                await apiPatch(`/api/v1/applications/${app.id}`, {
                  action: "changeStatus",
                  toStatus: "WITHDRAWN",
                });
                router.push("/dashboard/applications");
              })
            }
          >
            Withdraw this application
          </Button>
        </div>
      )}
    </div>
  );
}
