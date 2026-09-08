import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { DashboardNav } from "@/features/dashboard/DashboardNav";
import { AmbientBackground } from "@/components/brand/AmbientBackground";

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

  // The nav shows the student their own name and initials. An email prefix in an avatar
  // reads as a system account, which is the opposite of the impression this shell exists
  // to give — so the profile is read here rather than falling back to the address.
  const profile = actor.profileId
    ? await db.profile.findUnique({
        where: { id: actor.profileId },
        select: { firstName: true, lastName: true },
      })
    : null;

  return (
    // No bg-* here on purpose. This wrapper does not create a stacking context, so a
    // background on it paints over the -z-10 ambient layer and hides it completely.
    // The page colour comes from body (globals.css), which paints below everything.
    <div className="relative min-h-screen">
      <AmbientBackground />

      <DashboardNav
        firstName={profile?.firstName ?? null}
        lastName={profile?.lastName ?? null}
        email={actor.email}
        accountStatus={actor.status}
        isStaff={isStaff}
        isAdmin={actor.roles.includes("ADMIN") || actor.roles.includes("SUPER_ADMIN")}
      />

      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-9">{children}</main>
    </div>
  );
}
