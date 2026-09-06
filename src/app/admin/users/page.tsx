import type { Metadata } from "next";
import { AdminUsersView } from "@/features/admin/AdminUsersView";

export const metadata: Metadata = { title: "Users · Admin" };

export default function AdminUsersPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-text-primary">Users</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Suspending an account signs it out everywhere immediately. Every override needs a
        reason and is recorded in the audit log.
      </p>
      <AdminUsersView />
    </div>
  );
}
