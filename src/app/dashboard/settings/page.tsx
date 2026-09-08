import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UserCog } from "lucide-react";
import { getActor } from "@/lib/auth/guards";
import { PageHeader } from "@/components/ui/PageHeader";
import { AccountSettings } from "@/features/account/AccountSettings";

export const metadata: Metadata = { title: "Account settings" };

export default async function SettingsPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  return (
    <div className="animate-fade-in">
      <PageHeader
        icon={UserCog}
        eyebrow="Your account"
        title="Settings"
        description={
          <>
            Signed in as {actor.email}. Change your password, review where you&apos;re signed
            in, and manage your data.
          </>
        }
      />
      <AccountSettings />
    </div>
  );
}
