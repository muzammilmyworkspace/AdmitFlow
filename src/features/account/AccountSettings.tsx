"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Download,
  KeyRound,
  Laptop,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { FormField } from "@/components/ui/FormField";
import { SkeletonList } from "@/components/ui/Skeleton";
import { apiGet, apiPost, apiDelete, ApiError } from "@/lib/api-client";

// Account settings — the things a student must be able to do without emailing support.
//
// Everything destructive here states its consequence in the button, not in a tooltip: a
// student signing out another device, or deleting their account, should not have to
// guess what the control does.

interface SessionView {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

interface DeletionState {
  pending: { id: string; requestedAt: string; executeAfter: string | null } | null;
  disclosure: { deleted: string[]; retained: string[] };
  graceDays: number;
}

/** "Chrome on Windows" out of a user-agent string. Best-effort, never authoritative. */
function describeDevice(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Safari\//.test(ua) && !/Chrome/.test(ua)
        ? "Safari"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iOS/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "Unknown OS";
  return `${browser} on ${os}`;
}

export function AccountSettings() {
  const [sessions, setSessions] = useState<SessionView[] | null>(null);
  const [deletion, setDeletion] = useState<DeletionState | null>(null);

  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "" });
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [sessionError, setSessionError] = useState<string | null>(null);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    const [s, d] = await Promise.all([
      apiGet<{ sessions: SessionView[] }>("/api/v1/users/me/sessions"),
      apiGet<DeletionState>("/api/v1/users/me/deletion"),
    ]);
    setSessions(s.sessions);
    setDeletion(d);
  }, []);

  useEffect(() => {
    load().catch(() => setSessions([]));
  }, [load]);

  async function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setPasswordError(null);
    setPasswordMessage(null);
    try {
      await apiPost("/api/v1/users/me/password", passwords);
      setPasswords({ currentPassword: "", newPassword: "" });
      setPasswordMessage(
        "Password changed. Every other device has been signed out — this one stays signed in.",
      );
      await load().catch(() => undefined);
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : "Could not change your password.");
    } finally {
      setIsSaving(false);
    }
  }

  async function endSession(id: string) {
    setSessionError(null);
    try {
      await apiDelete(`/api/v1/users/me/sessions/${id}`);
      await load();
    } catch (err) {
      setSessionError(err instanceof ApiError ? err.message : "Could not end that session.");
    }
  }

  async function requestDeletion() {
    if (isDeleting) return;
    setIsDeleting(true);
    setDeletionError(null);
    try {
      await apiPost("/api/v1/users/me/deletion");
      setConfirmDelete(false);
      await load();
    } catch (err) {
      setDeletionError(err instanceof ApiError ? err.message : "Could not start the deletion.");
    } finally {
      setIsDeleting(false);
    }
  }

  async function cancelDeletion() {
    setDeletionError(null);
    try {
      await apiDelete("/api/v1/users/me/deletion");
      await load();
    } catch (err) {
      setDeletionError(err instanceof ApiError ? err.message : "Could not cancel the deletion.");
    }
  }

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------ password -- */}
      <Card>
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 ring-1 ring-inset ring-primary-100">
            <KeyRound className="h-5 w-5 text-primary-700" aria-hidden />
          </span>
          <h2 className="font-semibold text-text-primary">Password</h2>
        </div>

        {passwordMessage && (
          <Alert tone="success" className="mb-4">
            {passwordMessage}
          </Alert>
        )}
        {passwordError && (
          <Alert tone="error" className="mb-4">
            {passwordError}
          </Alert>
        )}

        <form onSubmit={submitPassword} className="max-w-md">
          <FormField label="Current password">
            <Input
              type="password"
              autoComplete="current-password"
              value={passwords.currentPassword}
              onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
              required
            />
          </FormField>
          <FormField label="New password" hint="At least 12 characters">
            <Input
              type="password"
              autoComplete="new-password"
              value={passwords.newPassword}
              onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
              required
            />
          </FormField>
          <Button type="submit" isLoading={isSaving}>
            Change password
          </Button>
        </form>
      </Card>

      {/* ------------------------------------------------------------ sessions -- */}
      <Card>
        <div className="mb-1 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 ring-1 ring-inset ring-primary-100">
            <Laptop className="h-5 w-5 text-primary-700" aria-hidden />
          </span>
          <h2 className="font-semibold text-text-primary">Where you&apos;re signed in</h2>
        </div>
        <p className="mb-4 ml-[3rem] text-sm text-text-secondary">
          Every device that can currently act as you. If you don&apos;t recognise one, end it
          and change your password.
        </p>

        {sessionError && (
          <Alert tone="error" className="mb-4">
            {sessionError}
          </Alert>
        )}

        {sessions === null ? (
          <SkeletonList count={2} />
        ) : sessions.length === 0 ? (
          <p className="text-sm text-text-secondary">No active sessions.</p>
        ) : (
          <ul className="space-y-3">
            {sessions.map((session) => (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
                    {describeDevice(session.userAgent)}
                    {session.isCurrent && <Badge tone="success">This device</Badge>}
                  </p>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    {session.ipAddress ? `${session.ipAddress} · ` : ""}
                    started {new Date(session.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {!session.isCurrent && (
                  <Button variant="ghost" size="sm" onClick={() => endSession(session.id)}>
                    Sign out this device
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------------------------------------------------------- your data -- */}
      <Card>
        <div className="mb-1 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary-50 ring-1 ring-inset ring-secondary-200">
            <ShieldCheck className="h-5 w-5 text-secondary-700" aria-hidden />
          </span>
          <h2 className="font-semibold text-text-primary">Your data</h2>
        </div>
        <p className="mb-4 ml-[3rem] text-sm text-text-secondary">
          Download everything we hold about you, as a file you can keep or take elsewhere.
        </p>

        {/* A plain link, not a fetch: the response is an attachment, and letting the
            browser handle it means no blob juggling and no memory copy of the file. */}
        <a href="/api/v1/users/me/export" download>
          <Button variant="ghost">
            <Download className="h-4 w-4" aria-hidden />
            Download my data
          </Button>
        </a>
      </Card>

      {/* ------------------------------------------------------------- danger -- */}
      <Card tone="warning">
        <div className="mb-1 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning/10 ring-1 ring-inset ring-warning/25">
            <AlertTriangle className="h-5 w-5 text-warning" aria-hidden />
          </span>
          <h2 className="font-semibold text-text-primary">Delete your account</h2>
        </div>

        {deletionError && (
          <Alert tone="error" className="mb-4 mt-3">
            {deletionError}
          </Alert>
        )}

        {deletion?.pending ? (
          <div className="ml-[3rem]">
            <p className="text-sm text-text-primary">
              Your account is scheduled for deletion
              {deletion.pending.executeAfter &&
                ` on ${new Date(deletion.pending.executeAfter).toLocaleDateString()}`}
              .
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              Until then, nothing has been removed and you can change your mind.
            </p>
            <Button className="mt-4" onClick={cancelDeletion}>
              Keep my account
            </Button>
          </div>
        ) : (
          <div className="ml-[3rem]">
            <p className="text-sm text-text-secondary">
              This cannot be undone once it goes through. We wait{" "}
              {deletion?.graceDays ?? 7} days first, so you can cancel if you change your mind.
            </p>

            {/* The two-tier outcome is stated before the student agrees, not after —
                docs/42 §3.2 requires this tension be made visible rather than papered
                over with a UI that implies total erasure. */}
            {deletion && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="rounded-md border border-border bg-surface px-4 py-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">
                    What gets deleted
                  </p>
                  <ul className="space-y-1 text-sm text-text-secondary">
                    {deletion.disclosure.deleted.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-md border border-border bg-surface px-4 py-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">
                    What we have to keep
                  </p>
                  <ul className="space-y-1 text-sm text-text-secondary">
                    {deletion.disclosure.retained.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {confirmDelete ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="danger" onClick={requestDeletion} isLoading={isDeleting}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                  Yes, delete my account
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="ghost" className="mt-4" onClick={() => setConfirmDelete(true)}>
                Delete my account
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
