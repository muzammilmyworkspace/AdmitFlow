import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/response";
import { parseBody, requestIdOf, requestMeta } from "@/lib/api-route";
import { resetPassword } from "@/services/auth-service";

// POST /api/v1/auth/reset-password — docs/12-api-contracts.md §2.
// On success every existing session for the user is revoked.

const schema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const body = await parseBody(request, schema);
    await resetPassword(body, requestMeta(request));
    return ok(null, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
