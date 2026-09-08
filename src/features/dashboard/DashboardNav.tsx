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
  UserCog,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Logo } from "@/components/brand/Logo";
import { NotificationBell } from "@/features/notifications/NotificationBell";
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

/** Initials for the avatar. Falls back to the email only when there is no name yet. */
function initialsOf(firstName: string | null, lastName: string | null, email: string): string {
  const first = firstName?.trim()?.[0];
  const last = lastName?.trim()?.[0];
  if (first) return (first + (last ?? "")).toUpperCase();
  return (email[0] ?? "?").toUpperCase();
}

export function DashboardNav({
  firstName,
  lastName,
  email,
  accountStatus,
  isStaff,
  isAdmin,
}: {
  firstName: string | null;
  lastName: string | null;
  email: string;
  accountStatus: string;
  isStaff: boolean;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  // Mobile gets a real disclosure rather than a shrunken sidebar — the brief's §58.
  const [menuOpen, setMenuOpen] = useState(false);

  const links = isAdmin ? [...LINKS, { href: "/admin", label: "Admin", icon: Settings2 }] : LINKS;
  const displayName = firstName ?? email;

  function isActive(href: string) {
    return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-surface/80 shadow-sm backdrop-blur-xl">
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
                  "relative flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-fast",
                  active
                    ? "bg-brand-gradient-soft text-primary-700 ring-1 ring-inset ring-secondary-200"
                    : "text-text-secondary hover:bg-primary-50/60 hover:text-text-primary",
                )}
              >
                <Icon
                  className={cn("h-4 w-4 shrink-0", active && "text-secondary-600")}
                  aria-hidden
                />
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

          <NotificationBell />

          <Link
            href="/dashboard/settings"
            aria-label="Account settings"
            aria-current={pathname.startsWith("/dashboard/settings") ? "page" : undefined}
            className={cn(
              "flex items-center rounded-md p-2 transition-colors duration-fast",
              pathname.startsWith("/dashboard/settings")
                ? "bg-brand-gradient-soft text-primary-700 ring-1 ring-inset ring-secondary-200"
                : "text-text-secondary hover:bg-primary-50/60 hover:text-text-primary",
            )}
          >
            <UserCog className="h-5 w-5" aria-hidden />
          </Link>

          {/* The avatar is the small piece of the shell that says "this is your account",
              which a bare Sign out link never did. */}
          <span
            title={email}
            className="hidden h-9 w-9 items-center justify-center rounded-full bg-brand-gradient text-xs font-semibold text-white shadow-brand-glow sm:flex"
            aria-hidden
          >
            {initialsOf(firstName, lastName, email)}
          </span>
          <span className="hidden max-w-[10rem] truncate text-sm font-medium text-text-primary xl:inline">
            {displayName}
          </span>

          <button
            type="button"
            title={`Sign out of ${email}`}
            onClick={() => apiPost("/api/v1/auth/logout").then(() => (window.location.href = "/login"))}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-medium text-text-secondary transition-colors duration-fast hover:bg-primary-50/60 hover:text-text-primary"
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden />
            <span className="hidden sm:inline">Sign out</span>
          </button>
          <button
            type="button"
            className="rounded-md p-2 text-text-secondary hover:bg-primary-50/60 lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
            {menuOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>

      {/* Brand hairline: the logo's own green-to-navy travel, run along the full width.
          It is the cheapest possible way to make the shell feel like a product rather
          than a template. */}
      <div className="h-px w-full bg-gradient-to-r from-secondary-500/70 via-primary-500/50 to-transparent" />

      {menuOpen && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-border bg-surface lg:hidden">
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
                      active
                        ? "bg-brand-gradient-soft text-primary-700"
                        : "text-text-primary hover:bg-primary-50/60",
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {link.label}
                  </Link>
                </li>
              );
            })}
            <li>
              <Link
                href="/dashboard/settings"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2.5 rounded-md px-3 py-3 text-sm font-medium text-text-primary hover:bg-primary-50/60"
              >
                <UserCog className="h-4 w-4" aria-hidden />
                Settings
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
