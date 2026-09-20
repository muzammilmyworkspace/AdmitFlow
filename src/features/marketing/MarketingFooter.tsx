import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/universities", label: "Universities" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    heading: "Account",
    links: [
      { href: "/signup", label: "Create an account" },
      { href: "/login", label: "Sign in" },
      { href: "/forgot-password", label: "Reset password" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-border bg-surface">
      <div
        className="pointer-events-none absolute -left-32 -top-40 h-96 w-96 rounded-full bg-secondary-200/40 blur-3xl"
        aria-hidden
      />
      <div className="relative mx-auto grid w-full max-w-7xl gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-5 max-w-md text-sm leading-relaxed text-text-secondary">
            AdmitFlow helps you find the universities that fit your profile, understand your
            real eligibility, organise your documents and run every application yourself —
            with a human consultant only when you choose one.
          </p>
          <p className="mt-6 max-w-md text-xs leading-relaxed text-text-muted">
            AdmitFlow provides an indicative eligibility assessment based on the information
            you provide and on programme data that may change. It is not an admission or visa
            decision — those rest with universities and immigration authorities.
          </p>
        </div>

        {COLUMNS.map((column) => (
          <div key={column.heading}>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
              {column.heading}
            </p>
            <ul className="space-y-2.5">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-text-secondary transition-colors hover:text-primary"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="relative border-t border-border">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-5 py-6 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>© {new Date().getFullYear()} SNZ Ventures. AdmitFlow is a product of SNZ Ventures.</span>
          <span>Say No to Consultants. Apply Abroad Yourself.</span>
        </div>
      </div>
    </footer>
  );
}
