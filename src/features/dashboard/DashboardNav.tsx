"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  CalendarDays,
  CreditCard,
  FileCheck2,
  LayoutDashboard,
  LogOut,
  Menu,
  ScanSearch,
  Send,
  Settings2,
  University,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Logo } from "@/components/brand/Logo";
import { apiPost } from "@/lib/api-client";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/assessment", label: "Matches", icon: ScanSearch },
  { href: "/dashboard/universities", label: "Universities", icon: University },
  { href: "/dashboard/vault", label: "Documents", icon: FileCheck2 },
  { href: "/dashboard/applications", label: "Applications", icon: Send },
  { href: "/dashboard/consultation", label: "Consultation", icon: CalendarDays },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
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
  // Mobile gets a real disclosure rather than a shrunken sidebar — the brief's §58.
  const [menuOpen, setMenuOpen] = useState(false);

  const links = isAdmin ? [...LINKS, { href: "/admin", label: "Admin", icon: Settings2 }] : LINKS;

  function isActive(href: string) {
    return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/dashboard" className="shrink-0">
          <Logo />
        </Link>

        {/* whitespace-nowrap matters: without it "Consultation" wraps mid-word and the
            whole bar grows to two lines at common laptop widths. */}
        <nav aria-label="Main" className="hidden flex-1 items-center gap-0.5 lg:flex">
          {links.map((link) => {
            const Icon = link.icon;
            const active = isActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-fast",
                  active
                    ? "bg-primary-50 text-primary-700"
                    : "text-text-secondary hover:bg-bg hover:text-text-primary",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {accountStatus === "ONBOARDING" && (
            <Badge tone="warning" className="hidden whitespace-nowrap xl:inline-flex">
              Profile incomplete
            </Badge>
          )}
          {isStaff && (
            <Badge tone="info" className="hidden xl:inline-flex">
              Staff
            </Badge>
          )}
          <button
            type="button"
            title={name}
            onClick={() => apiPost("/api/v1/auth/logout").then(() => (window.location.href = "/login"))}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-medium text-text-secondary transition-colors duration-fast hover:bg-bg hover:text-text-primary"
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden />
            <span className="hidden sm:inline">Sign out</span>
          </button>
          <button
            type="button"
            className="rounded-md p-2 text-text-secondary hover:bg-bg lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
            {menuOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-border lg:hidden">
          <ul className="mx-auto w-full max-w-6xl px-2 py-2">
            {links.map((link) => {
              const Icon = link.icon;
              const active = isActive(link.href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-3 py-3 text-sm font-medium",
                      active ? "bg-primary-50 text-primary-700" : "text-text-primary hover:bg-bg",
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </header>
  );
}
