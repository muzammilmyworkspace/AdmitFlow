import { redirect } from "next/navigation";
import Link from "next/link";
import { getActor } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/rbac";

const ADMIN_LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/documents", label: "Document queue" },
  { href: "/admin/applications", label: "Applications" },
  { href: "/admin/audit", label: "Audit log" },
];

// Admin access is decided here, server-side, by PERMISSION rather than by role name —
// so the future COMPLIANCE_ADMIN / FINANCE_MANAGER roles need no change to this file.
// Hiding the /admin link in the nav is cosmetic; this is the control.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const isStaff =
    actor.permissions.has(PERMISSIONS.AUDIT_LOG_READ) ||
    actor.permissions.has(PERMISSIONS.DOCUMENT_REVIEW) ||
    actor.permissions.has(PERMISSIONS.UNIVERSITY_MANAGE);
  if (!isStaff) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-text-secondary/15 bg-primary">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/admin" className="text-lg font-semibold text-white">
            AdmitFlow <span className="font-normal opacity-70">admin</span>
          </Link>
          <nav aria-label="Admin" className="flex flex-wrap gap-1">
            {ADMIN_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-1.5 text-sm text-white/80 transition-colors duration-fast hover:bg-white/10 hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <Link href="/dashboard" className="ml-auto text-sm text-white/80 underline">
            Back to student view
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
