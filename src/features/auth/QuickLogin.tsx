"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { apiPost, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";

// One-click sign-in for the testing phase.
//
// The team wants to walk the product without typing credentials while the auth module is
// finished last. Rather than switching auth off — which would leave every guarded route
// untested — this posts the seeded test account (prisma/seed-accounts.ts) through the real
// login endpoint, so sessions, cookies and RBAC behave exactly as they will for a student.
//
// Rendered only when the server passes `enabled` (APP_ENV !== "production"); the seed
// script itself refuses to run in production, so there is no account for it to use there.

const ACCOUNTS = [
  { label: "Student", email: "student@admitflow.example", to: "/dashboard" },
  { label: "Admin", email: "admin@admitflow.example", to: "/admin" },
] as const;

const DEV_PASSWORD = "AdmitFlowDev42!";

export function QuickLogin({ className, compact = false }: { className?: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signInAs(account: (typeof ACCOUNTS)[number]) {
    if (busy) return;
    setBusy(account.email);
    setError(null);
    try {
      await apiPost("/api/v1/auth/login", { email: account.email, password: DEV_PASSWORD });
      router.push(account.to);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.message} — run \`npm run db:seed\` so the test accounts exist.`
          : "Something went wrong. Please try again.",
      );
      setBusy(null);
    }
  }

  return (
    <div className={cn("rounded-lg border border-dashed border-warning/40 bg-warning/[0.05] p-4", className)}>
      <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-warning">
        <Zap className="h-3.5 w-3.5" aria-hidden />
        Testing mode · one-click sign in
      </p>
      {error && (
        <Alert tone="error" className="mb-3">
          {error}
        </Alert>
      )}
      <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2")}>
        {ACCOUNTS.map((account) => (
          <Button
            key={account.email}
            type="button"
            variant="ghost"
            size={compact ? "sm" : "md"}
            isLoading={busy === account.email}
            disabled={!!busy}
            onClick={() => signInAs(account)}
          >
            Continue as {account.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
