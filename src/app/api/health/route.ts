import { db } from "@/lib/db";
import { ok, fail } from "@/lib/response";

// Liveness/readiness endpoint — docs/28-observability.md.
// GET /api/health checks DB connectivity; extend with Redis once the worker/queue lands.

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return ok({ status: "ok", db: "connected" });
  } catch (error) {
    return fail(error);
  }
}
