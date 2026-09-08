import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getEnv } from "@/lib/env";

// NOTE: next/font/google is intentionally NOT used here — on this Windows dev machine
// it triggers a font-directory scan that hits a restricted legacy junction
// (C:\Users\<user>\Application Data) and fails the build with an unrelated EPERM error.
// Inter is instead self-hosted: the woff2 files live in /public/fonts and are declared
// with @font-face in globals.css, which also keeps the student's browser from making a
// font request to a third party (docs/42-gdpr-and-data-privacy.md).

const APP_URL = getEnv().NEXT_PUBLIC_APP_URL;

export const metadata: Metadata = {
  // metadataBase makes the relative OG/icon paths resolve to absolute URLs, which is what
  // link-preview crawlers require — without it they silently fetch nothing.
  metadataBase: new URL(APP_URL),
  title: {
    default: "AdmitFlow by SNZ Ventures",
    // Every page sets its own title; this keeps the product name on all of them.
    template: "%s · AdmitFlow",
  },
  description:
    "See which universities actually fit your profile, and why — then apply directly, without an agency taking a cut.",
  applicationName: "AdmitFlow",
  openGraph: {
    type: "website",
    siteName: "AdmitFlow",
    title: "AdmitFlow — Say No to Consultants. Apply Abroad Yourself.",
    description:
      "See which universities actually fit your profile, and why — then apply directly, without an agency taking a cut.",
    url: APP_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "AdmitFlow — Say No to Consultants. Apply Abroad Yourself.",
    description:
      "See which universities actually fit your profile, and why — then apply directly, without an agency taking a cut.",
  },
  // The authenticated product must never be indexed; robots.ts covers crawlers that ask,
  // and this covers the ones that read the tag.
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0A2540",
  width: "device-width",
  initialScale: 1,
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
      <head>
        {/* The latin cut carries the UI copy, so it is on the critical render path and
            worth preloading; latin-ext is only reached by accented characters and is
            left to load on demand. */}
        <link
          rel="preload"
          href="/fonts/inter-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        {/* Keyboard and screen-reader users otherwise tab the entire nav on every page
            before reaching the content — docs/43-accessibility.md. */}
        <a href="#main" className="skip-link rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-md">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
