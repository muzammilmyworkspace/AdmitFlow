import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth/session";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { SignOutButtons } from "@/features/auth/SignOutButtons";

export const metadata: Metadata = { title: "Dashboard · AdmitFlow" };

// Protected route. Authorization is enforced server-side here, not by hiding a link —
// docs/13-authentication-authorization.md §7. The full command-centre dashboard is
// Phase 14; this is the minimal authenticated surface that proves the auth flow works.
export default async function DashboardPage() {
  const current = await getSessionUser();
  if (!current) redirect("/login");

  const { user } = current;
  const name = user.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user.email;

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-12">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Welcome, {name}</h1>
          <p className="text-sm text-text-secondary">{user.email}</p>
        </div>
        <SignOutButtons />
      </div>

      <Card className="mb-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-text-secondary">
          Account
        </h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-text-secondary">Status</dt>
            <dd className="font-medium text-text-primary">{user.status}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Roles</dt>
            <dd className="font-medium text-text-primary">
              {user.userRoles.map((ur) => ur.role.name).join(", ") || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-text-secondary">Email verified</dt>
            <dd className="font-medium text-text-primary">
              {user.emailVerifiedAt ? user.emailVerifiedAt.toISOString().slice(0, 10) : "Not yet"}
            </dd>
          </div>
        </dl>
      </Card>

      <Alert tone="info">
        Your account is in the <strong>{user.status}</strong> stage. The onboarding wizard,
        assessment engine, document vault, and applications are built in later phases — see
        <code className="mx-1 rounded bg-bg px-1 py-0.5 text-xs">docs/52-implementation-roadmap.md</code>.
      </Alert>
    </main>
  );
}
