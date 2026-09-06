import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/response";
import { parseBody, requestIdOf, requestMeta } from "@/lib/api-route";
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
    const result = await login(body, requestMeta(request));
    return ok(result, { requestId });
  } catch (error) {
    return fail(error, requestId);
  }
}
