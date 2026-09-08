"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { Alert } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { apiGet, apiPatch, ApiError } from "@/lib/api-client";

interface QueueItem {
  id: string;
  type: string;
  originalFilename: string;
  sizeBytes: number;
  createdAt: string;
  student: { id: string; email: string; name: string };
}

const REASON_CODES = [
  ["illegible_scan", "Illegible scan"],
  ["wrong_document_type", "Wrong document type"],
  ["expired_validity", "Expired"],
  ["incomplete_pages", "Incomplete — pages missing"],
  ["mismatched_name", "Name doesn't match profile"],
  ["suspected_fraud", "Suspected fraud"],
  ["other", "Other"],
] as const;

export function DocumentQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState("illegible_scan");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    const result = await apiGet<{ documents: QueueItem[] }>("/api/v1/admin/documents");
    setItems(result.documents);
  }, []);

  useEffect(() => {
    load()
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the queue."))
      .finally(() => setIsLoading(false));
  }, [load]);

  async function act(documentId: string, action: "verify" | "reject") {
    if (busyId) return;
    setBusyId(documentId);
    setError(null);
    try {
      await apiPatch("/api/v1/admin/documents", {
        action,
        documentId,
        ...(action === "reject" ? { reasonCode, notes: notes || null } : { notes: notes || null }),
      });
      setRejecting(null);
      setNotes("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record that decision.");
    } finally {
      setBusyId(null);
    }
  }

  async function preview(documentId: string) {
    try {
      const result = await apiGet<{ url: string }>(`/api/v1/vault/documents/${documentId}`);
      window.open(result.url, "_blank", "noopener");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open that document.");
    }
  }

  if (isLoading) return <SkeletonList count={3} />;

  if (items.length === 0) {
    return (
      <EmptyState
        title="Queue is clear"
        description="No documents are waiting for review right now."
      />
    );
  }

  return (
    <div>
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-text-primary">
                    {item.type.replace(/_/g, " ")} · {item.originalFilename}
                  </p>
                  <p className="text-sm text-text-secondary">
                    {item.student.name} ({item.student.email}) ·{" "}
                    {(item.sizeBytes / 1024).toFixed(0)} KB · uploaded{" "}
                    {item.createdAt.slice(0, 10)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" onClick={() => preview(item.id)}>
                    View
                  </Button>
                  <Button
                    size="sm"
                    isLoading={busyId === item.id && rejecting !== item.id}
                    onClick={() => act(item.id, "verify")}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRejecting(rejecting === item.id ? null : item.id)}
                  >
                    Reject
                  </Button>
                </div>
              </div>

              {rejecting === item.id && (
                <div className="mt-4 border-t border-text-secondary/15 pt-4">
                  {/* A reason is mandatory — a rejection with no explanation leaves the
                      student with nothing to act on. */}
                  <FormField label="Reason (required)">
                    <Select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
                      {REASON_CODES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Notes for the student" hint="Tell them exactly what to fix.">
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                    />
                  </FormField>
                  <Button
                    variant="danger"
                    size="sm"
                    isLoading={busyId === item.id}
                    onClick={() => act(item.id, "reject")}
                  >
                    Confirm rejection
                  </Button>
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
