import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { ok, fail } from "@/lib/response";
import { requestIdOf } from "@/lib/api-route";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { runScheduledSweeps } from "@/services/scheduled-jobs";

// POST /api/v1/internal/cron — the scheduler's entry point.
//
// The $0-infrastructure profile (docs/54-decision-log.md D-11) has no always-on worker,
// so the periodic work is driven by an external scheduler (Vercel Cron, a GitHub Actions
// schedule, any hosted cron) calling this endpoint on a timer. The seam is deliberate: if
// a resident worker is added later, it imports runScheduledSweeps() directly and this
// route can go away without any sweep changing.
//
// Authenticated by a shared secret rather than by a session, because the caller is a
// machine with no user. Two rules make that safe:
//   - With no CRON_SECRET configured the route refuses every request. Failing closed
//     matters here: the alternative is an unauthenticated endpoint that deletes accounts.
//   - The comparison is constant-time. A byte-by-byte === on a secret leaks its prefix to
//     anyone willing to measure, and a scheduler endpoint is callable by the whole
//     internet.

function isAuthorized(request: NextRequest, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";

  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  // timingSafeEqual throws on a length mismatch, which would itself be a length oracle.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const secret = getEnv().CRON_SECRET;
    if (!secret) {
      logger.warn("Cron endpoint called with no CRON_SECRET configured", {
        service: "jobs",
        operation: "cron",
        requestId,
      });
      // Deliberately indistinguishable from a wrong secret: an unconfigured deployment
      // should not announce itself.
      throw new AppError("RESOURCE_NOT_FOUND", "Not found.");
    }
    if (!isAuthorized(request, secret)) {
      throw new AppError("RESOURCE_NOT_FOUND", "Not found.");
    }

    const started = Date.now();
    const result = await runScheduledSweeps();

    logger.info("Scheduled sweeps completed", {
      service: "jobs",
      operation: "cron",
      requestId,
      durationMs: Date.now() - started,
      ...result,
    });

    // 200 even when individual sweeps failed: the run itself completed, and the errors
    // are in the body. A 500 would make most schedulers retry the whole batch, including
    // the sweeps that succeeded.
    return ok(result, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
