import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/response";
import { parseBody, requestIdOf, requestMeta } from "@/lib/api-route";
import { enforceRateLimit } from "@/lib/rate-limit";
import { login } from "@/services/auth-service";

// POST /api/v1/auth/login — docs/12-api-contracts.md §2.
// Session cookie is set via Set-Cookie by the session layer; no token is ever returned
// in the JSON body.

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const requestId = requestIdOf(request);
  try {
    const body = await parseBody(request, schema);
    const meta = requestMeta(request);
    // Limited on IP *and* account so neither a single attacker IP spraying many accounts
    // nor a distributed attempt against one account gets unlimited tries.
    await enforceRateLimit("LOGIN", meta.ipAddress ?? "unknown-ip");
    await enforceRateLimit("LOGIN", `account:${body.email.toLowerCase()}`);
    const result = await login(body, meta);
    return ok(result, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
