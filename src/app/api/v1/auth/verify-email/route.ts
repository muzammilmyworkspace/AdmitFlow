import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/response";
import { parseBody, requestIdOf, requestMeta } from "@/lib/api-route";
import { verifyEmail } from "@/services/auth-service";

// POST /api/v1/auth/verify-email — docs/12-api-contracts.md §2.
// Accepts either the single-use link token or a userId + 6-digit OTP.

const schema = z
  .object({
    token: z.string().min(1).optional(),
    userId: z.string().uuid().optional(),
    otp: z.string().regex(/^\d{6}$/).optional(),
  })
  .refine((v) => !!v.token || (!!v.userId && !!v.otp), {
    message: "Provide either a verification token, or a userId with a 6-digit code.",
  });

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const body = await parseBody(request, schema);
    const result = await verifyEmail(body, requestMeta(request));
    return ok(result, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
