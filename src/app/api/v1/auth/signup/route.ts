import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/response";
import { parseBody, requestIdOf, requestMeta } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { signup } from "@/services/auth-service";

// POST /api/v1/auth/signup — docs/12-api-contracts.md §2

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
});

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const body = await parseBody(request, schema);
    const meta = requestMeta(request);
    await enforceRateLimit("SIGNUP", meta.ipAddress ?? "unknown-ip");
    const result = await signup(body, meta);
    return ok(result, { requestId }, { status: 201 });
  } catch (error) {
    return fail(error, requestId);
  }
}
