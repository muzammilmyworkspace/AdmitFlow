import { NextResponse, type NextRequest } from "next/server";

// Request-ID propagation and the Content-Security-Policy — docs/11-api-architecture.md §9,
// docs/14-security-architecture.md §9, docs/28-observability.md.
//
// Route-level auth/RBAC/rate-limit checks happen in individual route handlers and services
// (docs/08-backend-architecture.md), not here. This middleware does two things to every
// request: stamps a correlation id, and issues the CSP.
//
// Runs in the Edge runtime, so this uses the Web Crypto global rather than "node:crypto".

/**
 * The CSP is nonce-based rather than `unsafe-inline`.
 *
 * Next injects inline bootstrap scripts on every page, so a script-src without either a
 * nonce or `unsafe-inline` breaks the app entirely. `unsafe-inline` would be the easy
 * answer and would also void most of the protection a CSP exists to give — an injected
 * `<script>` is exactly what it is supposed to stop. A per-request nonce keeps the policy
 * strict and still lets Next's own scripts run.
 *
 * `strict-dynamic` lets those trusted scripts load the chunks they need without every
 * chunk URL being enumerated here.
 */
function buildCsp(nonce: string, isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    // 'unsafe-eval' only in development: React Refresh compiles in the browser. Shipping
    // it to production would hand an attacker eval() back.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Tailwind emits a stylesheet, but styled JSX and inline style attributes (the width
    // of a progress bar, a locked card's placeholder bars) are set as `style=""`, which
    // style-src-attr governs. Dropping 'unsafe-inline' here would silently flatten those.
    "style-src 'self' 'unsafe-inline'",
    // Fonts are self-hosted (see globals.css) so no font CDN needs allowing.
    "font-src 'self'",
    // data: covers inline SVG data URIs; blob: covers client-side previews of a document
    // the student has just selected but not yet uploaded.
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    // The app frames nothing and is framed by nothing.
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    // Documents are uploaded to storage and forms post to this origin only.
    "form-action 'self'",
    "manifest-src 'self'",
  ];
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export function middleware(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const isDev = process.env.NODE_ENV !== "production";
  const csp = buildCsp(nonce, isDev);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  // Next reads this header and stamps the nonce onto the scripts it injects.
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Static assets and the generated metadata routes are served as files and need no CSP
  // of their own; excluding them also keeps a nonce from being minted per image request.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|opengraph-image|robots.txt|sitemap.xml|fonts/).*)",
  ],
};
