import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/response";
import { parseBody, requestIdOf } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requestPasswordReset } from "@/services/auth-service";

// POST /api/v1/auth/forgot-password — always 200 regardless of whether the email exists,
// to prevent account enumeration (docs/12-api-contracts.md §2).

const schema = z.object({ email: z.string().email() });

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const body = await parseBody(request, schema);
    await enforceRateLimit("PASSWORD_RESET_REQUEST", body.email.toLowerCase());
    await requestPasswordReset(body.email);
    return ok(
      { message: "If an account exists for this email, a reset link has been sent." },
      { requestId },
    );
  } catch (error) {
    return fail(error, requestId);
  }
}
