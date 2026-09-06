import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/guards";
import { DashboardNav } from "@/features/dashboard/DashboardNav";

// Authenticated shell. Authorization happens here, server-side, for every route beneath
// it — the nav is a convenience, not the control (docs/13-authentication-authorization.md §7).
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.status === "REGISTERED" || actor.status === "EMAIL_UNVERIFIED") redirect("/verify-email");

  const isStaff =
    actor.roles.includes("ADMIN") ||
    actor.roles.includes("SUPER_ADMIN") ||
    actor.roles.includes("CONSULTANT");

  return (
    <div className="min-h-screen bg-bg">
      <DashboardNav
        name={actor.email}
        accountStatus={actor.status}
        isStaff={isStaff}
        isAdmin={actor.roles.includes("ADMIN") || actor.roles.includes("SUPER_ADMIN")}
      />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
