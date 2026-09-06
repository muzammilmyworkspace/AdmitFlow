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
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
