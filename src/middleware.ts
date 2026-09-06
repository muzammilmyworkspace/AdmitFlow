import { NextResponse, type NextRequest } from "next/server";

// Request-ID propagation for log correlation — docs/11-api-architecture.md §9,
// docs/28-observability.md. Route-level auth/RBAC/rate-limit checks happen in
// individual route handlers/services (docs/08-backend-architecture.md), not here —
// this middleware only stamps every request/response pair with a correlation id.
// Runs in the Edge runtime, so this uses the Web Crypto global rather than "node:crypto".

export function middleware(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
