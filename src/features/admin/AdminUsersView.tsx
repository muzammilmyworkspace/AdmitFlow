"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { FormField } from "@/components/ui/FormField";
import { Alert } from "@/components/ui/Alert";
import { Skeleton } from "@/components/ui/Skeleton";
import { apiGet, apiPatch, ApiError } from "@/lib/api-client";

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  status: string;
  roles: string[];
  createdAt: string;
  lastLoginAt: string | null;
  applications: number;
  documents: number;
}

const STATUS_TONE: Record<string, "success" | "warning" | "error" | "neutral" | "info"> = {
  ACTIVE: "success",
  ONBOARDING: "info",
  EMAIL_UNVERIFIED: "warning",
  SUSPENDED: "error",
  DEACTIVATED: "neutral",
};

export function AdminUsersView() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<"SUSPENDED" | "ACTIVE" | "GRANT">("SUSPENDED");

  const load = useCallback(async (q: string) => {
    const result = await apiGet<{ users: AdminUser[] }>(
      `/api/v1/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    );
    setUsers(result.users);
  }, []);

  useEffect(() => {
    load("")
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load users."))
      .finally(() => setIsLoading(false));
  }, [load]);

  async function apply(userId: string) {
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await apiPatch(
        "/api/v1/admin/users",
        action === "GRANT"
          ? { action: "grantEntitlement", userId, productKey: "TARGET_UNLOCK", reason }
          : { action: "setStatus", userId, status: action, reason },
      );
      setActing(null);
      setReason("");
      setNotice("Change applied and recorded in the audit log.");
      await load(query);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not apply that change.");
    }
  }

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div>
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

      <form
        className="mb-6 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setIsLoading(true);
          load(query).finally(() => setIsLoading(false));
        }}
      >
        <div className="min-w-64 flex-1">
          <FormField label="Search by name or email">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} />
          </FormField>
        </div>
        <div className="mb-4">
          <Button type="submit">Search</Button>
        </div>
      </form>

      <ul className="space-y-3">
        {users.map((user) => (
          <li key={user.id}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS_TONE[user.status] ?? "neutral"}>{user.status}</Badge>
                    {user.roles.map((role) => (
                      <Badge key={role} tone="neutral">
                        {role}
                      </Badge>
                    ))}
                  </div>
                  <p className="font-medium text-text-primary">{user.name ?? user.email}</p>
                  <p className="text-sm text-text-secondary">
                    {user.email} · {user.applications} applications · {user.documents} documents
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActing(acting === user.id ? null : user.id)}
                >
                  Manage
                </Button>
              </div>

              {acting === user.id && (
                <div className="mt-4 border-t border-text-secondary/15 pt-4">
                  <div className="grid gap-x-4 sm:grid-cols-2">
                    <FormField label="Action">
                      <Select
                        value={action}
                        onChange={(e) => setAction(e.target.value as typeof action)}
                      >
                        <option value="SUSPENDED">Suspend account</option>
                        <option value="ACTIVE">Reactivate account</option>
                        <option value="GRANT">Grant match unlock</option>
                      </Select>
                    </FormField>
                    <FormField label="Reason (required, audited)">
                      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
                    </FormField>
                  </div>
                  <Button size="sm" onClick={() => apply(user.id)} disabled={!reason.trim()}>
                    Apply
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
