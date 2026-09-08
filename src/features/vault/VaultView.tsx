"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Select } from "@/components/ui/Select";
import { FormField } from "@/components/ui/FormField";
import { SkeletonList } from "@/components/ui/Skeleton";
import { apiGet, apiPost, apiDelete, ApiError } from "@/lib/api-client";

interface DocumentRow {
  id: string;
  type: string;
  originalFilename: string;
  sizeBytes: number;
  status: string;
  createdAt: string;
  latestReview: { outcome: string; reasonCode: string | null; notes: string | null } | null;
}

interface RequirementRow {
  documentType: string;
  isMandatory: boolean;
  description: string | null;
  status: string;
  documentId: string | null;
}

interface VaultResponse {
  documents: DocumentRow[];
  requirements: RequirementRow[];
}

const STATUS_TONE: Record<string, "success" | "warning" | "error" | "neutral" | "info"> = {
  VERIFIED: "success",
  PENDING_REVIEW: "info",
  PROCESSING: "info",
  UPLOAD_INITIATED: "neutral",
  REJECTED: "error",
  EXPIRED: "warning",
  MISSING: "neutral",
  REPLACED: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  VERIFIED: "Verified",
  PENDING_REVIEW: "Under review",
  PROCESSING: "Processing",
  UPLOAD_INITIATED: "Upload started",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  MISSING: "Not uploaded",
  REPLACED: "Replaced",
};

const DOC_TYPES = [
  ["PASSPORT", "Passport"],
  ["TRANSCRIPT", "Academic transcript"],
  ["DEGREE_CERTIFICATE", "Degree certificate"],
  ["LANGUAGE_TEST_REPORT", "English test report"],
  ["SOP", "Statement of purpose"],
  ["CV", "CV / résumé"],
  ["RECOMMENDATION_LETTER", "Recommendation letter"],
  ["FINANCIAL_STATEMENT", "Financial statement"],
  ["OTHER", "Other"],
] as const;

export function VaultView() {
  const [data, setData] = useState<VaultResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string>("PASSPORT");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setData(await apiGet<VaultResponse>("/api/v1/vault/documents"));
  }, []);

  useEffect(() => {
    load()
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load documents."))
      .finally(() => setIsLoading(false));
  }, [load]);

  async function handleFile(file: File, documentType: string) {
    setUploadingType(documentType);
    setError(null);
    try {
      // Three steps, mirroring the S3 flow exactly: authorize, PUT direct to storage,
      // then confirm so the server can verify the bytes actually landed and are what
      // they claim to be. The file never passes through the app server.
      const init = await apiPost<{ documentId: string; uploadUrl: string }>(
        "/api/v1/vault/documents",
        {
          type: documentType,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        },
      );

      const put = await fetch(init.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error("The upload could not be completed.");

      await apiPost(`/api/v1/vault/documents/${init.documentId}/confirm`);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Upload failed.",
      );
      await load();
    } finally {
      setUploadingType(null);
    }
  }

  async function download(documentId: string) {
    try {
      const result = await apiGet<{ url: string }>(`/api/v1/vault/documents/${documentId}`);
      window.open(result.url, "_blank", "noopener");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open that document.");
    }
  }

  async function remove(documentId: string) {
    try {
      await apiDelete(`/api/v1/vault/documents/${documentId}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete that document.");
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <SkeletonList count={2} />
      </div>
    );
  }

  return (
    <div>
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <Card className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Upload a document
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-52 flex-1">
            <FormField label="Document type">
              <Select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
                {DOC_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <div className="mb-4">
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file, selectedType);
                e.target.value = "";
              }}
            />
            <Button
              onClick={() => fileInput.current?.click()}
              isLoading={uploadingType !== null}
            >
              Choose file
            </Button>
          </div>
        </div>
        <p className="text-xs text-text-secondary">
          PDF, JPEG or PNG, up to 5MB. Files are stored privately and only ever shared through
          short-lived links — never a public URL.
        </p>
      </Card>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Required documents
        </h2>
        <ul className="space-y-2">
          {data?.requirements.map((req) => (
            <li
              key={req.documentType}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-text-secondary/15 bg-surface px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-text-primary">
                  {DOC_TYPES.find(([v]) => v === req.documentType)?.[1] ?? req.documentType}
                </p>
                {req.description && (
                  <p className="text-xs text-text-secondary">{req.description}</p>
                )}
              </div>
              <Badge tone={STATUS_TONE[req.status] ?? "neutral"}>
                {STATUS_LABEL[req.status] ?? req.status}
              </Badge>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Your uploads
        </h2>
        {!data || data.documents.length === 0 ? (
          <p className="text-sm text-text-secondary">Nothing uploaded yet.</p>
        ) : (
          <ul className="space-y-3">
            {data.documents.map((doc) => (
              <li key={doc.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge tone={STATUS_TONE[doc.status] ?? "neutral"}>
                          {STATUS_LABEL[doc.status] ?? doc.status}
                        </Badge>
                        <span className="text-xs text-text-secondary">
                          {DOC_TYPES.find(([v]) => v === doc.type)?.[1] ?? doc.type}
                        </span>
                      </div>
                      <p className="truncate text-sm font-medium text-text-primary">
                        {doc.originalFilename}
                      </p>
                      <p className="text-xs text-text-secondary">
                        {(doc.sizeBytes / 1024).toFixed(0)} KB · uploaded{" "}
                        {doc.createdAt.slice(0, 10)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => download(doc.id)}>
                        Download
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(doc.id)}>
                        Delete
                      </Button>
                    </div>
                  </div>

                  {doc.status === "REJECTED" && doc.latestReview && (
                    <Alert tone="error" className="mt-3">
                      <strong>Rejected:</strong>{" "}
                      {doc.latestReview.reasonCode?.replace(/_/g, " ") ?? "see notes"}.{" "}
                      {doc.latestReview.notes}
                      <span className="mt-1 block">Upload a corrected version to continue.</span>
                    </Alert>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
