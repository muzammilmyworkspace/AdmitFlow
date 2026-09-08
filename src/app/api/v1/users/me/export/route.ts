import type { NextRequest } from "next/server";
import { requestIdOf } from "@/lib/api-route";
import { fail } from "@/lib/response";
import { requireActor } from "@/lib/auth/guards";
import { exportUserData } from "@/services/account-service";

// GET /api/v1/users/me/export — the student's own data, as a downloadable JSON file.
//
// Returned inline rather than queued as a background job (docs/42 §3.3 assumes a job).
// At v1 volumes one student's record is a handful of small queries, and a synchronous
// download is a better experience than an email with a link; the seam to move it to a
// job later is this route, not the service.
//
// Content-Disposition: attachment matters — served inline, a browser would render the
// JSON in a tab, and anything in the browser history is one shoulder-surf away.

export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const actor = await requireActor();
    const data = await exportUserData(actor.userId);
    const stamp = new Date().toISOString().slice(0, 10);

    // Document.sizeBytes is a BigInt column and JSON.stringify throws on one rather
    // than coercing it, so it is rendered as a string. Prisma's Decimal (budgets, prices)
    // already carries its own toJSON.
    const body = JSON.stringify(
      data,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    );

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="admitflow-data-${stamp}.json"`,
        "Cache-Control": "no-store",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return fail(error, requestId);
  }
}
