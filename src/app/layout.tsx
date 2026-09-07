import type { Metadata } from "next";
import "./globals.css";

// NOTE: next/font/google is intentionally NOT used here — on this Windows dev machine
// it triggers a font-directory scan that hits a restricted legacy junction
// (C:\Users\<user>\Application Data) and fails the build with an unrelated EPERM error.
// Inter is loaded via next/font/local once the font files are vendored (Phase 2 design
// system), or via the Google Fonts <link> stylesheet CDN path for now — see
// docs/07-frontend-architecture.md §7. The Tailwind `font-sans` token already falls
// back to system-ui/-apple-system/Segoe UI, so this is a purely cosmetic gap until then.

export const metadata: Metadata = {
  title: "AdmitFlow by SNZ Ventures",
  description: "Say No to Consultants. Apply Abroad Yourself.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Browser extensions decorate the document before React hydrates — Grammarly adds
    // data-gr-ext-installed to <body>, translators and dark-mode tools add classes to
    // <html> — and React reports each as a hydration mismatch even though nothing in the
    // app produced it.
    //
    // Both elements need the flag: suppressHydrationWarning applies only to the element
    // it is set on (its own attributes and text), and does NOT cascade to children. The
    // <html> flag alone left the <body> mismatch still firing.
    //
    // The scope stays deliberately narrow — these two elements are the only ones
    // extensions reliably touch, so genuine mismatches anywhere inside the app are still
    // reported.
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
