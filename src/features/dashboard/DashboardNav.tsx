"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/assessment", label: "My matches" },
  { href: "/dashboard/universities", label: "Universities" },
  { href: "/dashboard/vault", label: "Documents" },
  { href: "/dashboard/applications", label: "Applications" },
  { href: "/dashboard/consultation", label: "Consultation" },
  { href: "/dashboard/billing", label: "Billing" },
];

export function DashboardNav({
  name,
  accountStatus,
  isStaff,
  isAdmin,
}: {
  name: string;
  accountStatus: string;
  isStaff: boolean;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  // Mobile gets a real disclosure rather than a shrunken sidebar — docs/58 of the brief.
  const [menuOpen, setMenuOpen] = useState(false);

  const links = isAdmin ? [...LINKS, { href: "/admin", label: "Admin" }] : LINKS;

  function isActive(href: string) {
    return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
  }

  return (
    <header className="border-b border-text-secondary/15 bg-surface">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/dashboard" className="text-lg font-semibold text-primary">
          AdmitFlow
        </Link>

        <nav aria-label="Main" className="hidden flex-1 items-center gap-1 lg:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors duration-fast",
                isActive(link.href)
                  ? "bg-primary text-white"
                  : "text-text-primary hover:bg-text-secondary/10",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {accountStatus === "ONBOARDING" && <Badge tone="warning">Profile incomplete</Badge>}
          {isStaff && <Badge tone="info">Staff</Badge>}
          <span className="hidden text-sm text-text-secondary sm:inline">{name}</span>
          <button
            type="button"
            onClick={() => apiPost("/api/v1/auth/logout").then(() => (window.location.href = "/login"))}
            className="text-sm font-medium text-primary underline"
          >
            Sign out
          </button>
          <button
            type="button"
            className="lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
            <span aria-hidden className="text-xl">
              {menuOpen ? "✕" : "☰"}
            </span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-text-secondary/15 lg:hidden">
          <ul className="mx-auto w-full max-w-6xl px-2 py-2">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  className={cn(
                    "block rounded-md px-3 py-2.5 text-sm",
                    isActive(link.href)
                      ? "bg-primary text-white"
                      : "text-text-primary hover:bg-text-secondary/10",
                  )}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
